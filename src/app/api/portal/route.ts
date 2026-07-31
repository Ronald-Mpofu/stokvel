// src/app/api/portal/route.ts
// Defensive version — wraps every new-model query in try/catch
// so the portal loads even if db:generate hasn't been re-run
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'

export const dynamic = 'force-dynamic'

async function safeQuery<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn() } catch { return fallback }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const userId  = searchParams.get('userId')
    const section = searchParams.get('section') || 'overview'

    if (!userId) return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 })

    // ── User ──────────────────────────────────────────────────
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, fullName: true, email: true, phone: true,
        city: true, country: true, kycStatus: true, tier: true,
        reputationScore: true, status: true, createdAt: true, role: true,
      },
    })
    if (!user) return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 })

    // ── Memberships ───────────────────────────────────────────
    const memberships = await safeQuery(() => prisma.groupMember.findMany({
      where: { userId, status: 'ACTIVE' },
      include: {
        group: {
          select: {
            id: true, name: true, currency: true,
            contributionAmount: true, contributionDay: true,
            maxMembers: true, status: true, payoutStrategy: true,
            escrowBalance: true, country: true,
            _count: { select: { members: true } },
          },
        },
      },
    }), [])

    // ── Scheme-level facts for this member ────────────────────
    //
    // WHY THIS EXISTS
    //   Contribution terms moved from Group to WindfallScheme. Group still
    //   HAS contributionAmount — it is NOT NULL and cannot be dropped yet —
    //   but it is no longer maintained, which is why the portal was showing
    //   0.00 for a member who has paid 450.
    //
    //   The passbook reads the Contribution ledger under a scheme's active
    //   cycle. This reads the same rows, so the portal and the passbook can
    //   no longer disagree about what a member has paid.
    //
    // Raw SQL because WindfallScheme and SchemeMember are not in
    // schema.prisma. One statement, LATERAL joins rather than a query per
    // scheme.
    const schemeRows = await safeQuery(() => prisma.$queryRawUnsafe(`
      SELECT
        ws.id                       AS "schemeId",
        ws.name                     AS "schemeName",
        ws."groupId"                AS "groupId",
        ws."isContributory"         AS "isContributory",
        ws."contributionAmount"     AS "contributionAmount",
        ws."contributionFrequency"  AS "contributionFrequency",
        ws."contributionDay"        AS "contributionDay",
        sm."payoutPosition"         AS "payoutPosition",
        cyc."cycleNumber"           AS "cycleNumber",
        COALESCE(agg."totalPaid", 0) AS "totalPaid",
        nd."amountDue"              AS "nextDueAmount",
        nd."dueDate"                AS "nextDueDate"
      FROM "SchemeMember" sm
      JOIN "WindfallScheme" ws ON ws.id = sm."schemeId"
      JOIN "Group" g           ON g.id  = ws."groupId"
      LEFT JOIN LATERAL (
        SELECT c.id, c."cycleNumber"
          FROM "Cycle" c
         WHERE c."schemeId" = ws.id
           AND c.status = 'ACTIVE'::"CycleStatus"
         ORDER BY c."cycleNumber" DESC
         LIMIT 1
      ) cyc ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(co."amountPaid"), 0) AS "totalPaid"
          FROM "Contribution" co
         WHERE co."cycleId" = cyc.id
           AND co."userId"  = $1::text
      ) agg ON true
      LEFT JOIN LATERAL (
        SELECT co."amountDue", co."dueDate"
          FROM "Contribution" co
         WHERE co."cycleId" = cyc.id
           AND co."userId"  = $1::text
           AND co.status NOT IN ('PAID'::"ContributionStatus",
                                 'PRE_PAID'::"ContributionStatus",
                                 'WAIVED'::"ContributionStatus")
         ORDER BY co."monthNumber"
         LIMIT 1
      ) nd ON true
      WHERE sm."userId" = $1::text
        AND sm.status <> 'EXITED'::"MemberStatus"
        AND g."deletedAt" IS NULL
    `, userId), [] as any[])

    // Per-group rollup, so a membership card can show real terms and the
    // upcoming list can show a real amount.
    const schemeByGroup: Record<string, {
      contribution: number
      day: number | null
      paid: number
      nextDueAmount: number | null
      nextDueDate: Date | null
    }> = {}

    for (const r of (schemeRows as any[])) {
      const gid = r.groupId
      if (!schemeByGroup[gid]) {
        schemeByGroup[gid] = { contribution: 0, day: null, paid: 0, nextDueAmount: null, nextDueDate: null }
      }
      const bucket = schemeByGroup[gid]
      if (r.isContributory && r.contributionAmount) {
        bucket.contribution += Number(r.contributionAmount)
        if (bucket.day === null && r.contributionDay) bucket.day = Number(r.contributionDay)
      }
      bucket.paid += Number(r.totalPaid || 0)
      // Earliest unpaid row across the group's schemes wins — that is the
      // next thing the member actually has to pay.
      if (r.nextDueDate) {
        const due = new Date(r.nextDueDate)
        if (!bucket.nextDueDate || due < bucket.nextDueDate) {
          bucket.nextDueDate = due
          bucket.nextDueAmount = Number(r.nextDueAmount || 0)
        }
      }
    }

    const schemePaidTotal = (schemeRows as any[])
      .reduce((sum: number, r: any) => sum + Number(r.totalPaid || 0), 0)

    if (section === 'overview') {
      // Transactions — exists in original schema
      const transactions = await safeQuery(() => prisma.transaction.findMany({
        where:   { userId, type: 'CONTRIBUTION' },
        orderBy: { createdAt: 'desc' },
        take:    10,
        select: {
          id: true, amount: true, currency: true, status: true,
          paymentMethod: true, reference: true, description: true,
          groupId: true, createdAt: true,
        },
      }), [])

      const totalAgg = await safeQuery(() => prisma.transaction.aggregate({
        where: { userId, type: 'CONTRIBUTION', status: 'COMPLETED' },
        _sum:  { amount: true },
      }), { _sum: { amount: null } })

      // Payout schedules — new model, may not exist in client
      const payoutSchedules = await safeQuery(() => (prisma as any).payoutSchedule.findMany({
        where:   { recipientId: userId },
        include: {
          cycle: {
            select: {
              cycleNumber: true,
              group: { select: { name: true, currency: true } },
            },
          },
        },
        orderBy: { monthNumber: 'asc' },
      }), [])

      // Asset ownerships — new model
      const assetOwnerships = await safeQuery(() => (prisma as any).assetOwnership.findMany({
        where:   { userId },
        include: {
          asset: {
            select: {
              id: true, name: true, type: true, status: true,
              currentValue: true, incomeGenerated: true,
              group: { select: { currency: true } },
            },
          },
        },
      }), [])

      // Queue entries — new model
      const queueEntries = await safeQuery(() => (prisma as any).assetQueueEntry.findMany({
        where:   { userId, status: { not: 'SKIPPED' } },
        include: {
          asset: {
            select: {
              id: true, name: true, type: true, unitCost: true,
              group: { select: { name: true, currency: true } },
            },
          },
        },
        orderBy: { position: 'asc' },
      }), [])

      // Income shares — new model
      const incomeShares = await safeQuery(() => (prisma as any).assetIncomeShare.findMany({
        where:   { userId },
        include: {
          income: {
            select: {
              type: true, incomeDate: true, description: true,
              asset: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take:    5,
      }), [])

      const totalIncome = await safeQuery(() => (prisma as any).assetIncomeShare.aggregate({
        where: { userId },
        _sum:  { shareAmount: true },
      }), { _sum: { shareAmount: null } })

      // Group name map for transactions
      const groupIds = [...new Set((transactions as any[]).map((t: any) => t.groupId).filter(Boolean))]
      const groups   = groupIds.length > 0
        ? await safeQuery(() => prisma.group.findMany({
            where:  { id: { in: groupIds as string[] } },
            select: { id: true, name: true, currency: true },
          }), [])
        : []
      const groupMap = Object.fromEntries((groups as any[]).map((g: any) => [g.id, g]))

      // ── Upcoming contributions (group monthly + savings pool dues) ──
      const now = new Date()

      // Group monthly contributions (computed from membership)
      //
      // The payId shape is deliberately unchanged — POST still receives
      // GROUP:<groupId>:<periodKey> and records the same Transaction
      // metadata. Only the AMOUNT and DUE DATE now come from the scheme
      // ledger instead of the stale Group.contributionAmount column, so
      // the Pay button keeps working exactly as before.
      //
      // A member with no scheme dues is filtered out rather than shown a
      // row for 0.00, which is what produced "AUD0.00 due in 2 days".
      const groupUpcoming = (memberships as any[]).map((m: any) => {
        const sch = schemeByGroup[m.groupId]

        // Real due row from the ledger where there is one; otherwise fall
        // back to the scheme's contribution day so a configured-but-not-yet
        // -started scheme still shows something honest.
        let next: Date
        let amount: number

        if (sch?.nextDueDate && sch.nextDueAmount !== null) {
          next   = sch.nextDueDate
          amount = sch.nextDueAmount
        } else {
          const day = sch?.day || m.group.contributionDay || 1
          next = new Date(now.getFullYear(), now.getMonth(), day)
          if (next <= now) next.setMonth(next.getMonth() + 1)
          amount = sch?.contribution || 0
        }

        const periodKey = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
        return {
          type:      'GROUP',
          payId:     `GROUP:${m.groupId}:${periodKey}`,
          groupId:   m.groupId,
          periodKey,
          groupName: m.group.name,
          currency:  m.group.currency,
          country:   m.group.country || null,
          amount,
          dueDate:   next,
          daysUntil: Math.ceil((next.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
        }
      }).filter((c: any) => c.amount > 0)

      // Savings pool contributions still owed (raw SQL — not in Prisma schema)
      const savingsRows = await safeQuery(() => prisma.$queryRawUnsafe(
        `SELECT sc.id, sc."poolId", sc."periodNumber", sc."dueDate", sc."amountDue", sc.currency,
                sp.name AS "poolName", g.country AS "groupCountry"
         FROM "SavingsContribution" sc
         JOIN "SavingsPool" sp ON sp.id = sc."poolId"
         JOIN "Group" g ON g.id = sp."groupId"
         WHERE sc."userId" = $1 AND sc.status <> 'PAID'
         ORDER BY sc."dueDate" ASC`, userId), [] as any[])

      const savingsUpcoming = (savingsRows as any[]).map((sc: any) => {
        const due = new Date(sc.dueDate)
        return {
          type:           'SAVINGS',
          payId:          `SAVINGS:${sc.id}`,
          contributionId: sc.id,
          poolId:         sc.poolId,
          periodNumber:   sc.periodNumber,
          groupName:      `${sc.poolName} · Savings`,
          currency:       sc.currency,
          country:        sc.groupCountry || null,
          amount:         Number(sc.amountDue),
          dueDate:        due,
          daysUntil:      Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
        }
      })

      // Which of these already have a submitted (pending) or completed payment?
      const payMarkers = await safeQuery(() => prisma.transaction.findMany({
        where:  { userId, type: 'CONTRIBUTION', status: { in: ['PENDING', 'COMPLETED'] } },
        select: { metadata: true },
      }), [] as any[])
      const paidKeys = new Set<string>()
      for (const t of (payMarkers as any[])) {
        const md = (t.metadata || {}) as any
        if (md.kind === 'GROUP' && md.groupId && md.periodKey)   paidKeys.add(`GROUP:${md.groupId}:${md.periodKey}`)
        if (md.kind === 'SAVINGS' && md.savingsContributionId)   paidKeys.add(`SAVINGS:${md.savingsContributionId}`)
      }

      const upcomingMerged = [...groupUpcoming, ...savingsUpcoming]
        .map((c: any) => ({ ...c, paymentSubmitted: paidKeys.has(c.payId) }))
        .sort((a: any, b: any) => a.daysUntil - b.daysUntil)

      return NextResponse.json({
        success: true,
        data: {
          user,
          memberships: (memberships as any[]).map((m: any) => ({
            groupId:        m.groupId,
            groupName:      m.group.name,
            role:           m.role,
            joinedAt:       m.joinedAt,
            currency:       m.group.currency,
            // Sum of the member's contributory schemes in this group.
            // Group.contributionAmount is retained in the database but no
            // longer maintained, so reading it showed 0.00/mo.
            contribution:   schemeByGroup[m.groupId]?.contribution
                              ?? Number(m.group.contributionAmount),
            memberCount:    m.group._count.members,
            maxMembers:     m.group.maxMembers,
            escrowBalance:  Number(m.group.escrowBalance),
            payoutStrategy: m.group.payoutStrategy,
            groupStatus:    m.group.status,
          })),
          summary: {
            // The Contribution ledger, matching the passbook. The old
            // figure summed COMPLETED Transaction rows, of which there are
            // none — contributions are recorded as Contribution rows, so
            // this read 0.00 for a member who had paid three months.
            // Falls back to the Transaction sum if no scheme rows exist,
            // so groups predating the scheme model are not zeroed out.
            totalContributed: schemePaidTotal > 0
              ? schemePaidTotal
              : Number((totalAgg as any)._sum?.amount || 0),
            totalGroups:      memberships.length,
            totalAssets:      assetOwnerships.length,
            totalIncome:      Number((totalIncome as any)._sum?.shareAmount || 0),
          },
          recentContributions: (transactions as any[]).map((t: any) => ({
            id:        t.id,
            groupName: groupMap[t.groupId]?.name || 'Unknown Group',
            currency:  t.currency,
            amount:    Number(t.amount),
            status:    t.status,
            reference: t.reference,
            description: t.description,
            createdAt: t.createdAt,
          })),
          upcomingContributions: upcomingMerged,
          payoutPositions: (payoutSchedules as any[]).map((p: any) => ({
            id:            p.id,
            groupName:     p.cycle?.group?.name || '—',
            currency:      p.cycle?.group?.currency || 'USD',
            position:      p.monthNumber,
            status:        p.status,
            payoutAmount:  Number(p.payoutAmount),
            scheduledDate: p.scheduledDate,
            cycleNumber:   p.cycle?.cycleNumber,
          })),
          assetOwnerships: (assetOwnerships as any[]).map((o: any) => ({
            assetId:      o.assetId,
            assetName:    o.asset?.name || '—',
            assetType:    o.asset?.type || 'OTHER',
            assetStatus:  o.asset?.status || '—',
            currency:     o.asset?.group?.currency || 'USD',
            ownershipPct: Number(o.ownershipPct),
            contributed:  Number(o.amountContributed),
            currentValue: Number(o.asset?.currentValue || 0),
            myValue:      Number(o.asset?.currentValue || 0) * Number(o.ownershipPct) / 100,
          })),
          queueEntries: (queueEntries as any[]).map((q: any) => ({
            assetId:      q.assetId,
            assetName:    q.asset?.name || '—',
            assetType:    q.asset?.type || 'OTHER',
            groupName:    q.asset?.group?.name || '—',
            currency:     q.asset?.group?.currency || 'USD',
            position:     q.position,
            status:       q.status,
            targetAmount: Number(q.targetAmount),
            raisedAmount: Number(q.raisedAmount),
            fundingPct:   Math.min(100, Math.round(
              Number(q.raisedAmount) / Math.max(1, Number(q.targetAmount)) * 100
            )),
            deliveredAt:  q.deliveredAt,
            serialNumber: q.serialNumber,
          })),
          recentIncome: (incomeShares as any[]).map((s: any) => ({
            id:           s.id,
            assetName:    s.income?.asset?.name || '—',
            type:         s.income?.type || '—',
            description:  s.income?.description || '—',
            shareAmount:  Number(s.shareAmount),
            ownershipPct: Number(s.ownershipPct),
            status:       s.status,
            incomeDate:   s.income?.incomeDate,
          })),
        },
      })
    }

    // ── CONTRIBUTIONS ─────────────────────────────────────────
    if (section === 'contributions') {
      const transactions = await safeQuery(() => prisma.transaction.findMany({
        where:   { userId, type: 'CONTRIBUTION' },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, amount: true, currency: true, status: true,
          paymentMethod: true, reference: true, description: true,
          groupId: true, createdAt: true,
        },
      }), [])

      const groupIds = [...new Set((transactions as any[]).map((t: any) => t.groupId).filter(Boolean))]
      const groups   = groupIds.length > 0
        ? await safeQuery(() => prisma.group.findMany({
            where:  { id: { in: groupIds as string[] } },
            select: { id: true, name: true, currency: true },
          }), [])
        : []
      const groupMap = Object.fromEntries((groups as any[]).map((g: any) => [g.id, g]))

      const byStatus = {
        completed: (transactions as any[]).filter((t: any) => t.status === 'COMPLETED').length,
        pending:   (transactions as any[]).filter((t: any) => t.status === 'PENDING').length,
        failed:    (transactions as any[]).filter((t: any) => t.status === 'FAILED').length,
      }

      return NextResponse.json({
        success: true,
        data: {
          contributions: (transactions as any[]).map((t: any) => ({
            id:            t.id,
            groupName:     groupMap[t.groupId]?.name || 'Unknown Group',
            currency:      t.currency,
            amount:        Number(t.amount),
            status:        t.status,
            paymentMethod: t.paymentMethod,
            reference:     t.reference,
            description:   t.description,
            createdAt:     t.createdAt,
          })),
          byStatus,
          totalPaid: (transactions as any[])
            .filter((t: any) => t.status === 'COMPLETED')
            .reduce((s: number, t: any) => s + Number(t.amount), 0),
        },
      })
    }

    // ── DOCUMENTS ─────────────────────────────────────────────
    if (section === 'documents') {
      const [certificates, incomeShares] = await Promise.all([
        safeQuery(() => (prisma as any).assetQueueEntry.findMany({
          where:   { userId, status: 'DELIVERED' },
          include: { asset: { select: { name: true, type: true } } },
        }), []),
        safeQuery(() => (prisma as any).assetIncomeShare.findMany({
          where:   { userId },
          include: {
            income: {
              select: {
                type: true, incomeDate: true, description: true,
                asset: { select: { name: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }), []),
      ])

      return NextResponse.json({
        success: true,
        data: {
          handoverCertificates: (certificates as any[]).map((e: any) => ({
            entryId:      e.id,
            assetName:    e.asset?.name || '—',
            assetType:    e.asset?.type || 'OTHER',
            deliveredAt:  e.deliveredAt,
            serialNumber: e.serialNumber,
          })),
          incomeStatements: (incomeShares as any[]).map((s: any) => ({
            id:          s.id,
            assetName:   s.income?.asset?.name || '—',
            type:        s.income?.type || '—',
            description: s.income?.description || '—',
            shareAmount: Number(s.shareAmount),
            status:      s.status,
            incomeDate:  s.income?.incomeDate,
          })),
        },
      })
    }

    return NextResponse.json({ success: false, error: 'Unknown section' }, { status: 400 })

  } catch (e: any) {
    console.error('Portal API error:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── POST — member records a contribution payment (record-and-verify) ──
// Creates a PENDING contribution Transaction tagged with metadata identifying
// exactly what it settles. The treasurer's existing verification flips it to
// COMPLETED. No scheme-table status is mutated here.
const PAY_METHODS = ['ECOCASH', 'MPESA', 'MTN_MOMO', 'BANK_TRANSFER', 'CARD', 'USSD', 'INTERNAL_TRANSFER']

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (body.action !== 'PAY') {
      return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 })
    }

    const { userId, type, paymentMethod, reference } = body
    if (!userId) return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 })
    if (!PAY_METHODS.includes(paymentMethod)) return NextResponse.json({ success: false, error: 'Select a valid payment method' }, { status: 400 })
    if (!reference || !String(reference).trim()) return NextResponse.json({ success: false, error: 'A payment reference is required' }, { status: 400 })

    const amount = Number(body.amount)
    if (!amount || amount <= 0) return NextResponse.json({ success: false, error: 'Invalid amount' }, { status: 400 })

    // Existing pending/completed contribution payments — for the duplicate guard
    const existing = await safeQuery(() => prisma.transaction.findMany({
      where:  { userId, type: 'CONTRIBUTION', status: { in: ['PENDING', 'COMPLETED'] } },
      select: { metadata: true },
    }), [] as any[])
    const alreadyHas = (pred: (md: any) => boolean) =>
      (existing as any[]).some((t: any) => pred((t.metadata || {}) as any))

    if (type === 'GROUP') {
      const { groupId, periodKey, groupName } = body
      if (!groupId || !periodKey) return NextResponse.json({ success: false, error: 'Missing group or period' }, { status: 400 })
      if (alreadyHas(md => md.kind === 'GROUP' && md.groupId === groupId && md.periodKey === periodKey)) {
        return NextResponse.json({ success: false, error: 'A payment for this period has already been submitted.' }, { status: 409 })
      }
      const tx = await prisma.transaction.create({
        data: {
          type: 'CONTRIBUTION', status: 'PENDING',
          amount, currency: (body.currency || 'USD'),
          paymentMethod, externalRef: String(reference).trim(),
          userId, groupId,
          description: `Monthly contribution — ${groupName || 'group'} (${periodKey})`,
          metadata: { kind: 'GROUP', groupId, periodKey },
        } as any,
        select: { id: true },
      })
      return NextResponse.json({ success: true, data: { transactionId: tx.id }, message: 'Payment submitted — pending treasurer confirmation.' })
    }

    if (type === 'SAVINGS') {
      const { contributionId } = body
      if (!contributionId) return NextResponse.json({ success: false, error: 'Missing contribution' }, { status: 400 })

      const rows = await safeQuery(() => prisma.$queryRawUnsafe(
        `SELECT sc.id, sc."poolId", sc."periodNumber", sc.currency, sc.status,
                sp."groupId", sp.name AS "poolName"
         FROM "SavingsContribution" sc
         JOIN "SavingsPool" sp ON sp.id = sc."poolId"
         WHERE sc.id = $1 AND sc."userId" = $2`, contributionId, userId), [] as any[])
      if (!(rows as any[]).length) return NextResponse.json({ success: false, error: 'Contribution not found' }, { status: 404 })
      const sc = (rows as any[])[0]
      if (sc.status === 'PAID') return NextResponse.json({ success: false, error: 'This contribution is already paid.' }, { status: 409 })
      if (alreadyHas(md => md.kind === 'SAVINGS' && md.savingsContributionId === contributionId)) {
        return NextResponse.json({ success: false, error: 'A payment for this contribution has already been submitted.' }, { status: 409 })
      }
      const tx = await prisma.transaction.create({
        data: {
          type: 'CONTRIBUTION', status: 'PENDING',
          amount, currency: (sc.currency || body.currency || 'USD'),
          paymentMethod, externalRef: String(reference).trim(),
          userId, groupId: sc.groupId,
          description: `Savings pool contribution — ${sc.poolName} · period ${sc.periodNumber}`,
          metadata: { kind: 'SAVINGS', savingsContributionId: contributionId, poolId: sc.poolId, periodNumber: sc.periodNumber },
        } as any,
        select: { id: true },
      })
      return NextResponse.json({ success: true, data: { transactionId: tx.id }, message: 'Payment submitted — pending treasurer confirmation.' })
    }

    return NextResponse.json({ success: false, error: 'Unknown contribution type' }, { status: 400 })
  } catch (e: any) {
    console.error('Portal PAY error:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
