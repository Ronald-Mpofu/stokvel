// src/app/api/dashboard/summary/route.ts
//
// ONE database round trip for every dashboard KPI.
//
// The pattern this replaces: a dashboard fires 8-15 requests on mount,
// each running findMany() and counting the results in JavaScript. That
// is invisible at 50 rows and fatal at 50,000 — and even with no data
// at all it costs one network round trip per card.
//
// Everything below is scalar subqueries in a single statement. Postgres
// runs them in one pass; you pay one round trip regardless of how many
// cards the dashboard grows to.
//
// USAGE
//   GET /api/dashboard/summary              → platform-wide (admin view)
//   GET /api/dashboard/summary?groupId=xxx  → scoped to one group
//
// Every table and column referenced here was confirmed present by
// 02-performance-indexes.sql. Enum comparisons use explicit ::"EnumType"
// casts as raw SQL requires.

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'
import { getClaimsFromRequest, unauthorized, SUPER_ROLES, canManageGroup } from '@/lib/auth'

export const dynamic = 'force-dynamic'

type RawSummary = {
  group_count: bigint
  active_group_count: bigint
  member_count: bigint
  total_contributed: string | null
  active_loan_count: bigint
  loan_outstanding: string | null
  asset_count: bigint
  asset_raised: string | null
  property_count: bigint
  property_raised: string | null
  scheme_count: bigint
  txn_count: bigint
  txn_completed_value: string | null
  pending_contributions: bigint
  overdue_contributions: bigint
}

