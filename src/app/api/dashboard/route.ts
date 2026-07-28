// src/app/api/dashboard/route.ts
// GET — everything the Overview tab needs in ONE request AND ONE query.
//
// Version 2.0 — performance pass. RESPONSE SHAPE IS UNCHANGED.
// OverviewPage in dashboard/page.tsx needs no edits.
//
// WHY THIS CHANGED
//   v1 used Promise.all across 9 queries. That reads as parallel, but
//   with connection_limit=1 on the Supabase pooler (required for
//   serverless) Prisma holds a single connection, so all 9 queued and
//   ran sequentially. Plus getSessionFromRequest made a 10th.
//   10 round trips × ~160ms cross-region ≈ 1.6s inside one request.
//
//   v2 is ONE statement. Every aggregate is a scalar subquery; the two
//   lists come back as json_agg. Connection limit no longer matters
//   because there is nothing to queue.
//
//   The scoped-groups set is a MATERIALIZED CTE, computed once instead
//   of being re-executed by each of the 7 aggregates.
//
//   Authorisation now reads JWT claims (zero queries) instead of
//   loading the user row. Requires src/lib/auth v2.
//
// Role scoping (BR 1 & 4): SYSTEM_ADMIN / NATIONAL_ADMIN / AUDITOR see
// platform-wide totals; everyone else sees totals ONLY for groups they
// manage (creator, or ACTIVE GROUP_ADMIN member role).
//
// NOTE: sums span groups regardless of currency — fine while testing in
// one currency; revisit with ExchangeRate conversion when groups go
// multi-currency.

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'
import { getClaimsFromRequest, unauthorized } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const SEES_ALL = ['SYSTEM_ADMIN', 'NATIONAL_ADMIN', 'AUDITOR']

type ActivityRow = {
  action: string
  description: string | null
  createdAt: string
  fullName: string | null
}

type ScheduleRow = {
  monthNumber: number
  scheduledDate: string
  payoutAmount: string | number
  status: string
  recipientName: string | null
  groupName: string | null
}

type DashboardRow = {
  activeGroups: number
  escrowBalance: string | null
  insurancePool: string | null
  totalMembers: number
  monthlyPool: string | null
  payoutsCompleted: number
  paidOut: string | null
  platformRevenue: string | null
  activeLoans: number
  totalCollected: string | null
  recentActivity: ActivityRow[] | null
  payoutSchedule: ScheduleRow[] | null
}

