// src/app/api/savings/route.ts — v2.2 (raw SQL — bypasses Prisma client model generation)
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'

async function sql(query: string, params: any[] = []) {
  return prisma.$queryRawUnsafe(query, ...params) as Promise<any[]>
}
async function exec(query: string, params: any[] = []) {
  return prisma.$executeRawUnsafe(query, ...params)
}

const createSchema = z.object({
  groupId:               z.string().uuid(),
  name:                  z.string().min(2),
  description:           z.string().nullish().transform(v => v || undefined),
  periodMonths:          z.coerce.number().int().min(1).max(120),
  contributionAmount:    z.coerce.number().positive(),
  contributionFrequency: z.enum(['WEEKLY','FORTNIGHTLY','MONTHLY']).default('MONTHLY'),
  startDate:             z.string(),
  interestRatePa:        z.coerce.number().min(0).max(1).default(0.24),
  maxLoanPct:            z.coerce.number().min(0).max(1).default(0.50),
  allowLoans:            z.boolean().default(true),
  notes:                 z.string().nullish().transform(v => v || undefined),
  memberIds:             z.array(z.string().uuid()).nullish().transform(v => (v || []).filter(Boolean)),
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
  if (frequency === 'WEEKLY')           d.setDate(d.getDate() + (periodNum - 1) * 7)
  else if (frequency === 'FORTNIGHTLY') d.setDate(d.getDate() + (periodNum - 1) * 14)
  else                                  d.setMonth(d.getMonth() + (periodNum - 1))
  return d
}

function formatPool(p: any) {
  const now       = new Date()
  const start     = new Date(p.startDate)
  const maturity  = new Date(p.maturityDate)
  const totalDays = maturity.getTime() - start.getTime()
  const elapsed   = Math.max(0, now.getTime() - start.getTime())

  return {
    id:                   p.id,
    groupId:              p.groupId,
    groupName:            p.groupName,
    currency:             p.groupCurrency || p.currency || 'USD',
    name:                 p.name,
    description:          p.description,
    periodMonths:         Number(p.periodMonths),
    contributionAmount:   Number(p.contributionAmount),
    contributionFrequency: p.contributionFrequency,
    startDate:            p.startDate,
    maturityDate:         p.maturityDate,
    status:               p.status,
    interestRatePa:       Number(p.interestRatePa),
    interestRatePct:      (Number(p.interestRatePa) * 100).toFixed(1),
    maxLoanPct:           Number(p.maxLoanPct),
    allowLoans:           p.allowLoans,
    totalContributed:     Number(p.totalContributed || 0),
    totalInterestEarned:  Number(p.totalInterestEarned || 0),
    totalPoolValue:       Number(p.totalPoolValue || 0),
    distributedAt:        p.distributedAt,
    notes:                p.notes,
    memberCount:          Number(p.memberCount || 0),
    timeProgress:         totalDays > 0 ? Math.min(100, Math.round(elapsed / totalDays * 100)) : 0,
    daysLeft:             Math.max(0, Math.ceil((maturity.getTime() - now.getTime()) / 86400000)),
    createdAt:            p.createdAt,
    members:              p.members || [],
    loans:                p.loans   || [],
    payouts:              p.payouts || [],
  }
}

// ── GET ───────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const groupId = searchParams.get('groupId')
    const poolId  = searchParams.get('poolId')

    if (poolId) {
      const pools = await sql(
        `SELECT sp.*, g.name as "groupName", g.currency as "groupCurrency",
          (SELECT COUNT(*) FROM "SavingsPoolMember" WHERE "poolId" = sp.id) as "memberCount"
         FROM "SavingsPool" sp
         JOIN "Group" g ON g.id = sp."groupId"
         WHERE sp.id = $1`, [poolId]
      )

      if (!pools.length) return NextResponse.json({ success: false, error: 'Pool not found' }, { status: 404 })
      const pool = pools[0]

      const [members, loans, payouts] = await Promise.all([
        sql(`SELECT spm.*, u."fullName", u.email, u.tier
          FROM "SavingsPoolMember" spm
          JOIN "User" u ON u.id = spm."userId"
          WHERE spm."poolId" = $1
          ORDER BY spm."totalContributed" DESC`, [poolId]),
        sql(`SELECT sl.*, u."fullName" as "borrowerName"
          FROM "SavingsLoan" sl
          JOIN "User" u ON u.id = sl."borrowerId"
          WHERE sl."poolId" = $1
          ORDER BY sl."createdAt" DESC`, [poolId]),
        sql(`SELECT spp.*, u."fullName"
          FROM "SavingsPoolPayout" spp
          JOIN "User" u ON u.id = spp."userId"
          WHERE spp."poolId" = $1
          ORDER BY spp."netPayout" DESC`, [poolId]),
      ])

      pool.members = members.map(m => ({
        userId: m.userId, fullName: m.fullName, email: m.email, tier: m.tier,
        totalContributed: Number(m.totalContributed), sharePercentage: Number(m.sharePercentage),
        loanBalance: Number(m.loanBalance), isActive: m.isActive, joinedAt: m.joinedAt,
      }))
      pool.loans = loans.map(l => ({
        id: l.id, borrowerId: l.borrowerId, borrowerName: l.borrowerName,
        amount: Number(l.amount), outstandingBalance: Number(l.outstandingBalance),
        status: l.status, disbursedAt: l.disbursedAt, termMonths: Number(l.termMonths),
        interestRatePct: (Number(l.interestRatePa)*100).toFixed(1),
      }))
      pool.payouts = payouts.map(p => ({
        userId: p.userId, fullName: p.fullName,
        grossShare: Number(p.grossShare), loanDeduction: Number(p.loanDeduction),
        netPayout: Number(p.netPayout), sharePercent: Number(p.sharePercent),
        status: p.status, paidAt: p.paidAt,
      }))

      return NextResponse.json({ success: true, data: formatPool(pool) })
    }

    const whereSql = groupId ? `WHERE sp."groupId" = $1` : ''
    const params   = groupId ? [groupId] : []
    const pools = await sql(
      `SELECT sp.*, g.name as "groupName", g.currency as "groupCurrency",
        (SELECT COUNT(*) FROM "SavingsPoolMember" WHERE "poolId" = sp.id) as "memberCount"
       FROM "SavingsPool" sp
       JOIN "Group" g ON g.id = sp."groupId"
       ${whereSql}
       ORDER BY sp."createdAt" DESC`, params
    )

    const summary = {
      total:      pools.length,
      active:     pools.filter(p => p.status === 'ACTIVE').length,
      matured:    pools.filter(p => p.status === 'MATURED').length,
      totalValue: pools.reduce((s, p) => s + Number(p.totalPoolValue || 0), 0),
    }

    return NextResponse.json({ success: true, data: { pools: pools.map(formatPool), summary } })
  } catch (e: any) {
    console.error('GET /api/savings error:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── POST ──────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (body.action === 'ACTIVATE')    return handleActivate(body)
    if (body.action === 'MATURE')      return handleMature(body)
    if (body.action === 'DISTRIBUTE')  return handleDistribute(body)
    if (body.action === 'PAYOUT_PAID') return handlePayoutPaid(body)
    if (body.action === 'ADD_MEMBER')  return handleAddMember(body)

    const data = createSchema.parse(body)

    const group = await prisma.group.findUnique({
      where:  { id: data.groupId },
      select: { currency: true },
    })
    if (!group) return NextResponse.json({ success: false, error: 'Group not found' }, { status: 404 })

    const startDate    = new Date(data.startDate)
    const maturityDate = calcMaturityDate(startDate, data.periodMonths)
    const poolId       = crypto.randomUUID()

    await exec(
      `INSERT INTO "SavingsPool" (
        id, "groupId", name, description, "periodMonths", "contributionAmount",
        "contributionFrequency", "startDate", "maturityDate", status, currency,
        "interestRatePa", "maxLoanPct", "allowLoans", notes,
        "totalContributed", "totalInterestEarned", "totalPoolValue",
        "createdAt", "updatedAt"
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7::"SavingsPoolFrequency",$8,$9,'SETUP'::"SavingsPoolStatus",$10::"CurrencyCode",$11,$12,$13,$14,0,0,0,NOW(),NOW()
      )`,
      [poolId, data.groupId, data.name, data.description || null,
       data.periodMonths, data.contributionAmount, data.contributionFrequency,
       startDate, maturityDate, group.currency,
       data.interestRatePa, data.maxLoanPct, data.allowLoans, data.notes || null]
    )

    if (data.memberIds.length > 0) {
      for (const userId of data.memberIds) {
        const memberId = crypto.randomUUID()
        await exec(
          `INSERT INTO "SavingsPoolMember" (id,"poolId","userId","totalContributed","sharePercentage","loanBalance","isActive","createdAt","updatedAt")
           VALUES ($1,$2,$3,0,0,0,true,NOW(),NOW()) ON CONFLICT ("poolId","userId") DO NOTHING`,
          [memberId, poolId, userId]
        )
      }
    }

    return NextResponse.json({
      success: true,
      data:    { id: poolId },
      message: `"${data.name}" savings pool created.${data.memberIds.length > 0 ? ` ${data.memberIds.length} members enrolled.` : ''} Click Activate to start.`,
    }, { status: 201 })

  } catch (e: any) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: e.errors.map(x => x.message).join('; ') }, { status: 400 })
    }
    console.error('POST /api/savings error:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── Activate ──────────────────────────────────────────────────
async function handleActivate(body: any): Promise<NextResponse> {
  const { poolId } = body
  const pools = await sql(`SELECT * FROM "SavingsPool" WHERE id=$1`, [poolId])
  if (!pools.length) return NextResponse.json({ success: false, error: 'Pool not found' }, { status: 404 })
  const pool = pools[0]
  if (pool.status !== 'SETUP') return NextResponse.json({ success: false, error: 'Pool is already active' }, { status: 400 })

  const members = await sql(`SELECT * FROM "SavingsPoolMember" WHERE "poolId"=$1`, [poolId])
  if (!members.length) return NextResponse.json({ success: false, error: 'Add at least one member before activating' }, { status: 400 })

  const periodCount = calcPeriodCount(Number(pool.periodMonths), pool.contributionFrequency)
  let inserted = 0

  for (const member of members) {
    for (let p = 1; p <= periodCount; p++) {
      const cId = crypto.randomUUID()
      const due = calcDueDate(new Date(pool.startDate), p, pool.contributionFrequency)
      try {
        await exec(
          `INSERT INTO "SavingsContribution" (id,"poolId","userId","periodNumber","dueDate","amountDue","amountPaid",currency,status,"createdAt","updatedAt")
           VALUES ($1,$2,$3,$4,$5,$6,0,$7::"CurrencyCode",'PENDING'::"SavingsContributionStatus",NOW(),NOW()) ON CONFLICT ("poolId","userId","periodNumber") DO NOTHING`,
          [cId, poolId, member.userId, p, due, pool.contributionAmount, pool.currency]
        )
        inserted++
      } catch {}
    }
  }

  await exec(`UPDATE "SavingsPool" SET status='ACTIVE',"updatedAt"=NOW() WHERE id=$1`, [poolId])

  return NextResponse.json({
    success: true,
    message: `Pool activated! ${inserted} contribution records created for ${members.length} members over ${periodCount} periods.`,
  })
}

// ── Mature ────────────────────────────────────────────────────
async function handleMature(body: any): Promise<NextResponse> {
  await exec(`UPDATE "SavingsPool" SET status='MATURED',"updatedAt"=NOW() WHERE id=$1`, [body.poolId])
  return NextResponse.json({ success: true, message: 'Pool matured. Calculate and distribute payouts.' })
}

// ── Distribute / calculate payouts ───────────────────────────
async function handleDistribute(body: any): Promise<NextResponse> {
  const pools = await sql(`SELECT * FROM "SavingsPool" WHERE id=$1`, [body.poolId])
  if (!pools.length) return NextResponse.json({ success: false, error: 'Pool not found' }, { status: 404 })
  const pool = pools[0]
  if (pool.status !== 'MATURED') return NextResponse.json({ success: false, error: 'Pool must be matured first' }, { status: 400 })

  const totalPool = Number(pool.totalPoolValue)
  if (totalPool <= 0) return NextResponse.json({ success: false, error: 'Pool has no value to distribute' }, { status: 400 })

  await exec(`DELETE FROM "SavingsPoolPayout" WHERE "poolId"=$1 AND status='PENDING'`, [body.poolId])

  const members = await sql(`SELECT * FROM "SavingsPoolMember" WHERE "poolId"=$1 AND "isActive"=true`, [body.poolId])
  const totalContrib = Number(pool.totalContributed) || 1

  for (const m of members) {
    const share  = Number(m.totalContributed) / totalContrib
    const gross  = totalPool * share
    const deduct = Number(m.loanBalance)
    const net    = Math.max(0, gross - deduct)
    const pyId   = crypto.randomUUID()
    await exec(
      `INSERT INTO "SavingsPoolPayout" (id,"poolId","userId","grossShare","loanDeduction","netPayout","sharePercent",currency,status,"createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::"CurrencyCode",'PENDING'::"SavingsPayoutStatus",NOW()) ON CONFLICT ("poolId","userId") DO NOTHING`,
      [pyId, body.poolId, m.userId, gross, deduct, net, share*100, pool.currency]
    )
  }

  return NextResponse.json({
    success: true,
    message: `Payouts calculated for ${members.length} members. Total pool: $${totalPool.toFixed(2)}`,
  })
}

// ── Payout paid ───────────────────────────────────────────────
async function handlePayoutPaid(body: any): Promise<NextResponse> {
  const { poolId, userId, paymentRef } = body
  await exec(
    `UPDATE "SavingsPoolPayout" SET status='PAID',"paidAt"=NOW(),"paymentRef"=$1 WHERE "poolId"=$2 AND "userId"=$3`,
    [paymentRef || null, poolId, userId]
  )
  const unpaid = await sql(`SELECT COUNT(*) as cnt FROM "SavingsPoolPayout" WHERE "poolId"=$1 AND status='PENDING'`, [poolId])

  if (Number(unpaid[0].cnt) === 0) {
    await exec(`UPDATE "SavingsPool" SET status='CLOSED',"distributedAt"=NOW(),"updatedAt"=NOW() WHERE id=$1`, [poolId])
    return NextResponse.json({ success: true, message: '🎉 All payouts complete — pool closed!' })
  }
  return NextResponse.json({ success: true, message: 'Payout marked as paid' })
}

// ── Add member ────────────────────────────────────────────────
async function handleAddMember(body: any): Promise<NextResponse> {
  const { poolId, userId } = body
  const pools = await sql(`SELECT * FROM "SavingsPool" WHERE id=$1`, [poolId])
  if (!pools.length) return NextResponse.json({ success: false, error: 'Pool not found' }, { status: 404 })
  const pool = pools[0]
  if (pool.status === 'CLOSED') return NextResponse.json({ success: false, error: 'Cannot add members to a closed pool' }, { status: 400 })

  const memberId = crypto.randomUUID()
  await exec(
    `INSERT INTO "SavingsPoolMember" (id,"poolId","userId","totalContributed","sharePercentage","loanBalance","isActive","createdAt","updatedAt")
     VALUES ($1,$2,$3,0,0,0,true,NOW(),NOW())
     ON CONFLICT ("poolId","userId") DO UPDATE SET "isActive"=true,"exitedAt"=NULL,"updatedAt"=NOW()`,
    [memberId, poolId, userId]
  )

  if (pool.status === 'ACTIVE') {
    const now = new Date()
    const periodCount = calcPeriodCount(Number(pool.periodMonths), pool.contributionFrequency)
    for (let p = 1; p <= periodCount; p++) {
      const due = calcDueDate(new Date(pool.startDate), p, pool.contributionFrequency)
      if (due >= now) {
        const cId = crypto.randomUUID()
        try {
          await exec(
            `INSERT INTO "SavingsContribution" (id,"poolId","userId","periodNumber","dueDate","amountDue","amountPaid",currency,status,"createdAt","updatedAt")
             VALUES ($1,$2,$3,$4,$5,$6,0,$7::"CurrencyCode",'PENDING'::"SavingsContributionStatus",NOW(),NOW()) ON CONFLICT ("poolId","userId","periodNumber") DO NOTHING`,
            [cId, poolId, userId, p, due, pool.contributionAmount, pool.currency]
          )
        } catch {}
      }
    }
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } })
  return NextResponse.json({ success: true, message: `${user?.fullName} added to pool` })
}
