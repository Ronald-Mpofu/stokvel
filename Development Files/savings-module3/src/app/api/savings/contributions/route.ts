// src/app/api/savings/contributions/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'

const paySchema = z.object({
  contributionId: z.string().uuid(),
  amountPaid:     z.coerce.number().positive(),
  paymentMethod:  z.string().default('ECOCASH'),
  paymentRef:     z.string().optional(),
})

// GET — fetch contribution schedule for a pool
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const poolId  = searchParams.get('poolId')
    const userId  = searchParams.get('userId')
    const period  = searchParams.get('period')

    if (!poolId) return NextResponse.json({ success: false, error: 'poolId required' }, { status: 400 })

    const where: any = { poolId }
    if (userId) where.userId = userId
    if (period) where.periodNumber = parseInt(period)

    const contributions = await (prisma as any).savingsContribution.findMany({
      where,
      include: { user: { select: { fullName: true, email: true } } },
      orderBy: [{ periodNumber: 'asc' }, { userId: 'asc' }],
    })

    const now   = new Date()
    const stats = {
      total:   contributions.length,
      paid:    contributions.filter(c => c.status === 'PAID').length,
      pending: contributions.filter(c => c.status === 'PENDING').length,
      late:    contributions.filter(c => c.status !== 'PAID' && c.status !== 'WAIVED' && new Date(c.dueDate) < now).length,
      totalCollected: contributions.filter(c => c.status === 'PAID').reduce((s,c) => s + Number(c.amountPaid), 0),
      totalDue:       contributions.reduce((s,c) => s + Number(c.amountDue), 0),
    }

    return NextResponse.json({
      success: true,
      data: {
        contributions: contributions.map(c => ({
          id:            c.id,
          poolId:        c.poolId,
          userId:        c.userId,
          memberName:    c.user.fullName,
          memberEmail:   c.user.email,
          periodNumber:  c.periodNumber,
          dueDate:       c.dueDate,
          amountDue:     Number(c.amountDue),
          amountPaid:    Number(c.amountPaid),
          currency:      c.currency,
          status:        c.status,
          paidAt:        c.paidAt,
          paymentMethod: c.paymentMethod,
          paymentRef:    c.paymentRef,
          isOverdue:     c.status !== 'PAID' && c.status !== 'WAIVED' && new Date(c.dueDate) < now,
        })),
        stats,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// POST — record payment
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Bulk mark period as collected
    if (body.action === 'MARK_PERIOD_COLLECTED') {
      const { poolId, periodNumber } = body
      await (prisma as any).savingsContribution.updateMany({
        where: { poolId, periodNumber, status: { not: 'PAID' } },
        data:  { status: 'PAID', paidAt: new Date(), amountPaid: undefined },
      })
      // Recalculate pool totals
      await recalcPoolTotals(poolId)
      return NextResponse.json({ success: true, message: `Period ${periodNumber} marked as collected` })
    }

    // Waive a contribution
    if (body.action === 'WAIVE') {
      await (prisma as any).savingsContribution.update({
        where: { id: body.contributionId },
        data:  { status: 'WAIVED', notes: body.notes || 'Waived by admin' },
      })
      return NextResponse.json({ success: true, message: 'Contribution waived' })
    }

    const data = paySchema.parse(body)
    const contrib = await (prisma as any).savingsContribution.findUnique({
      where:   { id: data.contributionId },
      include: { pool: { select: { currency: true, groupId: true } } },
    })
    if (!contrib) return NextResponse.json({ success: false, error: 'Contribution not found' }, { status: 404 })

    const isFullyPaid = Number(contrib.amountPaid) + data.amountPaid >= Number(contrib.amountDue)

    await prisma.$transaction([
      (prisma as any).savingsContribution.update({
        where: { id: data.contributionId },
        data: {
          amountPaid:    { increment: data.amountPaid },
          status:        isFullyPaid ? 'PAID' : 'PARTIAL',
          paidAt:        isFullyPaid ? new Date() : undefined,
          paymentMethod: data.paymentMethod,
          paymentRef:    data.paymentRef,
        },
      }),
      prisma.transaction.create({
        data: {
          type:          'CONTRIBUTION',
          status:        'COMPLETED',
          amount:        data.amountPaid,
          currency:      contrib.pool.currency,
          description:   `Savings pool contribution — Period #${contrib.periodNumber}`,
          reference:     data.paymentRef || `SAVE-${Date.now()}`,
          paymentMethod: data.paymentMethod as any,
          userId:        contrib.userId,
        },
      }),
    ])

    await recalcPoolTotals(contrib.poolId)
    return NextResponse.json({
      success: true,
      message: isFullyPaid ? `✅ Period #${contrib.periodNumber} paid in full` : `Partial payment recorded`,
    })
  } catch (e: any) {
    if (e instanceof z.ZodError) return NextResponse.json({ success: false, error: e.errors.map(x => x.message).join('; ') }, { status: 400 })
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

async function recalcPoolTotals(poolId: string) {
  const paid = await (prisma as any).savingsContribution.aggregate({
    where: { poolId, status: 'PAID' },
    _sum:  { amountPaid: true },
  })
  const interest = await (prisma as any).savingsLoan.aggregate({
    where: { poolId },
    _sum:  { totalInterestPaid: true },
  })
  const totalContrib   = Number(paid._sum.amountPaid || 0)
  const totalInterest  = Number(interest._sum.totalInterestPaid || 0)

  await (prisma as any).savingsPool.update({
    where: { id: poolId },
    data: {
      totalContributed:    totalContrib,
      totalInterestEarned: totalInterest,
      totalPoolValue:      totalContrib + totalInterest,
    },
  })

  // Recalc each member's share
  if (totalContrib > 0) {
    const members = await (prisma as any).savingsPoolMember.findMany({ where: { poolId } })
    const memberContribs = await (prisma as any).savingsContribution.groupBy({
      by: ['userId'], where: { poolId, status: 'PAID' },
      _sum: { amountPaid: true },
    })
    const contribMap = Object.fromEntries(memberContribs.map(c => [c.userId, Number(c._sum.amountPaid || 0)]))

    for (const m of members) {
      const mc = contribMap[m.userId] || 0
      await (prisma as any).savingsPoolMember.update({
        where: { id: m.id },
        data:  { totalContributed: mc, sharePercentage: mc / totalContrib * 100 },
      })
    }
  }
}
