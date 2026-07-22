// src/app/api/windfall/route.ts — v1.1
// v1.1: DELETE now guarded — a scheme with transactions or financial records
//       cannot be removed. Also: force-dynamic added, randomUUID import fixed.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import prisma from '@/lib/prisma/client'

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

    const schemes = await sql(`SELECT id FROM "WindfallScheme" WHERE id = $1`, [data.id])
    if (!schemes.length) return NextResponse.json({ success: false, error: 'Scheme not found' }, { status: 404 })

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

// ── DELETE — remove scheme (guarded) ──────────────────────────
// Financial-integrity rule: a scheme with ANY transactions or financial
// records under its group cannot be removed. Same principle as member
// removal in /api/members/remove.
//
// Guard checks are per schemeType. Enum columns are compared via ::text
// so no enum-cast parameters are needed (values below are hard-coded
// literals from the TransactionType enum — never user input).
type GuardCheck = { label: string; query: string }

const SCHEME_GUARDS: Record<string, GuardCheck[]> = {
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
  GROCERY_CLUB: [
    // ⚠️ Grocery order/contribution tables are raw-SQL and not in
    // schema.prisma — add { label, query } entries here once the actual
    // table names are confirmed. Until then a grocery scheme is only
    // blocked if a check is added. See delivery notes.
  ],
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

    // Run all guard checks for this scheme type in parallel
    const checks  = SCHEME_GUARDS[scheme.schemeType] || []
    const results = await Promise.all(checks.map(c => sql(c.query, [scheme.groupId])))

    const blockers: string[] = []
    results.forEach((rows, i) => {
      const n = Number(rows?.[0]?.n ?? 0)
      if (n > 0) blockers.push(`${n} ${checks[i].label}`)
    })

    if (blockers.length) {
      return NextResponse.json({
        success:  false,
        blocked:  true,
        blockers,
        error:    `"${scheme.name}" has financial records and cannot be removed`,
      }, { status: 409 })
    }

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
