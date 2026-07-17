// src/app/api/payments/route.ts
// Treasurer-facing confirmation of member-submitted contribution payments.
// Members submit payments from the portal as PENDING contribution Transactions;
// a treasurer (or group admin / national / system admin) confirms or rejects them here.
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'
import { getSessionFromRequest, hasPermission, unauthorized, forbidden } from '@/lib/auth'

export const dynamic = 'force-dynamic'

async function exec(query: string, params: any[] = []) {
  return prisma.$executeRawUnsafe(query, ...params)
}

// Can this non-super-admin user manage payments for this group?
async function canManageGroup(userId: string, groupId: string): Promise<boolean> {
  const g = await prisma.group.findUnique({ where: { id: groupId }, select: { adminUserId: true } })
  if (g?.adminUserId === userId) return true
  const m = await prisma.groupMember.findFirst({
    where:  { groupId, userId, status: 'ACTIVE', role: { in: ['GROUP_ADMIN', 'TREASURER'] } },
    select: { id: true },
  })
  return !!m
}

const SUPER = ['SYSTEM_ADMIN', 'NATIONAL_ADMIN']

// ── GET ?groupId= → pending contribution payments awaiting confirmation ──
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req)
    if (!session) return unauthorized()
    if (!hasPermission(session.role, 'TREASURER')) return forbidden('Treasurer access required')

    const { searchParams } = new URL(req.url)
    const groupId = searchParams.get('groupId')
    if (!groupId) return NextResponse.json({ success: false, error: 'groupId required' }, { status: 400 })

    if (!SUPER.includes(session.role) && !(await canManageGroup(session.id, groupId))) {
      return forbidden('Not authorised for this group')
    }

    const txs = await prisma.transaction.findMany({
      where:   { groupId, type: 'CONTRIBUTION', status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, amount: true, currency: true, paymentMethod: true,
        externalRef: true, description: true, userId: true, createdAt: true, metadata: true,
      },
    })

    const userIds = [...new Set(txs.map(t => t.userId).filter(Boolean))] as string[]
    const users   = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, email: true } })
      : []
    const uMap = Object.fromEntries(users.map(u => [u.id, u]))

    return NextResponse.json({
      success: true,
      data: txs.map(t => ({
        id:         t.id,
        memberName: uMap[t.userId as string]?.fullName || uMap[t.userId as string]?.email || 'Member',
        amount:     Number(t.amount),
        currency:   t.currency,
        method:     t.paymentMethod,
        reference:  t.externalRef,
        description: t.description,
        kind:       (t.metadata as any)?.kind || 'GROUP',
        createdAt:  t.createdAt,
      })),
    })
  } catch (e: any) {
    console.error('GET /api/payments error:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── POST {action:'CONFIRM'|'REJECT', transactionId, reason?} ──
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req)
    if (!session) return unauthorized()
    if (!hasPermission(session.role, 'TREASURER')) return forbidden('Treasurer access required')

    const body = await req.json()
    const { action, transactionId } = body
    if (!transactionId || !['CONFIRM', 'REJECT'].includes(action)) {
      return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 })
    }

    const tx = await prisma.transaction.findUnique({
      where:  { id: transactionId },
      select: { id: true, status: true, groupId: true, type: true, metadata: true },
    })
    if (!tx || tx.type !== 'CONTRIBUTION') return NextResponse.json({ success: false, error: 'Payment not found' }, { status: 404 })
    if (tx.status !== 'PENDING') return NextResponse.json({ success: false, error: 'This payment is no longer pending' }, { status: 409 })

    if (tx.groupId && !SUPER.includes(session.role) && !(await canManageGroup(session.id, tx.groupId))) {
      return forbidden('Not authorised for this group')
    }

    const md = (tx.metadata as any) || {}

    if (action === 'REJECT') {
      await prisma.transaction.update({
        where: { id: transactionId },
        data: {
          status: 'FAILED',
          failureReason: (body.reason || 'Rejected by treasurer'),
          metadata: { ...md, rejectedBy: session.id, rejectedAt: new Date().toISOString() },
        } as any,
      })
      return NextResponse.json({ success: true, message: 'Payment rejected' })
    }

    // CONFIRM — mark the Transaction COMPLETED
    await prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: 'COMPLETED',
        metadata: { ...md, confirmedBy: session.id, confirmedAt: new Date().toISOString() },
      } as any,
    })

    // If this settles a savings pool contribution, mark that record PAID too
    if (md.kind === 'SAVINGS' && md.savingsContributionId) {
      try {
        await exec(
          `UPDATE "SavingsContribution" SET status='PAID', "amountPaid"="amountDue", "updatedAt"=NOW() WHERE id=$1`,
          [md.savingsContributionId]
        )
      } catch (e) {
        // Non-fatal: the payment is confirmed even if the scheme row update fails; log for follow-up.
        console.error('SavingsContribution mark-paid failed:', e)
      }
    }

    return NextResponse.json({ success: true, message: 'Payment confirmed' })
  } catch (e: any) {
    console.error('POST /api/payments error:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
