// src/app/api/savings/route.ts — v2.3 (raw SQL — bypasses Prisma client model generation)
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'
import { randomUUID } from 'crypto'
import { sendSchemeIntroductionEmail } from '@/lib/email'
import { generateInvoicesForPool } from '@/lib/ledger/generate'
import { requireGroupManager } from '@/lib/auth'

export const dynamic = 'force-dynamic'

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
  poolType:              z.enum(['MATURITY','ROTATING']).default('MATURITY'),
  payoutStrategy:        z.enum(['SENIORITY','RANDOM','GROUP_VOTE']).default('SENIORITY'),
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
    poolType:             p.poolType || 'MATURITY',
    payoutStrategy:       p.payoutStrategy || 'SENIORITY',
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
    rotationSchedule:     p.rotationSchedule || [],
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

      const [members, loans, payouts, rotation] = await Promise.all([
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
        sql(`SELECT srp.*, u."fullName"
          FROM "SavingsRotationPayout" srp
          JOIN "User" u ON u.id = srp."userId"
          WHERE srp."poolId" = $1
          ORDER BY srp.position ASC`, [poolId]).catch(() => []),
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
      pool.rotationSchedule = (rotation as any[]).map((r: any) => ({
        id: r.id, userId: r.userId, fullName: r.fullName,
        position: Number(r.position), scheduledDate: r.scheduledDate,
        amount: Number(r.amount), currency: r.currency,
        status: r.status, paidAt: r.paidAt, paymentRef: r.paymentRef,
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

    // ── Group-manager guard (BR 4 & 6) ────────────────────────
    // Every savings mutation is scoped to a group: creation carries
    // groupId directly; actions carry poolId, resolved to its group.
    let guardGroupId: string | null = body.groupId || null
    if (!guardGroupId && body.poolId) {
      const r = await sql(`SELECT "groupId" FROM "SavingsPool" WHERE id=$1`, [body.poolId])
      guardGroupId = r[0]?.groupId ?? null
    }
    // ROTATION_PAID and PAYOUT_PAID carry neither groupId nor poolId —
    // only the id of the payout row. Without resolving the group here,
    // guardGroupId stayed null and requireGroupManager failed closed,
    // so these two actions were unreachable for anyone except a
    // SUPER_ROLE. A group's own treasurer got a 403 on their own pool.
    if (!guardGroupId && body.rotationId) {
      const r = await sql(
        `SELECT sp."groupId" FROM "SavingsRotationPayout" srp
           JOIN "SavingsPool" sp ON sp.id = srp."poolId"
          WHERE srp.id = $1`,
        [body.rotationId],
      )
      guardGroupId = r[0]?.groupId ?? null
    }
    if (!guardGroupId && body.payoutId) {
      const r = await sql(
        `SELECT sp."groupId" FROM "SavingsPoolPayout" spp
           JOIN "SavingsPool" sp ON sp.id = spp."poolId"
          WHERE spp.id = $1`,
        [body.payoutId],
      )
      guardGroupId = r[0]?.groupId ?? null
    }
    const guardErr = await requireGroupManager(req, guardGroupId)
    if (guardErr) return guardErr

    if (body.action === 'ACTIVATE')    return handleActivate(body)
    if (body.action === 'MATURE')      return handleMature(body)
    if (body.action === 'DISTRIBUTE')  return handleDistribute(body)
    if (body.action === 'PAYOUT_PAID')   return handlePayoutPaid(body)
    if (body.action === 'ROTATION_PAID') return handleRotationPaid(body)
    if (body.action === 'DELETE_POOL')   return handleDeletePool(body)
    if (body.action === 'ADD_MEMBER')  return handleAddMember(body)

    const data = createSchema.parse(body)

    // Currency AND the group's SAVINGS_POOL registry row, in one query.
    // This replaces a prisma.group.findUnique that fetched currency only —
    // same single round trip to Tokyo, one more column.
    //
    // Resolving the scheme here rather than leaving "schemeId" NULL is the
    // whole point: /api/schemes/passbook counts pools by "schemeId", so a
    // pool created without it is invisible to its own scheme and every
    // member is told no pool exists.
    const groupRows = await sql(
      `SELECT g.currency::text AS currency,
              (SELECT ws.id FROM "WindfallScheme" ws
                WHERE ws."groupId"    = g.id
                  AND ws."schemeType" = 'SAVINGS_POOL'::"WindfallSchemeType"
                ORDER BY ws."createdAt"
                LIMIT 1)              AS "schemeId"
         FROM "Group" g
        WHERE g.id = $1::text
          AND g."deletedAt" IS NULL`,
      [data.groupId]
    )
    const group = groupRows[0]
    if (!group) return NextResponse.json({ success: false, error: 'Group not found' }, { status: 404 })

    // Refuse rather than orphan. A pool with no scheme behind it looks
    // created and is unreachable — the failure mode this route already
    // produced silently. Groups seeded before the scheme seeder existed
    // are repaired by 07-backfill-windfall-schemes.sql.
    if (!group.schemeId) {
      return NextResponse.json({
        success: false,
        error: 'This group has no Savings Pool scheme registered. Run the Windfall Scheme backfill for this group, then try again.',
      }, { status: 409 })
    }

    const startDate    = new Date(data.startDate)
    const maturityDate = calcMaturityDate(startDate, data.periodMonths)
    const poolId       = randomUUID()

    await exec(
      `INSERT INTO "SavingsPool" (
        id, "groupId", "schemeId", name, description, "periodMonths", "contributionAmount",
        "contributionFrequency", "startDate", "maturityDate", status, currency,
        "interestRatePa", "maxLoanPct", "allowLoans", notes,
        "poolType", "payoutStrategy",
        "totalContributed", "totalInterestEarned", "totalPoolValue",
        "createdAt", "updatedAt"
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8::"SavingsPoolFrequency",$9,$10,'SETUP'::"SavingsPoolStatus",$11::"CurrencyCode",$12,$13,$14,$15,$16,$17,0,0,0,NOW(),NOW()
      )`,
      [poolId, data.groupId, group.schemeId, data.name, data.description || null,
       data.periodMonths, data.contributionAmount, data.contributionFrequency,
       startDate, maturityDate, group.currency,
       data.interestRatePa, data.maxLoanPct, data.allowLoans, data.notes || null,
       data.poolType, data.payoutStrategy]
    )

    // Single multi-row insert. This was a sequential loop: one round trip
    // per member to Supabase in Tokyo at ~160ms each, so a 12-member pool
    // spent ~2s here for work that is one statement.
    if (data.memberIds.length > 0) {
      const values = data.memberIds
        .map((_, i) => `($${i * 2 + 1},$${i * 2 + 2},$${data.memberIds.length * 2 + 1},0,0,0,true,NOW(),NOW())`)
        .join(', ')
      const params: any[] = []
      for (const userId of data.memberIds) params.push(randomUUID(), userId)
      params.push(poolId)

      await exec(
        `INSERT INTO "SavingsPoolMember"
           (id,"userId","poolId","totalContributed","sharePercentage","loanBalance","isActive","createdAt","updatedAt")
         VALUES ${values}
         ON CONFLICT ("poolId","userId") DO NOTHING`,
        params
      )
    }

    // Enrolment is tracked in TWO tables and nothing keeps them in sync.
    // SavingsPoolMember gates the passbook; SchemeMember gates whether the
    // scheme card on the group hub is tappable at all. Writing only the
    // first is why members sat inside a pool while their card read "not
    // enrolled" and refused to open.
    //
    // The isContributory flag and the enrolment rows go in ONE statement.
    // A data-modifying CTE always executes exactly once, so the flag is
    // still set when memberIds is empty and unnest yields no rows.
    //
    // NOT EXISTS rather than ON CONFLICT: this does not assume a unique
    // index on (schemeId, userId), and stays correct either way.
    await exec(
      `WITH flag AS (
         UPDATE "WindfallScheme"
            SET "isContributory" = true
          WHERE id = $1::text
            AND "isContributory" = false
       )
       INSERT INTO "SchemeMember" ("schemeId", "userId")
       SELECT $1::text, u
         FROM unnest($2::text[]) AS u
        WHERE NOT EXISTS (
          SELECT 1 FROM "SchemeMember" sm
           WHERE sm."schemeId" = $1::text AND sm."userId" = u
        )`,
      [group.schemeId, data.memberIds]
    )

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

  const isRotating = (pool.poolType || 'MATURITY') === 'ROTATING'
  // Rotating pools run exactly one cycle per member (each member paid once);
  // maturity pools run the schedule derived from periodMonths + frequency.
  const periodCount = isRotating
    ? members.length
    : calcPeriodCount(Number(pool.periodMonths), pool.contributionFrequency)
  // ── Contribution schedule, in ONE statement ──────────────────
  // This was a nested loop issuing members x periods sequential inserts.
  // Ten members over twelve periods is 120 round trips to Tokyo at ~160ms
  // — roughly 19 seconds, during which the admin sees a spinner and is
  // likely to click Activate again. It is now a single multi-row insert.
  let inserted = 0
  {
    const rows: string[] = []
    const params: any[] = []
    let n = 0
    for (const member of members) {
      for (let p = 1; p <= periodCount; p++) {
        const due = calcDueDate(new Date(pool.startDate), p, pool.contributionFrequency)
        rows.push(`($${n + 1},$${n + 2},$${n + 3},$${n + 4},$${n + 5},$${n + 6},0,$${n + 7}::"CurrencyCode",'PENDING'::"SavingsContributionStatus",NOW(),NOW())`)
        params.push(randomUUID(), poolId, member.userId, p, due, pool.contributionAmount, pool.currency)
        n += 7
      }
    }
    if (rows.length > 0) {
      // Chunked so a very large pool cannot exceed the parameter limit.
      // Postgres caps a statement at 65535 bound parameters; 7 per row
      // gives ~9300 rows, so 2000-row chunks stay comfortably inside it.
      const ROWS_PER_CHUNK = 2000
      const PARAMS_PER_ROW = 7
      for (let i = 0; i < rows.length; i += ROWS_PER_CHUNK) {
        const chunkRows = rows.slice(i, i + ROWS_PER_CHUNK)
        const chunkParams = params.slice(i * PARAMS_PER_ROW, (i + chunkRows.length) * PARAMS_PER_ROW)
        // Placeholder numbering restarts per chunk.
        let k = 0
        const renumbered = chunkRows.map(() => {
          const ph = `($${k + 1},$${k + 2},$${k + 3},$${k + 4},$${k + 5},$${k + 6},0,$${k + 7}::"CurrencyCode",'PENDING'::"SavingsContributionStatus",NOW(),NOW())`
          k += PARAMS_PER_ROW
          return ph
        }).join(', ')

        await exec(
          `INSERT INTO "SavingsContribution"
             (id,"poolId","userId","periodNumber","dueDate","amountDue","amountPaid",currency,status,"createdAt","updatedAt")
           VALUES ${renumbered}
           ON CONFLICT ("poolId","userId","periodNumber") DO NOTHING`,
          chunkParams
        )
        inserted += chunkRows.length
      }
    }
  }

  // ── Rotating pools: build the payout order and schedule ──
  let rotationCount = 0
  const rotationOrder: { userId: string; position: number; scheduledDate: Date }[] = []
  if (isRotating) {
    const strategy = pool.payoutStrategy || 'SENIORITY'
    const ordered  = [...members]
    if (strategy === 'RANDOM') {
      // Fisher–Yates shuffle
      for (let i = ordered.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[ordered[i], ordered[j]] = [ordered[j], ordered[i]]
      }
    } else {
      // SENIORITY (and GROUP_VOTE default until votes are cast): longest-standing first
      ordered.sort((a: any, b: any) => new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime())
    }
    const pot = Number(pool.contributionAmount) * members.length
    const rRows: string[] = []
    const rParams: any[] = []
    let rn = 0
    for (let pos = 1; pos <= ordered.length; pos++) {
      const recipient = ordered[pos - 1]
      const sched     = calcDueDate(new Date(pool.startDate), pos, pool.contributionFrequency)
      rRows.push(`($${rn + 1},$${rn + 2},$${rn + 3},$${rn + 4},$${rn + 5},$${rn + 6},$${rn + 7},'SCHEDULED',NOW(),NOW())`)
      rParams.push(randomUUID(), poolId, recipient.userId, pos, sched, pot, pool.currency)
      rn += 7
      // Held for the introduction email — each member is told their own
      // position and payout date, which only exist from this point on.
      rotationOrder.push({ userId: recipient.userId, position: pos, scheduledDate: sched })
      rotationCount++
    }
    if (rRows.length > 0) {
      await exec(
        `INSERT INTO "SavingsRotationPayout"
           (id,"poolId","userId",position,"scheduledDate",amount,currency,status,"createdAt","updatedAt")
         VALUES ${rRows.join(', ')}
         ON CONFLICT ("poolId",position) DO NOTHING`,
        rParams
      )
    }
  }

  await exec(`UPDATE "SavingsPool" SET status='ACTIVE',"updatedAt"=NOW() WHERE id=$1`, [poolId])

  // ── Raise the invoices ──────────────────────────────────────
  // Runs AFTER the schedule and rotation positions are written, because
  // it reads both: the schedule supplies each due date, the rotation
  // supplies the payee for each cycle. In a rotating pool every invoice
  // names a PERSON, not the group — member A pays whoever holds that
  // cycle's position, directly.
  //
  // Idempotent via the unique (sourceType, sourceId) index, so a retried
  // activation cannot double-bill anyone. Failures are reported, never
  // thrown: an activation that has already written payout positions must
  // not roll back because invoicing had a bad day.
  let invoicesRaised = 0
  const ledgerErrors: string[] = []
  try {
    const gen = await generateInvoicesForPool(poolId, null)
    invoicesRaised = gen.generated
    if (gen.errors.length) ledgerErrors.push(...gen.errors)
  } catch (e: any) {
    console.error('Invoice generation failed:', e?.message)
    ledgerErrors.push(e?.message || 'invoice generation failed')
  }
  if (ledgerErrors.length) console.error('Ledger errors:', ledgerErrors.slice(0, 5))

  // ── Introduction emails ─────────────────────────────────────
  // Sent AFTER the pool is committed ACTIVE, and deliberately not awaited
  // as a group: a bounced address must never roll back an activation that
  // has already written schedules and payout positions. Failures are
  // logged and reported in the response, never thrown.
  let emailsSent = 0
  const emailErrors: string[] = []
  try {
    const recipients = await sql(
      `SELECT u.id, u."fullName", u.email, g.name AS "groupName"
         FROM "SavingsPoolMember" spm
         JOIN "User"  u ON u.id = spm."userId"
         JOIN "SavingsPool" sp ON sp.id = spm."poolId"
         JOIN "Group" g ON g.id = sp."groupId"
        WHERE spm."poolId" = $1 AND spm."isActive" = true`,
      [poolId]
    )

    const posByUser = new Map(rotationOrder.map(r => [r.userId, r]))
    const groupName = recipients[0]?.groupName || ''
    const pot       = Number(pool.contributionAmount) * members.length

    // Member roster, in rotation order where there is one.
    const roster = recipients
      .map((r: any) => ({ fullName: r.fullName, position: posByUser.get(r.id)?.position ?? null }))
      .sort((a, b) => {
        if (a.position && b.position) return a.position - b.position
        if (a.position) return -1
        if (b.position) return 1
        return String(a.fullName).localeCompare(String(b.fullName))
      })

    const maxLoanAmount = pool.allowLoans
      ? Number(pool.contributionAmount) * members.length * Number(pool.periodMonths) * Number(pool.maxLoanPct)
      : null

    const results = await Promise.allSettled(
      recipients
        .filter((r: any) => r.email)
        .map((r: any) => sendSchemeIntroductionEmail({
          to:                    r.email,
          memberName:            r.fullName,
          schemeName:            pool.name,
          groupName,
          currency:              pool.currency,
          startDate:             new Date(pool.startDate),
          isRotating,
          contributionAmount:    Number(pool.contributionAmount),
          contributionFrequency: pool.contributionFrequency,
          cycleCount:            periodCount,
          potPerCycle:           pot,
          maturityDate:          isRotating ? null : new Date(pool.maturityDate),
          payoutStrategy:        isRotating ? (pool.payoutStrategy || 'SENIORITY') : null,
          payoutPosition:        posByUser.get(r.id)?.position ?? null,
          payoutDate:            posByUser.get(r.id)?.scheduledDate ?? null,
          members:               roster,
          notes:                 pool.notes || null,
          allowLoans:            !!pool.allowLoans,
          interestRatePa:        pool.allowLoans ? Number(pool.interestRatePa) : null,
          maxLoanAmount,
        }))
    )

    for (const res of results) {
      if (res.status === 'fulfilled' && res.value?.success) emailsSent++
      else if (res.status === 'fulfilled') emailErrors.push(res.value?.error || 'send failed')
      else emailErrors.push(String(res.reason?.message || 'send failed'))
    }
    if (emailErrors.length) console.error('Scheme intro email errors:', emailErrors.slice(0, 5))
  } catch (e: any) {
    console.error('Scheme intro email block failed:', e?.message)
    emailErrors.push(e?.message || 'email step failed')
  }

  const ledgerNote = invoicesRaised > 0 ? ` ${invoicesRaised} invoices raised.` : ''
  const emailNote = emailsSent > 0
    ? ` ${emailsSent} introduction ${emailsSent === 1 ? 'email' : 'emails'} sent.`
    : (emailErrors.length ? ' Introduction emails could not be sent.' : '')

  return NextResponse.json({
    success: true,
    data: { emailsSent, emailErrors, invoicesRaised, ledgerErrors },
    message: isRotating
      ? `Pool activated! ${members.length}-member rotation scheduled (${rotationCount} payouts) and ${inserted} contribution records created.${ledgerNote}${emailNote}`
      : `Pool activated! ${inserted} contribution records created for ${members.length} members over ${periodCount} periods.${ledgerNote}${emailNote}`,
  })
}

// ── Mature ────────────────────────────────────────────────────
async function handleMature(body: any): Promise<NextResponse> {
  await exec(`UPDATE "SavingsPool" SET status='MATURED',"updatedAt"=NOW() WHERE id=$1`, [body.poolId])
  return NextResponse.json({ success: true, message: 'Pool matured. Calculate and distribute payouts.' })
}

// ── Mark a rotation payout as paid ────────────────────────────
async function handleRotationPaid(body: any): Promise<NextResponse> {
  const { rotationId } = body
  if (!rotationId) return NextResponse.json({ success: false, error: 'rotationId required' }, { status: 400 })
  const rows = await sql(`SELECT id, status FROM "SavingsRotationPayout" WHERE id=$1`, [rotationId])
  if (!rows.length) return NextResponse.json({ success: false, error: 'Rotation payout not found' }, { status: 404 })
  if (rows[0].status === 'PAID') return NextResponse.json({ success: false, error: 'This payout is already marked paid' }, { status: 409 })
  await exec(
    `UPDATE "SavingsRotationPayout" SET status='PAID', "paidAt"=NOW(), "paymentRef"=$2, "updatedAt"=NOW() WHERE id=$1`,
    [rotationId, body.paymentRef || null]
  )

  // ── Net off the recipient's own contribution ────────────────
  // This group's rule is that the cycle's recipient still contributes —
  // which is what makes the pot arithmetic hold, since the pot is
  // contribution x ALL members. But they do not transfer money to
  // themselves and receive it back. Their share is retained out of the
  // pot, so the invoice is settled here, at payout, by an internal
  // transfer rather than by anyone attesting a payment.
  //
  // Done AFTER the payout is marked paid, and non-fatally: a netting
  // failure must not undo a payout that has already been recorded.
  let netted = 0
  try {
    const detail = await sql(
      `SELECT srp."userId", srp.position, sp."groupId", sp.currency
         FROM "SavingsRotationPayout" srp
         JOIN "SavingsPool" sp ON sp.id = srp."poolId"
        WHERE srp.id = $1 LIMIT 1`,
      [rotationId],
    )
    if (detail.length) {
      const { userId, position, groupId, currency } = detail[0]

      const selfInvoices = await sql(
        `SELECT id, total, "amountAllocated", (total - "amountAllocated") AS outstanding
           FROM "LedgerInvoice"
          WHERE "payerId" = $1 AND "payeeId" = $1
            AND "groupId" = $2 AND "periodNumber" = $3
            AND status IN ('ISSUED','DUE','PART_PAID','OVERDUE')
            AND (total - "amountAllocated") > 0`,
        [userId, groupId, Number(position)],
      )

      for (const inv of selfInvoices) {
        const amount = Number(inv.outstanding)
        const num = await sql(`SELECT * FROM next_ledger_number($1, 'PAYMENT', 'PAY')`, [groupId])
        const paymentId = randomUUID()

        await exec(
          `INSERT INTO "LedgerPayment" (
             id, "groupId", "paymentNumber", "paymentSeq", "payerId", "payeeType", "payeeId",
             currency, amount, "amountAllocated", method, reference, status, "recordedBy",
             "paidAt", "confirmedAt", "confirmedBy", "confirmNote"
           ) VALUES (
             $1,$2,$3,$4,$5,'MEMBER',$5,$6,$7,$7,'INTERNAL_TRANSFER',$8,
             'CONFIRMED','TREASURER',NOW(),NOW(),'TREASURER',
             'Own share retained from payout - netted, no transfer made'
           )`,
          [paymentId, groupId, String(num[0].formatted), Number(num[0].seq), userId, currency, amount, `NET-${rotationId.slice(0, 8)}`],
        )

        await exec(
          `INSERT INTO "LedgerAllocation" (id, "paymentId", "invoiceId", amount)
           VALUES ($1,$2,$3,$4) ON CONFLICT ("paymentId","invoiceId") DO NOTHING`,
          [randomUUID(), paymentId, inv.id, amount],
        )

        await exec(
          `UPDATE "LedgerInvoice"
              SET "amountAllocated" = total, status = 'PAID',
                  "settledAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
            WHERE id = $1`,
          [inv.id],
        )
        netted++
      }
    }
  } catch (e: any) {
    console.error('Self-contribution netting failed:', e?.message)
  }

  return NextResponse.json({
    success: true,
    data: { netted },
    message: netted > 0
      ? `Rotation payout marked as paid. The recipient’s own share was netted off.`
      : 'Rotation payout marked as paid.',
  })
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
    const pyId   = randomUUID()
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

  const memberId = randomUUID()

  // Both membership tables in one statement. The pool row gates the
  // passbook, the SchemeMember row gates the hub card — a member written
  // to only the first is enrolled in a book they cannot reach.
  //
  // reactivate and the INSERT cover disjoint cases against the same
  // snapshot: a row that exists is un-exited, a row that does not is
  // created. pool."schemeId" can be NULL on pools predating the backfill,
  // so both are guarded on it.
  await exec(
    `WITH pm AS (
       INSERT INTO "SavingsPoolMember" (id,"poolId","userId","totalContributed","sharePercentage","loanBalance","isActive","createdAt","updatedAt")
       VALUES ($1,$2,$3,0,0,0,true,NOW(),NOW())
       ON CONFLICT ("poolId","userId") DO UPDATE SET "isActive"=true,"exitedAt"=NULL,"updatedAt"=NOW()
     ),
     reactivate AS (
       UPDATE "SchemeMember"
          SET status = 'ACTIVE'::"MemberStatus", "exitedAt" = NULL, "updatedAt" = NOW()
        WHERE $4::text IS NOT NULL
          AND "schemeId" = $4::text
          AND "userId"   = $3::text
     )
     INSERT INTO "SchemeMember" ("schemeId", "userId")
     SELECT $4::text, $3::text
      WHERE $4::text IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "SchemeMember" sm
           WHERE sm."schemeId" = $4::text AND sm."userId" = $3::text
        )`,
    [memberId, poolId, userId, pool.schemeId || null]
  )

  if (pool.status === 'ACTIVE') {
    const now = new Date()
    const periodCount = calcPeriodCount(Number(pool.periodMonths), pool.contributionFrequency)

    // One statement, not one per period. This was a sequential loop: a
    // 36-month pool joined at the start issued 36 round trips to Tokyo at
    // ~160ms each — nearly six seconds for work Postgres does in one.
    // Same pattern already applied to pool activation.
    const rows: { p: number; due: Date }[] = []
    for (let p = 1; p <= periodCount; p++) {
      const due = calcDueDate(new Date(pool.startDate), p, pool.contributionFrequency)
      if (due >= now) rows.push({ p, due })
    }

    if (rows.length > 0) {
      // 5 params per row; poolId, userId, amountDue and currency are
      // shared and appended once at the end.
      const base = rows.length * 3
      const values = rows
        .map((_, i) => `($${i * 3 + 1},$${base + 1},$${base + 2},$${i * 3 + 2},$${i * 3 + 3},$${base + 3},0,$${base + 4}::"CurrencyCode",'PENDING'::"SavingsContributionStatus",NOW(),NOW())`)
        .join(', ')

      const params: any[] = []
      for (const r of rows) params.push(randomUUID(), r.p, r.due)
      params.push(poolId, userId, pool.contributionAmount, pool.currency)

      try {
        await exec(
          `INSERT INTO "SavingsContribution" (id,"poolId","userId","periodNumber","dueDate","amountDue","amountPaid",currency,status,"createdAt","updatedAt")
           VALUES ${values}
           ON CONFLICT ("poolId","userId","periodNumber") DO NOTHING`,
          params
        )
      } catch (e: any) {
        console.error('handleAddMember contribution seed failed:', e?.message)
      }
    }
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } })
  return NextResponse.json({ success: true, message: `${user?.fullName} added to pool` })
}

// ── Delete pool (temporary hard-delete — remove before go-live) ──
async function handleDeletePool(body: any): Promise<NextResponse> {
  const { poolId } = body
  if (!poolId) return NextResponse.json({ success: false, error: 'poolId required' }, { status: 400 })
  const rows = await sql(`SELECT id, name FROM "SavingsPool" WHERE id=$1`, [poolId])
  if (!rows.length) return NextResponse.json({ success: false, error: 'Pool not found' }, { status: 404 })
  const poolName = rows[0].name
  await exec(`DELETE FROM "SavingsRotationPayout" WHERE "poolId"=$1`, [poolId])
  await exec(`DELETE FROM "SavingsPoolPayout"     WHERE "poolId"=$1`, [poolId])
  await exec(`DELETE FROM "SavingsContribution"   WHERE "poolId"=$1`, [poolId])
  try { await exec(`DELETE FROM "SavingsLoanRepayment" WHERE "loanId" IN (SELECT id FROM "SavingsLoan" WHERE "poolId"=$1)`, [poolId]) } catch {}
  try { await exec(`DELETE FROM "SavingsLoan"     WHERE "poolId"=$1`, [poolId]) } catch {}
  await exec(`DELETE FROM "SavingsPoolMember"     WHERE "poolId"=$1`, [poolId])
  await exec(`DELETE FROM "SavingsPool"           WHERE id=$1`,       [poolId])
  return NextResponse.json({ success: true, message: `"${poolName}" has been permanently deleted.` })
}
