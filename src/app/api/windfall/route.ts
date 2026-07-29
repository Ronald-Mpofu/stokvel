// src/app/api/windfall/route.ts — v1.4
// v1.4: Scheme-level settings. Contribution terms, payout strategy and start
//       date now live on the scheme (they moved off Group). Three new rules:
//         - Contribution fields are rejected on non-contributory schemes;
//           payoutStrategy is rejected on non-rotating ones. A property
//           scheme has no contribution day and should not pretend to.
//         - Terms LOCK once money is scheduled. Changing the amount after
//           Contribution rows exist would desync every downstream figure.
//         - The SAVINGS_POOL delete guard now counts cycles by schemeId,
//           not groupId — cycles are per scheme as of migration 08.
//       Raw driver errors no longer reach the client in production.
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

// Raw driver errors leak table and column names. Log the real thing.
const IS_PROD = process.env.NODE_ENV === 'production'
function safeError(e: any, fallback: string): string {
  return IS_PROD ? fallback : (e?.message || fallback)
}

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

// Every settings field is optional: a caller may PATCH just the amount, or
// just the name. Absent means "leave unchanged" (COALESCE in the UPDATE).
const updateSchema = z.object({
  id:          z.string().uuid(),
  name:        z.string().min(2).optional(),
  description: z.string().nullable().optional(),
  status:      z.enum(['ACTIVE','PAUSED','CLOSED']).optional(),

  // ── Scheme settings (moved off Group in migration 08) ──
  contributionAmount:    z.number().nonnegative().optional(),
  // 1-28 only: days 29-31 do not exist in every month, and a contribution
  // day that silently skips February is a support ticket.
  contributionDay:       z.number().int().min(1).max(28).optional(),
  contributionFrequency: z.enum(['weekly','biweekly','monthly','quarterly','annually']).optional(),
  payoutStrategy:        z.enum(['RANDOM','SENIORITY','GROUP_VOTE']).optional(),
  penaltyRate:           z.number().min(0).max(1).optional(),
  insurancePoolPct:      z.number().min(0).max(1).optional(),
  startDate:             z.string().optional(),
})

// Fields that define the financial terms of a cycle. Once contributions are
// scheduled these are frozen — see the lock check in PUT.
const TERM_FIELDS = [
  'contributionAmount', 'contributionDay', 'contributionFrequency',
  'payoutStrategy', 'penaltyRate', 'insurancePoolPct', 'startDate',
] as const

