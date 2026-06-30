// src/app/api/contributions/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'

// GET /api/contributions — list contributions with filters
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const groupId   = searchParams.get('groupId')
    const cycleId   = searchParams.get('cycleId')
    const userId    = searchParams.get('userId')
    const status    = searchParams.get('status')
    const month     = searchParams.get('month')
    const page      = parseInt(searchParams.get('page') || '1')
    const pageSize  = parseInt(searchParams.get('pageSize') || '50')

    const where: any = {}
    if (cycleId)  where.cycleId = cycleId
    if (userId)   where.userId  = userId
    if (status)   where.status  = status
    if (month)    where.monthNumber = parseInt(month)
    if (groupId)  where.cycle = { groupId }

    const [contributions, total] = await Promise.all([
      prisma.contribution.findMany({
        where,
        include: {
          user: { select: { fullName: true, email: true, phone: true } },
          cycle: {
            select: {
              cycleNumber: true,
              group: { select: { name: true, currency: true, contributionDay: true } },
            },
          },
        },
        orderBy: [{ monthNumber: 'asc' }, { user: { fullName: 'asc' } }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.contribution.count({ where }),
    ])

    // Summary stats
    const stats = await prisma.contribution.groupBy({
      by: ['status'],
      where,
      _count: { status: true },
      _sum: { amountDue: true, amountPaid: true },
    })

    return NextResponse.json({
      success: true,
      data: contributions.map(c => ({
        id:           c.id,
        userId:       c.userId,
        memberName:   c.user.fullName,
        memberEmail:  c.user.email,
        memberPhone:  c.user.phone,
        cycleId:      c.cycleId,
        cycleNumber:  c.cycle.cycleNumber,
        groupName:    c.cycle.group.name,
        currency:     c.cycle.group.currency,
        monthNumber:  c.monthNumber,
        amountDue:    Number(c.amountDue),
        amountPaid:   Number(c.amountPaid),
        balance:      Number(c.amountDue) - Number(c.amountPaid),
        dueDate:      c.dueDate,
        paidAt:       c.paidAt,
        status:       c.status,
        paymentMethod: c.paymentMethod,
        paymentRef:   c.paymentRef,
        retryCount:   c.retryCount,
        isPrePaid:    c.isPrePaid,
        failureReason: c.failureReason,
      })),
      stats: stats.map(s => ({
        status:      s.status,
        count:       s._count.status,
        totalDue:    Number(s._sum.amountDue || 0),
        totalPaid:   Number(s._sum.amountPaid || 0),
      })),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    })
  } catch (error) {
    console.error('GET /api/contributions error:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch contributions' }, { status: 500 })
  }
}

// POST /api/contributions/pay — record a manual payment
const paySchema = z.object({
  contributionId: z.string().uuid(),
  amountPaid:     z.number().positive(),
  paymentMethod:  z.string(),
  paymentRef:     z.string().optional(),
  notes:          z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { contributionId, amountPaid, paymentMethod, paymentRef, notes } = paySchema.parse(body)

    const contribution = await prisma.contribution.findUniqueOrThrow({
      where: { id: contributionId },
      include: { cycle: { include: { group: true } } },
    })

    if (['PAID', 'PRE_PAID', 'WAIVED'].includes(contribution.status)) {
      return NextResponse.json({ success: false, error: 'Contribution already paid or waived' }, { status: 400 })
    }

    const now = new Date()
    const dueDate = new Date(contribution.dueDate)
    const daysLate = Math.max(0, Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)))
    const newStatus = daysLate === 0 ? 'PAID' : 'PAID'

    await prisma.$transaction(async (tx) => {
      // Update contribution
      await tx.contribution.update({
        where: { id: contributionId },
        data: {
          amountPaid:    amountPaid,
          paidAt:        now,
          status:        newStatus as any,
          paymentMethod: paymentMethod as any,
          paymentRef:    paymentRef || `MANUAL-${Date.now()}`,
          notes,
        },
      })

      // Credit group escrow
      await tx.group.update({
        where: { id: contribution.cycle.groupId },
        data:  { escrowBalance: { increment: amountPaid } },
      })

      // Update member total contributed
      await tx.groupMember.updateMany({
        where: { groupId: contribution.cycle.groupId, userId: contribution.userId },
        data:  { totalContributed: { increment: amountPaid } },
      })

      // Transaction record
      await tx.transaction.create({
        data: {
          type:           'CONTRIBUTION',
          status:         'COMPLETED',
          amount:         amountPaid,
          currency:       contribution.cycle.group.currency,
          contributionId,
          groupId:        contribution.cycle.groupId,
          userId:         contribution.userId,
          reference:      paymentRef || `MANUAL-${Date.now()}`,
          paymentMethod:  paymentMethod as any,
          description:    `Month ${contribution.monthNumber} contribution - ${contribution.cycle.group.name}`,
        },
      })

      // Audit log
      await tx.auditLog.create({
        data: {
          userId:      contribution.userId,
          groupId:     contribution.cycle.groupId,
          action:      'CREATE',
          entityType:  'Contribution',
          entityId:    contributionId,
          description: `Payment of ${amountPaid} recorded for month ${contribution.monthNumber}`,
        },
      })
    })

    return NextResponse.json({
      success: true,
      message: `Payment of $${amountPaid} recorded successfully`,
      data: { contributionId, amountPaid, status: newStatus, paidAt: now },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'Invalid input', details: error.errors }, { status: 400 })
    }
    console.error('POST /api/contributions error:', error)
    return NextResponse.json({ success: false, error: 'Failed to record payment' }, { status: 500 })
  }
}