// $1 = caller userId (text)
// $2 = seesAll (boolean) — when true every scope predicate short-circuits,
//      reproducing v1's behaviour of applying no filter at all for
//      platform-wide roles. This matters: v1's unscoped activity feed
//      included AuditLog rows with a NULL groupId (logins, user
//      creation). Filtering those through the CTE would have silently
//      dropped them.
const DASHBOARD_SQL = `
WITH scoped AS MATERIALIZED (
  SELECT g."id"
  FROM "Group" g
  WHERE $2::boolean IS NOT TRUE
    AND g."deletedAt" IS NULL
    AND (
      g."adminUserId" = $1::text
      OR EXISTS (
        SELECT 1 FROM "GroupMember" gm
        WHERE gm."groupId" = g."id"
          AND gm."userId"  = $1::text
          AND gm."role"    = 'GROUP_ADMIN'
          AND gm."status"  = 'ACTIVE'
      )
    )
)
SELECT
  -- ── Groups: count, escrow, insurance ────────────────────────
  (SELECT COUNT(*) FILTER (WHERE g."status" = 'ACTIVE')::int
     FROM "Group" g
    WHERE g."deletedAt" IS NULL
      AND ($2::boolean IS TRUE OR g."id" IN (SELECT "id" FROM scoped))
  ) AS "activeGroups",

  (SELECT COALESCE(SUM(g."escrowBalance"), 0)
     FROM "Group" g
    WHERE g."deletedAt" IS NULL
      AND ($2::boolean IS TRUE OR g."id" IN (SELECT "id" FROM scoped))
  ) AS "escrowBalance",

  (SELECT COALESCE(SUM(g."insurancePoolBalance"), 0)
     FROM "Group" g
    WHERE g."deletedAt" IS NULL
      AND ($2::boolean IS TRUE OR g."id" IN (SELECT "id" FROM scoped))
  ) AS "insurancePool",

  -- ── Members ─────────────────────────────────────────────────
  (SELECT COUNT(DISTINCT gm."userId")::int
     FROM "GroupMember" gm
    WHERE gm."status" = 'ACTIVE'
      AND ($2::boolean IS TRUE OR gm."groupId" IN (SELECT "id" FROM scoped))
  ) AS "totalMembers",

  -- ── Cycles ──────────────────────────────────────────────────
  (SELECT COALESCE(SUM(cy."poolAmount"), 0)
     FROM "Cycle" cy
    WHERE cy."status" = 'ACTIVE'
      AND ($2::boolean IS TRUE OR cy."groupId" IN (SELECT "id" FROM scoped))
  ) AS "monthlyPool",

  -- ── Payouts ─────────────────────────────────────────────────
  (SELECT COUNT(*) FILTER (WHERE po."status" = 'COMPLETED')::int
     FROM "Payout" po
    WHERE ($2::boolean IS TRUE OR po."cycleId" IN (
            SELECT cy."id" FROM "Cycle" cy
             WHERE cy."groupId" IN (SELECT "id" FROM scoped)))
  ) AS "payoutsCompleted",

  (SELECT COALESCE(SUM(po."amount") FILTER (WHERE po."status" = 'COMPLETED'), 0)
     FROM "Payout" po
    WHERE ($2::boolean IS TRUE OR po."cycleId" IN (
            SELECT cy."id" FROM "Cycle" cy
             WHERE cy."groupId" IN (SELECT "id" FROM scoped)))
  ) AS "paidOut",

  -- ── Platform revenue ────────────────────────────────────────
  (SELECT COALESCE(SUM(t."amount"), 0)
     FROM "Transaction" t
    WHERE t."type" = 'FEE'
      AND t."status" = 'COMPLETED'
      AND ($2::boolean IS TRUE OR t."groupId" IN (SELECT "id" FROM scoped))
  ) AS "platformRevenue",

  -- ── Loans ───────────────────────────────────────────────────
  (SELECT COUNT(*)::int
     FROM "Loan" l
    WHERE l."status" IN ('ACTIVE', 'DISBURSED')
      AND ($2::boolean IS TRUE OR l."groupId" IN (SELECT "id" FROM scoped))
  ) AS "activeLoans",

  -- ── Contributions ───────────────────────────────────────────
  (SELECT COALESCE(SUM(co."amountPaid"), 0)
     FROM "Contribution" co
    WHERE ($2::boolean IS TRUE OR co."cycleId" IN (
            SELECT cy."id" FROM "Cycle" cy
             WHERE cy."groupId" IN (SELECT "id" FROM scoped)))
  ) AS "totalCollected",

  -- ── Recent activity (list) ──────────────────────────────────
  (SELECT COALESCE(json_agg(x ORDER BY x."createdAt" DESC), '[]'::json)
     FROM (
       SELECT a."action", a."description", a."createdAt", u."fullName"
         FROM "AuditLog" a
         LEFT JOIN "User" u ON u."id" = a."userId"
        WHERE ($2::boolean IS TRUE OR a."groupId" IN (SELECT "id" FROM scoped))
        ORDER BY a."createdAt" DESC
        LIMIT 6
     ) x
  ) AS "recentActivity",

  -- ── Payout schedule (list) ──────────────────────────────────
  (SELECT COALESCE(json_agg(y ORDER BY y."scheduledDate" ASC), '[]'::json)
     FROM (
       SELECT ps."monthNumber", ps."scheduledDate", ps."payoutAmount",
              ps."status", u."fullName" AS "recipientName",
              g."name" AS "groupName"
         FROM "PayoutSchedule" ps
         JOIN "Cycle" c ON c."id" = ps."cycleId" AND c."status" = 'ACTIVE'
         JOIN "Group" g ON g."id" = c."groupId"
         JOIN "User"  u ON u."id" = ps."recipientId"
        WHERE ($2::boolean IS TRUE OR c."groupId" IN (SELECT "id" FROM scoped))
        ORDER BY ps."scheduledDate" ASC
        LIMIT 12
     ) y
  ) AS "payoutSchedule"
`

