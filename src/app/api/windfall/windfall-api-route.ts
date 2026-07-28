// src/app/api/windfall/route.ts — v1.0
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'

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
    console.error('GET /api/windfall error:', e)
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

    const id = crypto.randomUUID()
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
    console.error('POST /api/windfall error:', e)
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
    console.error('PUT /api/windfall error:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── DELETE — delete scheme ────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 })

    const schemes = await sql(`SELECT id, name FROM "WindfallScheme" WHERE id = $1`, [id])
    if (!schemes.length) return NextResponse.json({ success: false, error: 'Scheme not found' }, { status: 404 })

    await exec(`DELETE FROM "WindfallScheme" WHERE id = $1`, [id])

    return NextResponse.json({ success: true, message: `"${schemes[0].name}" deleted` })
  } catch (e: any) {
    console.error('DELETE /api/windfall error:', e)
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
