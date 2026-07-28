// src/app/api/windfall/route.ts — v1.3
// v1.3: POST / PUT / DELETE now gated by requireGroupManager. For PUT and
//       DELETE the scheme's groupId is resolved FIRST, then authorised —
//       so a caller can never act on a group they don't manage.
// v1.2: Guard covers raw-SQL scheme tables (GroceryClub, SavingsPool,
//       InvestmentClub + money-movement children). Column presence verified
//       at runtime via information_schema. Parent tables fail CLOSED.
// v1.1: DELETE guarded against transactions/records; force-dynamic; randomUUID.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import prisma from '@/lib/prisma/client'
import { requireGroupManager } from '@/lib/auth'

export const dynamic = 'force-dynamic'

async function sql(query: string, params: any[] = []) {
  return prisma.$queryRawUnsafe(query, ...params) as Promise<any[]>
}
async function exec(query: string, params: any[] = []) {
  return prisma.$executeRawUnsafe(query, ...params)
}

const SCHEME_TYPES = ['GROCERY_CLUB','SAVINGS_POOL','PROPERTY','LOANS','INVESTMENT','ASSETS'] as const

const createSchema = z.object({
  groupId:     z.string().uuid(),
  schemeType:  z.enum(SCHEME_TYPES),
  name:        z.string().min(2),
  description: z.string().nullish().transform(v => v || null),
})

const updateSchema = z.object({
  id:          z.string().uuid(),
  name:        z.string().min(2),
  description: z.string().nullish().transform(v => v || null),
  status:      z.enum(['ACTIVE','PAUSED','CLOSED']).optional(),
})