export async function GET(req: NextRequest) {
  const t0 = Date.now()

  try {
    // Zero queries — verified JWT claims carry id and role.
    const claims = await getClaimsFromRequest(req)
    if (!claims) return unauthorized()

    const seesAll = SEES_ALL.includes(claims.role)

    const rows = await prisma.$queryRawUnsafe<DashboardRow[]>(
      DASHBOARD_SQL,
      claims.id,
      seesAll
    )
    const d = rows[0] || ({} as DashboardRow)

    const num = (v: unknown) => Number(v ?? 0)

    const activity = Array.isArray(d.recentActivity) ? d.recentActivity : []
    const schedule = Array.isArray(d.payoutSchedule) ? d.payoutSchedule : []

    console.log('GET /api/dashboard db_ms=', Date.now() - t0, 'scope=', seesAll ? 'ALL' : 'SCOPED')

    return NextResponse.json({
      success: true,
      data: {
        stats: {
          activeGroups: num(d.activeGroups),
          totalMembers: num(d.totalMembers),
          escrowBalance: num(d.escrowBalance),
          insurancePool: num(d.insurancePool),
          monthlyPool: num(d.monthlyPool),
          payoutsCompleted: num(d.payoutsCompleted),
          platformRevenue: num(d.platformRevenue),
          activeLoans: num(d.activeLoans),
        },
        escrowHealth: {
          totalCollected: num(d.totalCollected),
          paidOut: num(d.paidOut),
          heldInEscrow: num(d.escrowBalance),
          insurancePool: num(d.insurancePool),
        },
        recentActivity: activity.map(a => ({
          action: a.action,
          description: a.description || `${a.action} by ${a.fullName || 'system'}`,
          createdAt: a.createdAt,
        })),
        payoutSchedule: schedule.map(s => ({
          monthNumber: s.monthNumber,
          scheduledDate: s.scheduledDate,
          amount: Number(s.payoutAmount),
          status: s.status,
          recipientName: s.recipientName,
          groupName: s.groupName,
        })),
      },
    })
  } catch (e: any) {
    console.error('GET /api/dashboard error:', e?.message)
    return NextResponse.json(
      { success: false, error: 'Failed to load dashboard data' },
      { status: 500 }
    )
  }
}

// ============================================================
// KNOWN ISSUE CARRIED OVER FROM v1 — NOT CHANGED HERE
//
// "Escrow Balance" and "Insurance Pool" sum across ALL non-deleted
// groups, while "Active Groups" counts only those with status = ACTIVE.
// So a DRAFT or DISSOLVED group still contributes to the escrow figure
// shown as "Held securely".
//
// I have deliberately NOT changed this. Silently altering a financial
// figure is not something to slip into a performance refactor — you
// should decide whether DISSOLVED groups belong in that total.
//
// If they should not, add to both escrow subqueries:
//     AND g."status" = 'ACTIVE'
//
// ------------------------------------------------------------
// AUTHORISATION INCONSISTENCY — WORTH A SEPARATE LOOK
//
// This route scopes to GROUP_ADMIN only. canManageGroup() in
// src/lib/auth also grants TREASURER. So a TREASURER can manage a group
// through the API but sees zero data for it on the dashboard. One of
// the two definitions is wrong; deciding which is a business call.
// ============================================================
