// src/app/api/savings/route.ts — Savings Pool CRUD + membership
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'

const createSchema = z.object({
  groupId:              z.string().uuid(),
  name:                 z.string().min(2),
  description:          z.string().nullish().transform(v => v || undefined),
  periodMonths:         z.coerce.number().int().min(1).max(120),
  contributionAmount:   z.coerce.number().positive(),
  contributionFrequency: z.enum(['WEEKLY','FORTNIGHTLY','MONTHLY']).default('MONTHLY'),
  startDate:            z.string(),
  interestRatePa:       z.coerce.number().min(0).max(1).default(0.24),
  maxLoanPct:           z.coerce.number().min(0).max(1).default(0.50),
  allowLoans:           z.boolean().default(true),
  notes:                z.string().nullish().transform(v => v || undefined),
  memberIds:            z.array(z.string().uuid()).nullish().transform(v => v?.filter(Boolean) || []),
})

// ── Helpers ───────────────────────────────────────────────────
function calcMaturityDate(startDate: Date, periodMonths: number): Date {
  return new Date(startDate.getFullYear(), startDate.getMonth() + periodMonths, startDate.getDate())
}

function calcPeriodCount(periodMonths: number, frequency: string): number {
  if (frequency === 'WEEKLY')      return Math.ceil(periodMonths * 4.33)
  if (frequency === 'FORTNIGHTLY') return Math.ceil(periodMonths * 2.17)
  return periodMonths
}

function calcDueDate(startDate: Date, periodNum: number, frequency: string): Date {
  const d = new Date(startDate)
  if (frequency === 'WEEKLY')      d.setDate(d.getDate() + (periodNum - 1) * 7)
  else if (frequency === 'FORTNIGHTLY') d.setDate(d.getDate() + (periodNum - 1) * 14)
  else d.setMonth(d.getMonth() + (periodNum - 1))
  return d
}

function formatPool(p: any) {
  const now          = new Date()
  const start        = new Date(p.startDate)
  const maturity     = new Date(p.maturityDate)
  const totalDays    = maturity.getTime() - start.getTime()
  const elapsed      = Math.max(0, now.getTime() - start.getTime())
  const timeProgress = Math.min(100, Math.round(elapsed / totalDays * 100))
  const daysLeft     = Math.max(0, Math.ceil((maturity.getTime() - now.getTime()) / 86400000))

  return {
    id:                   p.id,
    groupId:              p.groupId,
    groupName:            p.group?.name,
    currency:             p.group?.currency || p.currency,
    name:                 p.name,
    description:          p.description,
    periodMonths:         p.periodMonths,
    contributionAmount:   Number(p.contributionAmount),
    contributionFrequency: p.contributionFrequency,
    startDate:            p.startDate,
    maturityDate:         p.maturityDate,
    status:               p.status,
    interestRatePa:       Number(p.interestRatePa),
    interestRatePct:      (Number(p.interestRatePa) * 100).toFixed(1),
    maxLoanPct:           Number(p.maxLoanPct),
    allowLoans:           p.allowLoans,
    totalContributed:     Number(p.totalContributed),
    totalInterestEarned:  Number(p.totalInterestEarned),
    totalPoolValue:       Number(p.totalPoolValue),
    distributedAt:        p.distributedAt,
    notes:                p.notes,
    memberCount:          p._count?.members || p.members?.length || 0,
    timeProgress,
    daysLeft,
    createdAt:            p.createdAt,
    members: p.members?.map((m: any) => ({
      userId:          m.userId,
      fullName:        m.user?.fullName,
      email:           m.user?.email,
      tier:            m.user?.tier,
      totalContributed: Number(m.totalContributed),
      sharePercentage: Number(m.sharePercentage),
      loanBalance:     Number(m.loanBalance),
      isActive:        m.isActive,
      joinedAt:        m.joinedAt,
    })),
    loans: p.loans?.map((l: any) => ({
      id:                l.id,
      borrowerId:        l.borrowerId,
      borrowerName:      l.borrower?.fullName,
      amount:            Number(l.amount),
      outstandingBalance: Number(l.outstandingBalance),
      status:            l.status,
      disbursedAt:       l.disbursedAt,
      termMonths:        l.termMonths,
      interestRatePct:   (Number(l.interestRatePa) * 100).toFixed(1),
    })),
    payouts: p.payouts?.map((py: any) => ({
      userId:        py.userId,
      fullName:      py.user?.fullName,
      grossShare:    Number(py.grossShare),
      loanDeduction: Number(py.loanDeduction),
      netPayout:     Number(py.netPayout),
      sharePercent:  Number(py.sharePercent),
      status:        py.status,
      paidAt:        py.paidAt,
    })),
  }
}