export async function GET(req: NextRequest) {
  const t0 = Date.now()

  try {
    const claims = await getClaimsFromRequest(req)
    if (!claims) return unauthorized()

    const url = new URL(req.url)
    const groupId = url.searchParams.get('groupId')

    // Authorisation. Zero extra queries for super roles.
    if (groupId && !SUPER_ROLES.includes(claims.role)) {
      const ok = await canManageGroup(claims.id, groupId)
      if (!ok) {
        return NextResponse.json(
          { success: false, error: 'Not authorised for this group' },
          { status: 403 }
        )
      }
    }

    // $1 is either a real groupId or NULL. When NULL, every
    // "($1::text IS NULL OR ...)" predicate short-circuits to true and
    // the query returns platform-wide totals. One statement serves both
    // the platform dashboard and the group Overview tab.
    const [s] = await prisma.$queryRawUnsafe<RawSummary[]>(
      `
      SELECT
        -- ── Groups ──────────────────────────────────────────
        (SELECT count(*) FROM "Group" g
          WHERE g."deletedAt" IS NULL
            AND ($1::text IS NULL OR g.id = $1)
        ) AS group_count,

        (SELECT count(*) FROM "Group" g
          WHERE g."deletedAt" IS NULL
            AND g.status = 'ACTIVE'::"GroupStatus"
            AND ($1::text IS NULL OR g.id = $1)
        ) AS active_group_count,

        -- ── Members (EXITED excluded, matching memberCount) ──
        (SELECT count(*) FROM "GroupMember" m
          WHERE m.status <> 'EXITED'::"MemberStatus"
            AND ($1::text IS NULL OR m."groupId" = $1)
        ) AS member_count,

        (SELECT COALESCE(sum(m."totalContributed"), 0) FROM "GroupMember" m
          WHERE m.status <> 'EXITED'::"MemberStatus"
            AND ($1::text IS NULL OR m."groupId" = $1)
        ) AS total_contributed,

        -- ── Loans ───────────────────────────────────────────
        (SELECT count(*) FROM "Loan" l
          WHERE l.status = 'ACTIVE'::"LoanStatus"
            AND ($1::text IS NULL OR l."groupId" = $1)
        ) AS active_loan_count,

        (SELECT COALESCE(sum(l."outstandingBalance"), 0) FROM "Loan" l
          WHERE l.status = 'ACTIVE'::"LoanStatus"
            AND ($1::text IS NULL OR l."groupId" = $1)
        ) AS loan_outstanding,

        -- ── Assets ──────────────────────────────────────────
        (SELECT count(*) FROM "Asset" a
          WHERE ($1::text IS NULL OR a."groupId" = $1)
        ) AS asset_count,

        (SELECT COALESCE(sum(a."raisedAmount"), 0) FROM "Asset" a
          WHERE ($1::text IS NULL OR a."groupId" = $1)
        ) AS asset_raised,

        -- ── Property ────────────────────────────────────────
        (SELECT count(*) FROM "PropertyGroup" p
          WHERE ($1::text IS NULL OR p."groupId" = $1)
        ) AS property_count,

        (SELECT COALESCE(sum(p."raisedCapital"), 0) FROM "PropertyGroup" p
          WHERE ($1::text IS NULL OR p."groupId" = $1)
        ) AS property_raised,

        -- ── Windfall schemes (raw-SQL table) ────────────────
        (SELECT count(*) FROM "WindfallScheme" w
          WHERE ($1::text IS NULL OR w."groupId" = $1)
        ) AS scheme_count,

        -- ── Ledger ──────────────────────────────────────────
        (SELECT count(*) FROM "Transaction" t
          WHERE ($1::text IS NULL OR t."groupId" = $1)
        ) AS txn_count,

        (SELECT COALESCE(sum(t.amount), 0) FROM "Transaction" t
          WHERE t.status = 'COMPLETED'::"TransactionStatus"
            AND ($1::text IS NULL OR t."groupId" = $1)
        ) AS txn_completed_value,

        -- ── Contributions needing attention ─────────────────
        (SELECT count(*) FROM "Contribution" c
          JOIN "Cycle" cy ON cy.id = c."cycleId"
          WHERE c.status = 'PENDING'::"ContributionStatus"
            AND ($1::text IS NULL OR cy."groupId" = $1)
        ) AS pending_contributions,

        (SELECT count(*) FROM "Contribution" c
          JOIN "Cycle" cy ON cy.id = c."cycleId"
          WHERE c.status IN ('PENDING'::"ContributionStatus", 'LATE'::"ContributionStatus")
            AND c."dueDate" < now()
            AND ($1::text IS NULL OR cy."groupId" = $1)
        ) AS overdue_contributions
      `,
      groupId
    )

    // bigint does not survive JSON.stringify, and Decimal arrives as a
    // string. Normalise both here so the client gets plain numbers.
    const n = (v: bigint | null | undefined) => Number(v ?? 0)
    const d = (v: string | null | undefined) => Number(v ?? 0)

    const payload = {
      groups: {
        total: n(s?.group_count),
        active: n(s?.active_group_count),
      },
      members: {
        total: n(s?.member_count),
        totalContributed: d(s?.total_contributed),
      },
      loans: {
        active: n(s?.active_loan_count),
        outstanding: d(s?.loan_outstanding),
      },
      assets: {
        total: n(s?.asset_count),
        raised: d(s?.asset_raised),
      },
      property: {
        total: n(s?.property_count),
        raised: d(s?.property_raised),
      },
      schemes: {
        total: n(s?.scheme_count),
      },
      ledger: {
        transactionCount: n(s?.txn_count),
        completedValue: d(s?.txn_completed_value),
      },
      attention: {
        pendingContributions: n(s?.pending_contributions),
        overdueContributions: n(s?.overdue_contributions),
      },
    }

    console.log('GET /api/dashboard/summary db_ms=', Date.now() - t0, 'groupId=', groupId ?? 'ALL')

    return NextResponse.json({ success: true, data: payload })
  } catch (e: any) {
    console.error('GET /api/dashboard/summary error:', e?.message)
    return NextResponse.json(
      { success: false, error: 'Failed to load dashboard summary' },
      { status: 500 }
    )
  }
}

// ============================================================
// NOTES
//
// ADDING A CARD
//   Add another scalar subquery inside the same SELECT. It costs
//   essentially nothing — no additional round trip. This is the whole
//   point: dashboards grow, and this shape grows without getting slower.
//
// WHAT THIS DELIBERATELY DOES NOT DO
//   It returns no lists — no recent transactions, no member roster.
//   Those need pagination and belong in their own endpoints. Mixing
//   unbounded arrays into a summary is how summaries get slow again.
//
// SAVINGS / GROCERY SCHEMES
//   Deliberately omitted. Their status columns exist but I have not
//   confirmed whether they are Postgres enums or text, and an enum
//   compared against an unquoted literal fails at runtime. Send me the
//   column types and I will add them.
// ============================================================