// ── GET — list schemes for a group ───────────────────────────
// Intentionally NOT gated to group managers: ordinary members must be able
// to see which schemes their group runs. Read-scoping for members is
// tracked separately (Phase 3 scheme GET read-scoping).
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const groupId = searchParams.get('groupId')
    if (!groupId) return NextResponse.json({ success: false, error: 'groupId required' }, { status: 400 })

    const schemes = await sql(`
      SELECT ws.*,
        g.name as "groupName",
        g.currency as "currency"
      FROM "WindfallScheme" ws
      JOIN "Group" g ON g.id = ws."groupId"
      WHERE ws."groupId" = $1
      ORDER BY ws."createdAt" DESC
    `, [groupId])

    return NextResponse.json({ success: true, data: schemes.map(formatScheme) })
  } catch (e: any) {
    console.error('GET /api/windfall error:', e?.message)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── POST — create scheme ──────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const data = createSchema.parse(body)

    // Authorise against the target group before touching anything
    const guardErr = await requireGroupManager(req, data.groupId)
    if (guardErr) return guardErr

    // Check group exists
    const groups = await sql(`SELECT id FROM "Group" WHERE id = $1 AND "deletedAt" IS NULL`, [data.groupId])
    if (!groups.length) return NextResponse.json({ success: false, error: 'Group not found' }, { status: 404 })

    // Check no duplicate active scheme of same type in this group
    const existing = await sql(`
      SELECT id FROM "WindfallScheme"
      WHERE "groupId" = $1 AND "schemeType" = $2::"WindfallSchemeType" AND status = 'ACTIVE'
    `, [data.groupId, data.schemeType])

    if (existing.length) {
      const label = SCHEME_LABELS[data.schemeType]
      return NextResponse.json({
        success: false,
        error: `An active ${label} scheme already exists for this group. Close or pause it before creating a new one.`
      }, { status: 409 })
    }

    const id = randomUUID()
    await exec(`
      INSERT INTO "WindfallScheme" (id, "groupId", "schemeType", name, description, status, "createdAt", "updatedAt")
      VALUES ($1, $2, $3::"WindfallSchemeType", $4, $5, 'ACTIVE'::"WindfallSchemeStatus", NOW(), NOW())
    `, [id, data.groupId, data.schemeType, data.name, data.description])

    return NextResponse.json({
      success: true,
      data:    { id },
      message: `"${data.name}" scheme created successfully`,
    }, { status: 201 })
  } catch (e: any) {
    if (e instanceof z.ZodError) return NextResponse.json({ success: false, error: e.errors.map(x => x.message).join('; ') }, { status: 400 })
    console.error('POST /api/windfall error:', e?.message)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── PUT — update scheme ───────────────────────────────────────
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const data = updateSchema.parse(body)

    // Resolve the scheme's own group FIRST, then authorise against it
    const schemes = await sql(`SELECT id, "groupId" FROM "WindfallScheme" WHERE id = $1`, [data.id])
    if (!schemes.length) return NextResponse.json({ success: false, error: 'Scheme not found' }, { status: 404 })

    const guardErr = await requireGroupManager(req, schemes[0].groupId)
    if (guardErr) return guardErr

    await exec(`
      UPDATE "WindfallScheme"
      SET name = $1, description = $2,
          status = COALESCE($3::"WindfallSchemeStatus", status),
          "updatedAt" = NOW()
      WHERE id = $4
    `, [data.name, data.description, data.status || null, data.id])

    return NextResponse.json({ success: true, message: `"${data.name}" updated successfully` })
  } catch (e: any) {
    if (e instanceof z.ZodError) return NextResponse.json({ success: false, error: e.errors.map(x => x.message).join('; ') }, { status: 400 })
    console.error('PUT /api/windfall error:', e?.message)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── DELETE — remove scheme (guarded hard delete) ──────────────
// Two gates, in order:
//   1. AUTHORISATION — caller must manage the scheme's group
//      (requireGroupManager; SYSTEM_ADMIN / NATIONAL_ADMIN bypass)
//   2. FINANCIAL INTEGRITY — a scheme with ANY transactions or financial
//      records under its group cannot be removed
// If both pass, the WindfallScheme row is HARD-deleted.
//
// Two kinds of integrity check:
//
// A. STATIC checks — tables confirmed in schema.prisma. Enum columns are
//    compared via ::text so no enum-cast parameters are needed (the values
//    are hard-coded TransactionType literals, never user input).
//
// B. RAW-TABLE checks — scheme tables created via raw SQL and not in
//    schema.prisma. Their column layout is verified at runtime against
//    information_schema (cached per server instance) instead of guessed:
//    - table HAS a "groupId" column  → counted for this group
//    - PARENT table lacks "groupId"  → fail CLOSED (removal blocked with an
//      explicit message) so a misconfigured guard can never allow deletion
//    - CHILD table lacks "groupId"   → skipped; children FK to their parent,
//      so the parent-row check covers them transitively
type StaticGuard = { label: string; query: string }
type RawGuard    = { table: string; label: string; required?: boolean }

const STATIC_SCHEME_GUARDS: Record<string, StaticGuard[]> = {
  SAVINGS_POOL: [
    { label: 'contribution/payout transaction(s)',
      query: `SELECT COUNT(*)::int AS n FROM "Transaction" WHERE "groupId" = $1 AND type::text IN ('CONTRIBUTION','PAYOUT','PRE_ESCROW')` },
    { label: 'savings cycle(s)',
      query: `SELECT COUNT(*)::int AS n FROM "Cycle" WHERE "groupId" = $1` },
  ],
  LOANS: [
    { label: 'loan transaction(s)',
      query: `SELECT COUNT(*)::int AS n FROM "Transaction" WHERE "groupId" = $1 AND type::text IN ('LOAN_DISBURSEMENT','LOAN_REPAYMENT')` },
    { label: 'loan record(s)',
      query: `SELECT COUNT(*)::int AS n FROM "Loan" WHERE "groupId" = $1` },
  ],
  ASSETS: [
    { label: 'asset transaction(s)',
      query: `SELECT COUNT(*)::int AS n FROM "Transaction" WHERE "groupId" = $1 AND type::text IN ('ASSET_CONTRIBUTION')` },
    { label: 'asset record(s)',
      query: `SELECT COUNT(*)::int AS n FROM "Asset" WHERE "groupId" = $1` },
  ],
  PROPERTY: [
    { label: 'rental transaction(s)',
      query: `SELECT COUNT(*)::int AS n FROM "Transaction" WHERE "groupId" = $1 AND type::text IN ('RENTAL_INCOME')` },
    { label: 'property record(s)',
      query: `SELECT COUNT(*)::int AS n FROM "PropertyGroup" WHERE "groupId" = $1` },
  ],
  INVESTMENT: [
    { label: 'investment transaction(s)',
      query: `SELECT COUNT(*)::int AS n FROM "Transaction" WHERE "groupId" = $1 AND type::text IN ('INVESTMENT_CONTRIBUTION','INVESTMENT_RETURN')` },
    { label: 'investment portfolio record(s)',
      query: `SELECT COUNT(*)::int AS n FROM "InvestmentPortfolio" WHERE "groupId" = $1` },
  ],
  GROCERY_CLUB: [],
}

// Table names below are hard-coded from the confirmed information_schema
// table list — never derived from user input, so interpolation is safe.
const RAW_SCHEME_GUARDS: Record<string, RawGuard[]> = {
  GROCERY_CLUB: [
    { table: 'GroceryClub',         label: 'grocery club record(s)', required: true },
    { table: 'GroceryContribution', label: 'grocery contribution(s)' },
    { table: 'GroceryMember',       label: 'grocery member record(s)' },
    { table: 'GroceryItem',         label: 'grocery item record(s)' },
  ],
  SAVINGS_POOL: [
    { table: 'SavingsPool',           label: 'savings pool record(s)', required: true },
    { table: 'SavingsContribution',   label: 'savings contribution(s)' },
    { table: 'SavingsLoan',           label: 'savings loan(s)' },
    { table: 'SavingsLoanRepayment',  label: 'savings loan repayment(s)' },
    { table: 'SavingsPoolPayout',     label: 'savings payout(s)' },
    { table: 'SavingsRotationPayout', label: 'rotation payout(s)' },
    { table: 'SavingsPoolMember',     label: 'savings pool member record(s)' },
  ],
  INVESTMENT: [
    { table: 'InvestmentClub',         label: 'investment club record(s)', required: true },
    { table: 'InvestmentContribution', label: 'investment contribution(s)' },
    { table: 'InvestmentDisbursement', label: 'investment disbursement(s)' },
    { table: 'InvestmentLoan',         label: 'investment club loan(s)' },
    { table: 'InvestmentMember',       label: 'investment member record(s)' },
  ],
  ASSETS:   [],   // Asset (schema-confirmed) is the parent; AssetMaintenance,
  PROPERTY: [],   // AssetIncome etc. FK to Asset and are covered transitively
  LOANS:    [],
}

// Module-level cache of raw tables that have a "groupId" column.
// Server-side per-instance cache — one information_schema query per cold
// start. (The client-side module-cache prohibition doesn't apply here.)
let groupIdTableCache: Set<string> | null = null
async function tablesWithGroupId(): Promise<Set<string>> {
  if (groupIdTableCache) return groupIdTableCache
  const rows = await sql(`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'groupId'
  `)
  groupIdTableCache = new Set<string>(rows.map((r: any) => r.table_name))
  return groupIdTableCache
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 })

    const schemes = await sql(`
      SELECT id, name, "groupId", "schemeType"::text AS "schemeType"
      FROM "WindfallScheme" WHERE id = $1
    `, [id])
    if (!schemes.length) return NextResponse.json({ success: false, error: 'Scheme not found' }, { status: 404 })
    const scheme = schemes[0]

    // Gate 1 — authorisation against this scheme's own group
    const guardErr = await requireGroupManager(req, scheme.groupId)
    if (guardErr) return guardErr

    // Gate 2 — financial integrity
    const blockers: string[] = []

    // Resolve which raw tables can actually be checked by groupId
    const groupIdTables = await tablesWithGroupId()
    const rawGuards     = RAW_SCHEME_GUARDS[scheme.schemeType] || []
    const runnableRaw: RawGuard[] = []
    for (const g of rawGuards) {
      if (groupIdTables.has(g.table)) {
        runnableRaw.push(g)
      } else if (g.required) {
        // Fail CLOSED: a parent scheme table we cannot verify blocks removal
        blockers.push(`Safety check unavailable — "${g.table}" has no groupId column. Removal blocked until the guard is configured for this table.`)
      }
      // Non-required child tables without groupId are covered via their parent
    }

    // Run all static + raw guard checks in parallel
    const staticChecks = STATIC_SCHEME_GUARDS[scheme.schemeType] || []
    const queries = [
      ...staticChecks.map(c => ({ label: c.label, query: c.query })),
      ...runnableRaw.map(g => ({ label: g.label, query: `SELECT COUNT(*)::int AS n FROM "${g.table}" WHERE "groupId" = $1` })),
    ]
    const results = await Promise.all(queries.map(q => sql(q.query, [scheme.groupId])))

    results.forEach((rows, i) => {
      const n = Number(rows?.[0]?.n ?? 0)
      if (n > 0) blockers.push(`${n} ${queries[i].label}`)
    })

    if (blockers.length) {
      return NextResponse.json({
        success:  false,
        blocked:  true,
        blockers,
        error:    `"${scheme.name}" has financial records and cannot be removed`,
      }, { status: 409 })
    }

    // All clear — hard delete
    await exec(`DELETE FROM "WindfallScheme" WHERE id = $1`, [id])

    return NextResponse.json({ success: true, message: `"${scheme.name}" removed` })
  } catch (e: any) {
    console.error('DELETE /api/windfall error:', e?.message)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── Helpers ───────────────────────────────────────────────────
const SCHEME_LABELS: Record<string, string> = {
  GROCERY_CLUB: 'Grocery Club',
  SAVINGS_POOL: 'Savings Pool',
  PROPERTY:     'Property',
  LOANS:        'Loans',
  INVESTMENT:   'Investment',
  ASSETS:       'Assets',
}

function formatScheme(s: any) {
  return {
    id:          s.id,
    groupId:     s.groupId,
    groupName:   s.groupName,
    currency:    s.currency,
    schemeType:  s.schemeType,
    name:        s.name,
    description: s.description,
    status:      s.status,
    label:       SCHEME_LABELS[s.schemeType] || s.schemeType,
    createdAt:   s.createdAt,
    updatedAt:   s.updatedAt,
  }
}