// ── GET ───────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const groupId = searchParams.get('groupId')
    const poolId  = searchParams.get('poolId')

    if (poolId) {
      const pool = await (prisma as any).savingsPool.findUnique({
        where:   { id: poolId },
        include: {
          group:   { select: { name: true, currency: true } },
          members: { include: { user: { select: { fullName: true, email: true, tier: true } } }, orderBy: { totalContributed: 'desc' } },
          loans:   { include: { borrower: { select: { fullName: true } } }, orderBy: { createdAt: 'desc' } },
          payouts: { include: { user: { select: { fullName: true } } }, orderBy: { netPayout: 'desc' } },
          _count:  { select: { members: true, contributions: true, loans: true } },
        },
      })
      if (!pool) return NextResponse.json({ success: false, error: 'Pool not found' }, { status: 404 })
      return NextResponse.json({ success: true, data: formatPool(pool) })
    }

    const where: any = groupId ? { groupId } : {}
    const pools = await (prisma as any).savingsPool.findMany({
      where,
      include: {
        group:   { select: { name: true, currency: true } },
        _count:  { select: { members: true, loans: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    const summary = {
      total:       pools.length,
      active:      pools.filter((p: any) => p.status === 'ACTIVE').length,
      matured:     pools.filter((p: any) => p.status === 'MATURED').length,
      totalValue:  pools.reduce((s: number, p: any) => s + Number(p.totalPoolValue), 0),
    }

    return NextResponse.json({ success: true, data: { pools: pools.map(formatPool), summary } })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── POST — create pool ────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (body.action === 'ACTIVATE')    return handleActivate(body)
    if (body.action === 'MATURE')      return handleMature(body)
    if (body.action === 'DISTRIBUTE')  return handleDistribute(body)
    if (body.action === 'PAYOUT_PAID') return handlePayoutPaid(body)
    if (body.action === 'ADD_MEMBER')  return handleAddMember(body)

    const data = createSchema.parse(body)
    const group = await prisma.group.findUnique({ where: { id: data.groupId }, select: { currency: true } })
    if (!group) return NextResponse.json({ success: false, error: 'Group not found' }, { status: 404 })

    const startDate    = new Date(data.startDate)
    const maturityDate = calcMaturityDate(startDate, data.periodMonths)

    const pool = await prisma.$transaction(async (tx) => {
      const pool = await (tx as any).savingsPool.create({
        data: {
          groupId:              data.groupId,
          name:                 data.name,
          description:          data.description,
          periodMonths:         data.periodMonths,
          contributionAmount:   data.contributionAmount,
          contributionFrequency: data.contributionFrequency,
          startDate,
          maturityDate,
          currency:             group.currency,
          interestRatePa:       data.interestRatePa,
          maxLoanPct:           data.maxLoanPct,
          allowLoans:           data.allowLoans,
          notes:                data.notes,
          status:               'SETUP',
        },
      })

      // Enrol initial members if provided
      if (data.memberIds?.length) {
        await (tx as any).savingsPoolMember.createMany({
          data: data.memberIds.map(userId => ({ poolId: pool.id, userId })),
        })
      }

      return pool
    })

    return NextResponse.json({
      success: true,
      data:    { id: pool.id },
      message: `"${data.name}" savings pool created. Add members and click Activate to start.`,
    }, { status: 201 })
  } catch (e: any) {
    if (e instanceof z.ZodError) return NextResponse.json({ success: false, error: e.errors.map((x: any) => x.message).join('; ') }, { status: 400 })
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── Activate pool — generate full contribution schedule ───────
async function handleActivate(body: any): Promise<NextResponse> {
  const { poolId } = body
  const pool = await (prisma as any).savingsPool.findUnique({
    where:   { id: poolId },
    include: { members: true },
  })
  if (!pool)                return NextResponse.json({ success: false, error: 'Pool not found' }, { status: 404 })
  if (pool.status !== 'SETUP') return NextResponse.json({ success: false, error: 'Pool is already active' }, { status: 400 })
  if (!pool.members.length) return NextResponse.json({ success: false, error: 'Add at least one member before activating' }, { status: 400 })

  const periodCount = calcPeriodCount(pool.periodMonths, pool.contributionFrequency)
  const contributions: any[] = []

  for (const member of pool.members) {
    for (let p = 1; p <= periodCount; p++) {
      contributions.push({
        poolId:       pool.id,
        userId:       member.userId,
        periodNumber: p,
        dueDate:      calcDueDate(new Date(pool.startDate), p, pool.contributionFrequency),
        amountDue:    pool.contributionAmount,
        currency:     pool.currency,
      })
    }
  }

  await prisma.$transaction([
    (prisma as any).savingsContribution.createMany({ data: contributions }),
    (prisma as any).savingsPool.update({ where: { id: poolId }, data: { status: 'ACTIVE' } }),
  ])

  return NextResponse.json({
    success: true,
    message: `Pool activated! ${contributions.length} contribution records created for ${pool.members.length} members over ${periodCount} periods.`,
    data:    { periodCount, memberCount: pool.members.length, totalRecords: contributions.length },
  })
}

// ── Mature pool ───────────────────────────────────────────────
async function handleMature(body: any): Promise<NextResponse> {
  await (prisma as any).savingsPool.update({
    where: { id: body.poolId },
    data:  { status: 'MATURED' },
  })
  return NextResponse.json({ success: true, message: 'Pool matured. Calculate and distribute payouts.' })
}

// ── Calculate & create payout records ────────────────────────
async function handleDistribute(body: any): Promise<NextResponse> {
  const pool = await (prisma as any).savingsPool.findUnique({
    where:   { id: body.poolId },
    include: { members: { include: { user: { select: { fullName: true } } } } },
  })
  if (!pool)                   return NextResponse.json({ success: false, error: 'Pool not found' }, { status: 404 })
  if (pool.status !== 'MATURED') return NextResponse.json({ success: false, error: 'Pool must be matured first' }, { status: 400 })

  const totalPool = Number(pool.totalPoolValue)
  if (totalPool <= 0) return NextResponse.json({ success: false, error: 'Pool has no value to distribute' }, { status: 400 })

  // Delete any existing draft payouts
  await (prisma as any).savingsPoolPayout.deleteMany({ where: { poolId: body.poolId, status: 'PENDING' } })

  const payouts = pool.members.filter((m: any) => m.isActive).map((m: any) => {
    const share    = Number(m.totalContributed) / Number(pool.totalContributed)
    const gross    = totalPool * share
    const deduct   = Number(m.loanBalance)
    const net      = Math.max(0, gross - deduct)
    return {
      poolId:        pool.id,
      userId:        m.userId,
      grossShare:    gross,
      loanDeduction: deduct,
      netPayout:     net,
      sharePercent:  share * 100,
      currency:      pool.currency,
    }
  })

  await (prisma as any).savingsPoolPayout.createMany({ data: payouts, skipDuplicates: true })

  return NextResponse.json({
    success: true,
    message: `Payouts calculated for ${payouts.length} members. Total pool: $${totalPool.toFixed(2)}`,
    data:    { payouts: payouts.length, totalPool },
  })
}

// ── Mark payout as paid ───────────────────────────────────────
async function handlePayoutPaid(body: any): Promise<NextResponse> {
  const { poolId, userId, paymentRef } = body
  await (prisma as any).savingsPoolPayout.update({
    where: { poolId_userId: { poolId, userId } },
    data:  { status: 'PAID', paidAt: new Date(), paymentRef },
  })

  // Check if all paid → close pool
  const unpaid = await (prisma as any).savingsPoolPayout.count({ where: { poolId, status: 'PENDING' } })
  if (unpaid === 0) {
    await (prisma as any).savingsPool.update({ where: { id: poolId }, data: { status: 'CLOSED', distributedAt: new Date() } })
  }

  return NextResponse.json({ success: true, message: unpaid === 0 ? '🎉 All payouts complete — pool closed!' : 'Payout marked as paid' })
}

// ── Add member to pool ────────────────────────────────────────
async function handleAddMember(body: any): Promise<NextResponse> {
  const { poolId, userId } = body
  const pool = await (prisma as any).savingsPool.findUnique({ where: { id: poolId } })
  if (!pool)                   return NextResponse.json({ success: false, error: 'Pool not found' }, { status: 404 })
  if (pool.status === 'CLOSED') return NextResponse.json({ success: false, error: 'Cannot add members to a closed pool' }, { status: 400 })

  await (prisma as any).savingsPoolMember.upsert({
    where:  { poolId_userId: { poolId, userId } },
    create: { poolId, userId },
    update: { isActive: true, exitedAt: null },
  })

  // If active, generate contribution schedule for new member
  if (pool.status === 'ACTIVE') {
    const now = new Date()
    const periodCount = calcPeriodCount(pool.periodMonths, pool.contributionFrequency)
    const futureContribs: any[] = []

    for (let p = 1; p <= periodCount; p++) {
      const due = calcDueDate(new Date(pool.startDate), p, pool.contributionFrequency)
      if (due >= now) {
        futureContribs.push({
          poolId, userId,
          periodNumber: p,
          dueDate:      due,
          amountDue:    pool.contributionAmount,
          currency:     pool.currency,
        })
      }
    }
    if (futureContribs.length) {
      await (prisma as any).savingsContribution.createMany({ data: futureContribs, skipDuplicates: true })
    }
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } })
  return NextResponse.json({ success: true, message: `${user?.fullName} added to pool` })
}
