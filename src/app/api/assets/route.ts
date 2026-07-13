// src/app/api/assets/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'

const createAssetSchema = z.object({
  groupId:        z.string().uuid(),
  name:           z.string().min(2).max(100),
  description:    z.string().optional(),
  type:           z.enum(['VEHICLE','AGRICULTURAL_MACHINERY','INDUSTRIAL_MACHINERY','COMPUTER_EQUIPMENT','HOME','OTHER']),
  targetAmount:   z.coerce.number().positive(),
  currency:       z.string().default('USD'),
  fundingDeadline: z.string().optional(),
  make:           z.string().optional(),
  model:          z.string().optional(),
  year:           z.coerce.number().optional(),
  serialNumber:   z.string().optional(),
  vin:            z.string().optional(),
  location:       z.string().optional(),
  notes:          z.string().optional(),
})

// GET /api/assets
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const groupId = searchParams.get('groupId')
    const type    = searchParams.get('type')
    const status  = searchParams.get('status')

    const where: any = {}
    if (groupId) where.groupId = groupId
    if (type)    where.type    = type
    if (status)  where.status  = status

    const assets = await prisma.asset.findMany({
      where,
      include: {
        group:      { select: { name: true, currency: true } },
        ownerships: { include: { user: { select: { fullName: true, email: true } } } },
        _count:     { select: { ownerships: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Summary stats
    const stats = await prisma.asset.groupBy({
      by: ['status'],
      where,
      _count: { status: true },
      _sum:   { targetAmount: true, raisedAmount: true, acquisitionCost: true },
    })

    return NextResponse.json({
      success: true,
      data: assets.map(a => ({
        id:              a.id,
        groupId:         a.groupId,
        groupName:       a.group.name,
        name:            a.name,
        description:     a.description,
        type:            a.type,
        status:          a.status,
        targetAmount:    Number(a.targetAmount),
        raisedAmount:    Number(a.raisedAmount),
        fundingProgress: Number(a.targetAmount) > 0 ? Math.min(100, Math.round(Number(a.raisedAmount) / Number(a.targetAmount) * 100)) : 0,
        currency:        a.group.currency,
        fundingDeadline: a.fundingDeadline,
        acquisitionCost: Number(a.acquisitionCost || 0),
        currentValue:    Number(a.currentValue || 0),
        incomeGenerated: Number(a.incomeGenerated || 0),
        ownerCount:      a._count.ownerships,
        make:            a.make,
        model:           a.model,
        year:            a.year,
        serialNumber:    a.serialNumber,
        vin:             a.vin,
        location:        a.location,
        photoUrls:       a.photoUrls,
        acquiredAt:      a.acquiredAt,
        disposedAt:      a.disposedAt,
        disposalPrice:   Number(a.disposalPrice || 0),
        notes:           a.notes,
        createdAt:       a.createdAt,
        ownerships:      a.ownerships.map(o => ({
          userId:        o.userId,
          memberName:    o.user.fullName,
          ownershipPct:  Number(o.ownershipPct),
          amountContributed: Number(o.amountContributed),
          acquiredAt:    o.acquiredAt,
        })),
      })),
      stats: stats.map(s => ({
        status:      s.status,
        count:       s._count.status,
        totalTarget: Number(s._sum.targetAmount || 0),
        totalRaised: Number(s._sum.raisedAmount || 0),
        totalCost:   Number(s._sum.acquisitionCost || 0),
      })),
    })
  } catch (error) {
    console.error('GET /api/assets error:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch assets' }, { status: 500 })
  }
}

// POST /api/assets — create asset campaign
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const data = createAssetSchema.parse(body)

    // Verify group exists
    const group = await prisma.group.findUnique({ where: { id: data.groupId } })
    if (!group) return NextResponse.json({ success: false, error: 'Group not found' }, { status: 404 })

    const asset = await prisma.$transaction(async (tx) => {
      const a = await tx.asset.create({
        data: {
          groupId:        data.groupId,
          name:           data.name,
          description:    data.description,
          type:           data.type as any,
          status:         'FUNDING',
          targetAmount:   data.targetAmount,
          currency:       group.currency as any,
          fundingDeadline: data.fundingDeadline ? new Date(data.fundingDeadline) : null,
          make:           data.make,
          model:          data.model,
          year:           data.year,
          serialNumber:   data.serialNumber,
          vin:            data.vin,
          location:       data.location,
          notes:          data.notes,
        },
      })

      await tx.auditLog.create({
        data: {
          groupId:     data.groupId,
          action:      'CREATE',
          entityType:  'Asset',
          entityId:    a.id,
          description: `Asset campaign "${a.name}" created. Target: ${data.targetAmount}`,
        },
      })
      return a
    })

    return NextResponse.json({
      success: true,
      data:    { id: asset.id, name: asset.name, status: asset.status },
      message: `Asset campaign "${asset.name}" created successfully`,
    }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'Validation failed', details: error.errors.map(e => e.message).join(', ') }, { status: 400 })
    }
    console.error('POST /api/assets error:', error)
    return NextResponse.json({ success: false, error: 'Failed to create asset campaign' }, { status: 500 })
  }
}
// ── APPEND THIS TO: src/app/api/assets/route.ts ──────────────
// Add after the last existing function in the file.
// Ensure 'import prisma from "@/lib/prisma/client"' is at the top.
// Ensure 'export const dynamic = "force-dynamic"' is at the top.

// ── Delete asset (temporary hard-delete — remove before go-live) ──
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const assetId = searchParams.get('assetId')
    if (!assetId) return NextResponse.json({ success: false, error: 'assetId required' }, { status: 400 })

    const asset = await prisma.asset.findUnique({
      where:  { id: assetId },
      select: { id: true, name: true },
    })
    if (!asset) return NextResponse.json({ success: false, error: 'Asset not found' }, { status: 404 })

    await prisma.$transaction(async (tx) => {
      // BackerContribution → AssetBacker
      const backers = await tx.assetBacker.findMany({ where: { assetId }, select: { id: true } })
      for (const b of backers) {
        await tx.backerContribution.deleteMany({ where: { backerId: b.id } })
      }
      await tx.assetBacker.deleteMany({ where: { assetId } })

      // AssetIncomeDistributionShare → AssetIncomeDistribution
      const dists = await tx.assetIncomeDistribution.findMany({ where: { assetId }, select: { id: true } })
      for (const d of dists) {
        await tx.assetIncomeDistributionShare.deleteMany({ where: { distributionId: d.id } })
      }
      await tx.assetIncomeDistribution.deleteMany({ where: { assetId } })

      // AssetCostingItem → AssetCostingSheet (cascade handled by onDelete: Cascade in schema)
      const sheet = await tx.assetCostingSheet.findUnique({ where: { assetId }, select: { id: true } })
      if (sheet) {
        await tx.assetCostingItem.deleteMany({ where: { sheetId: sheet.id } })
        await tx.assetCostingSheet.delete({ where: { id: sheet.id } })
      }

      await tx.assetQueueEntry.deleteMany({ where: { assetId } })
      await tx.assetOwnership.deleteMany({ where: { assetId } })
      await tx.asset.delete({ where: { id: assetId } })
    })

    return NextResponse.json({ success: true, message: `"${asset.name}" has been permanently deleted.` })
  } catch (e: any) {
    console.error('DELETE /api/assets error:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