// Only meaningful on schemes that collect periodic contributions.
const CONTRIBUTORY_FIELDS = [
  'contributionAmount', 'contributionDay', 'contributionFrequency',
  'penaltyRate', 'insurancePoolPct', 'startDate',
] as const

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
        g.currency as "currency",
        (SELECT COUNT(*)::int FROM "SchemeMember" sm
          WHERE sm."schemeId" = ws.id
            AND sm.status <> 'EXITED'::"MemberStatus")        AS "memberCount",
        (SELECT COUNT(*)::int FROM "Cycle" c
          WHERE c."schemeId" = ws.id)                          AS "cycleCount",
        (SELECT COUNT(*)::int FROM "Cycle" c2
          WHERE c2."schemeId" = ws.id
            AND c2.status <> 'PENDING'::"CycleStatus")         AS "lockedCount"
      FROM "WindfallScheme" ws
      JOIN "Group" g ON g.id = ws."groupId"
      WHERE ws."groupId" = $1
      ORDER BY ws."createdAt" DESC
    `, [groupId])

    return NextResponse.json({ success: true, data: schemes.map(formatScheme) })
  } catch (e: any) {
    console.error('GET /api/windfall error:', e?.message)
    return NextResponse.json({ success: false, error: safeError(e, 'Failed to load schemes') }, { status: 500 })
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
    return NextResponse.json({ success: false, error: safeError(e, 'Failed to create scheme') }, { status: 500 })
  }
}

// ── PUT — update scheme ───────────────────────────────────────
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const data = updateSchema.parse(body)

    // Which keys did the CALLER actually send? Zod cannot distinguish
    // "absent" from "explicitly undefined", and the difference matters here:
    // absent means leave alone, present means change.
    const sent = (k: string) => Object.prototype.hasOwnProperty.call(body, k)

    // Resolve the scheme's own group FIRST, then authorise against it
    const schemes = await sql(`
      SELECT id, name, "groupId", "schemeType"::text AS "schemeType",
             "isContributory", "isRotating"
      FROM "WindfallScheme" WHERE id = $1
    `, [data.id])
    if (!schemes.length) return NextResponse.json({ success: false, error: 'Scheme not found' }, { status: 404 })
    const scheme = schemes[0]

    const guardErr = await requireGroupManager(req, scheme.groupId)
    if (guardErr) return guardErr

    // ── Gate 1: does this scheme type have these settings at all? ──
    // A property or loans scheme collects no periodic contribution, and a
    // grocery club pays everyone at once rather than rotating. Accepting
    // these silently would store values the engine never reads.
    if (!scheme.isContributory) {
      const offending = CONTRIBUTORY_FIELDS.filter(sent)
      if (offending.length) {
        return NextResponse.json({
          success: false,
          error: `${SCHEME_LABELS[scheme.schemeType] || scheme.schemeType} does not collect periodic contributions, so ${offending.join(', ')} cannot be set on it.`,
        }, { status: 400 })
      }
    }
    if (!scheme.isRotating && sent('payoutStrategy')) {
      return NextResponse.json({
        success: false,
        error: `${SCHEME_LABELS[scheme.schemeType] || scheme.schemeType} pays all participants together rather than in rotation, so a payout strategy does not apply.`,
      }, { status: 400 })
    }

    // ── Gate 2: are the terms already locked? ──
    // Once contributions are scheduled, changing the amount or the schedule
    // desyncs every figure derived from them — amounts due, payout totals,
    // arrears. Name, description and status stay editable.
    const changingTerms = TERM_FIELDS.some(sent)
    if (changingTerms) {
      const [lock] = await sql(`
        SELECT
          (SELECT COUNT(*)::int FROM "Cycle" c
            WHERE c."schemeId" = $1
              AND c.status <> 'PENDING'::"CycleStatus")            AS live_cycles,
          (SELECT COUNT(*)::int FROM "Contribution" co
            JOIN "Cycle" c2 ON c2.id = co."cycleId"
            WHERE c2."schemeId" = $1)                              AS scheduled
      `, [data.id])

      const live = Number(lock?.live_cycles ?? 0)
      const scheduled = Number(lock?.scheduled ?? 0)
      if (live > 0 || scheduled > 0) {
        return NextResponse.json({
          success: false,
          locked: true,
          error: `Contribution terms are locked: this scheme has ${live} running or completed cycle(s) and ${scheduled} scheduled contribution(s). Close the cycle before changing terms.`,
        }, { status: 409 })
      }
    }

    // description is the one field where clearing is meaningful, so it is
    // handled by presence rather than COALESCE. Absent -> null -> unchanged.
    const descArg = sent('description') ? (data.description ?? '') : null

    await exec(`
      UPDATE "WindfallScheme"
      SET name        = COALESCE($1, name),
          description = CASE WHEN $2::text IS NULL THEN description
                             ELSE NULLIF($2::text, '') END,
          status      = COALESCE($3::"WindfallSchemeStatus", status),
          "contributionAmount"    = COALESCE($4::numeric,   "contributionAmount"),
          "contributionDay"       = COALESCE($5::int,       "contributionDay"),
          "contributionFrequency" = COALESCE($6::text,      "contributionFrequency"),
          "payoutStrategy"        = COALESCE($7::"PayoutStrategy", "payoutStrategy"),
          "penaltyRate"           = COALESCE($8::numeric,   "penaltyRate"),
          "insurancePoolPct"      = COALESCE($9::numeric,   "insurancePoolPct"),
          "startDate"             = COALESCE($10::timestamp, "startDate"),
          "updatedAt"             = NOW()
      WHERE id = $11
    `, [
      data.name ?? null,
      descArg,
      data.status ?? null,
      data.contributionAmount ?? null,
      data.contributionDay ?? null,
      data.contributionFrequency ?? null,
      data.payoutStrategy ?? null,
      data.penaltyRate ?? null,
      data.insurancePoolPct ?? null,
      data.startDate ?? null,
      data.id,
    ])

    return NextResponse.json({
      success: true,
      message: `"${data.name || scheme.name}" updated successfully`,
    })
  } catch (e: any) {
    if (e instanceof z.ZodError) return NextResponse.json({ success: false, error: e.errors.map(x => x.message).join('; ') }, { status: 400 })
    console.error('PUT /api/windfall error:', e?.message)
    return NextResponse.json({ success: false, error: safeError(e, 'Failed to update scheme') }, { status: 500 })
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
// scope tells the runner which id to bind: the group, or the scheme itself.
// Cycles moved to scheme level in migration 08, so counting them by groupId
// would block deleting a savings pool because the GROCERY club has a cycle.
type StaticGuard = { label: string; query: string; scope?: 'group' | 'scheme' }
type RawGuard    = { table: string; label: string; required?: boolean }

const STATIC_SCHEME_GUARDS: Record<string, StaticGuard[]> = {
  SAVINGS_POOL: [
    { label: 'contribution/payout transaction(s)',
      query: `SELECT COUNT(*)::int AS n FROM "Transaction" WHERE "groupId" = $1 AND type::text IN ('CONTRIBUTION','PAYOUT','PRE_ESCROW')` },
    { label: 'savings cycle(s)',
      scope: 'scheme',
      query: `SELECT COUNT(*)::int AS n FROM "Cycle" WHERE "schemeId" = $1` },
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
  GROCERY_CLUB: [
    { label: 'grocery cycle(s)',
      scope: 'scheme',
      query: `SELECT COUNT(*)::int AS n FROM "Cycle" WHERE "schemeId" = $1` },
  ],
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

    // Participants are not financial records, but removing a scheme that
    // people have been assigned to should still be deliberate.
    const [roster] = await sql(`
      SELECT COUNT(*)::int AS n FROM "SchemeMember"
      WHERE "schemeId" = $1 AND status <> 'EXITED'::"MemberStatus"
    `, [scheme.id])
    const rosterCount = Number(roster?.n ?? 0)
    if (rosterCount > 0) blockers.push(`${rosterCount} assigned member(s)`)

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
      ...staticChecks.map(c => ({ label: c.label, query: c.query, scope: c.scope || 'group' })),
      ...runnableRaw.map(g => ({ label: g.label, scope: 'group' as const, query: `SELECT COUNT(*)::int AS n FROM "${g.table}" WHERE "groupId" = $1` })),
    ]
    const results = await Promise.all(
      queries.map(q => sql(q.query, [q.scope === 'scheme' ? scheme.id : scheme.groupId]))
    )

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
    return NextResponse.json({ success: false, error: safeError(e, 'Failed to remove scheme') }, { status: 500 })
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

    // Behaviour flags drive which settings the UI should offer.
    isContributory: Boolean(s.isContributory),
    isRotating:     Boolean(s.isRotating),

    // NUMERIC arrives as a string from the driver; null stays null so the
    // form can distinguish "not set yet" from "set to zero".
    contributionAmount:    s.contributionAmount    === null ? null : Number(s.contributionAmount),
    contributionDay:       s.contributionDay       === null ? null : Number(s.contributionDay),
    contributionFrequency: s.contributionFrequency ?? null,
    payoutStrategy:        s.payoutStrategy        ?? null,
    penaltyRate:           s.penaltyRate           === null ? null : Number(s.penaltyRate),
    insurancePoolPct:      s.insurancePoolPct      === null ? null : Number(s.insurancePoolPct),
    startDate:             s.startDate             ?? null,

    // Lets the settings form disable term fields without a second request.
    memberCount:  Number(s.memberCount ?? 0),
    cycleCount:   Number(s.cycleCount ?? 0),
    termsLocked:  Number(s.lockedCount ?? 0) > 0,

    createdAt:   s.createdAt,
    updatedAt:   s.updatedAt,
  }
}
