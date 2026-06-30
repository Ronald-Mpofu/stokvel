// src/app/api/assets/costing/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'

const itemSchema = z.object({
  category:    z.string(),
  description: z.string().min(1),
  amount:      z.coerce.number().min(0),
  currency:    z.string().default('USD'),
  isPerUnit:   z.boolean().default(true),
  isOptional:  z.boolean().default(false),
  included:    z.boolean().default(true),
  notes:       z.string().optional(),
  sortOrder:   z.coerce.number().default(0),
})

const sheetSchema = z.object({
  assetId:        z.string().uuid(),
  title:          z.string().optional(),
  currency:       z.string().default('USD'),
  units:          z.coerce.number().min(1).default(1),
  membersSharing: z.coerce.number().min(1).default(1),
  contingencyPct: z.coerce.number().min(0).max(50).default(5),
  notes:          z.string().optional(),
  items:          z.array(itemSchema),
})

// GET /api/assets/costing?assetId=xxx
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const assetId = searchParams.get('assetId')
    if (!assetId) return NextResponse.json({ success: false, error: 'assetId required' }, { status: 400 })

    const sheet = await prisma.assetCostingSheet.findUnique({
      where: { assetId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    })

    if (!sheet) return NextResponse.json({ success: true, data: null })

    return NextResponse.json({ success: true, data: formatSheet(sheet) })
  } catch (e) {
    console.error('GET /api/assets/costing error:', e)
    return NextResponse.json({ success: false, error: 'Failed to fetch costing sheet' }, { status: 500 })
  }
}

// POST — create or replace costing sheet
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const data = sheetSchema.parse(body)

    const asset = await prisma.asset.findUnique({
      where: { id: data.assetId },
      select: { id: true, name: true, group: { select: { currency: true } } },
    })
    if (!asset) return NextResponse.json({ success: false, error: 'Asset not found' }, { status: 404 })

    // Upsert sheet — replace all items
    const sheet = await prisma.$transaction(async (tx) => {
      const existing = await tx.assetCostingSheet.findUnique({ where: { assetId: data.assetId } })

      let s
      if (existing) {
        // Delete old items
        await tx.assetCostingItem.deleteMany({ where: { sheetId: existing.id } })
        s = await tx.assetCostingSheet.update({
          where: { id: existing.id },
          data: {
            title:          data.title || `${asset.name} — Cost Breakdown`,
            currency:       data.currency as any,
            units:          data.units,
            membersSharing: data.membersSharing,
            contingencyPct: data.contingencyPct,
            notes:          data.notes,
            status:         'DRAFT',
            approvedAt:     null,
            approvedById:   null,
          },
        })
      } else {
        s = await tx.assetCostingSheet.create({
          data: {
            assetId:        data.assetId,
            title:          data.title || `${asset.name} — Cost Breakdown`,
            currency:       data.currency as any,
            units:          data.units,
            membersSharing: data.membersSharing,
            contingencyPct: data.contingencyPct,
            notes:          data.notes,
          },
        })
      }

      // Create all items
      if (data.items.length > 0) {
        await tx.assetCostingItem.createMany({
          data: data.items.map((item, i) => ({
            sheetId:     s.id,
            category:    item.category,
            description: item.description,
            amount:      item.amount,
            currency:    item.currency as any,
            isPerUnit:   item.isPerUnit,
            isOptional:  item.isOptional,
            included:    item.included,
            notes:       item.notes,
            sortOrder:   item.sortOrder || i,
          })),
        })
      }

      // Update asset target amount to match total landed cost
      const totals = calculateTotals(data.items, data.units, data.contingencyPct)
      await tx.asset.update({
        where: { id: data.assetId },
        data:  { targetAmount: totals.grandTotal },
      })

      await tx.auditLog.create({
        data: {
          action:      'CREATE',
          entityType:  'AssetCostingSheet',
          entityId:    s.id,
          description: `Costing sheet saved for "${asset.name}". Total: ${totals.grandTotal}`,
        },
      })

      return s
    })

    const full = await prisma.assetCostingSheet.findUnique({
      where: { id: sheet.id },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    })

    return NextResponse.json({
      success: true,
      data:    formatSheet(full!),
      message: 'Costing sheet saved. Asset target amount updated.',
    })
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'Validation failed', details: e.errors }, { status: 400 })
    }
    console.error('POST /api/assets/costing error:', e)
    return NextResponse.json({ success: false, error: 'Failed to save costing sheet' }, { status: 500 })
  }
}

// PATCH — approve sheet
export async function PATCH(req: NextRequest) {
  try {
    const { sheetId } = await req.json()
    const sheet = await prisma.assetCostingSheet.update({
      where: { id: sheetId },
      data:  { status: 'APPROVED', approvedAt: new Date() },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    })
    return NextResponse.json({ success: true, data: formatSheet(sheet), message: 'Costing sheet approved' })
  } catch (e) {
    return NextResponse.json({ success: false, error: 'Failed to approve sheet' }, { status: 500 })
  }
}

// ── Helpers ───────────────────────────────────────────────────
function calculateTotals(items: any[], units: number, contingencyPct: number) {
  const included = items.filter(i => i.included)
  const subtotal = included.reduce((sum, item) => {
    const amt = parseFloat(String(item.amount)) || 0
    return sum + (item.isPerUnit ? amt * units : amt)
  }, 0)
  const contingency = subtotal * (parseFloat(String(contingencyPct)) / 100)
  const grandTotal  = subtotal + contingency
  return { subtotal, contingency, grandTotal }
}

function formatSheet(sheet: any) {
  const items = sheet.items.map((i: any) => ({
    id:          i.id,
    category:    i.category,
    description: i.description,
    amount:      Number(i.amount),
    currency:    i.currency,
    isPerUnit:   i.isPerUnit,
    isOptional:  i.isOptional,
    included:    i.included,
    notes:       i.notes,
    sortOrder:   i.sortOrder,
    lineTotal:   Number(i.amount) * (i.isPerUnit ? sheet.units : 1),
  }))

  const included    = items.filter((i: any) => i.included)
  const subtotal    = included.reduce((s: number, i: any) => s + i.lineTotal, 0)
  const contingency = subtotal * (Number(sheet.contingencyPct) / 100)
  const grandTotal  = subtotal + contingency
  const perMember   = sheet.membersSharing > 0 ? grandTotal / sheet.membersSharing : grandTotal
  const perUnit     = sheet.units > 0 ? grandTotal / sheet.units : grandTotal

  return {
    id:             sheet.id,
    assetId:        sheet.assetId,
    title:          sheet.title,
    currency:       sheet.currency,
    units:          sheet.units,
    membersSharing: sheet.membersSharing,
    contingencyPct: Number(sheet.contingencyPct),
    notes:          sheet.notes,
    status:         sheet.status,
    approvedAt:     sheet.approvedAt,
    createdAt:      sheet.createdAt,
    updatedAt:      sheet.updatedAt,
    items,
    totals: { subtotal, contingency, grandTotal, perMember, perUnit },
  }
}
