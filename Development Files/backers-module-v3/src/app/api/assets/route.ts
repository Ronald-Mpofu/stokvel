// src/app/api/assets/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'

const createAssetSchema = z.object({
  groupId:               z.string().uuid(),
  name:                  z.string().min(2).max(100),
  description:           z.string().optional(),
  campaignType:          z.enum(['SHARED_OWNERSHIP','ROUND_ROBIN']).default('SHARED_OWNERSHIP'),
  type:                  z.enum(['VEHICLE','AGRICULTURAL_MACHINERY','INDUSTRIAL_MACHINERY','COMPUTER_EQUIPMENT','HOME','OTHER']),
  targetAmount:          z.coerce.number().positive(),
  currency:              z.string().default('USD'),
  fundingDeadline:       z.string().optional(),
  make:                  z.string().optional(),
  model:                 z.string().optional(),
  year:                  z.coerce.number().optional(),
  serialNumber:          z.string().optional(),
  vin:                   z.string().optional(),
  location:              z.string().optional(),
  notes:                 z.string().optional(),
  unitsTotal:            z.coerce.number().min(1).default(1),
  unitCost:              z.coerce.number().optional(),
  contributionPerMember: z.coerce.number().optional(),
  positionStrategy:      z.string().default('SENIORITY'),
  allowOutsiders:        z.boolean().default(false),
})

// ── GET /api/assets ───────────────────────────────────────────
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
        campaignType:    (a as any).campaignType ?? 'SHARED_OWNERSHIP',
        unitsTotal:      (a as any).unitsTotal ?? 1,
        unitCost:        (a as any).unitCost ? Number((a as any).unitCost) : null,
        contributionPerMember: (a as any).contributionPerMember ? Number((a as any).contributionPerMember) : null,
        positionStrategy: (a as any).positionStrategy ?? 'SENIORITY',
        allowOutsiders:  (a as any).allowOutsiders ?? false,
        targetAmount:    Number(a.targetAmount),
        raisedAmount:    Number(a.raisedAmount),
        fundingProgress: Number(a.targetAmount) > 0
          ? Math.min(100, Math.round(Number(a.raisedAmount) / Number(a.targetAmount) * 100))
          : 0,
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
        ownerships: a.ownerships.map(o => ({
          userId:            o.userId,
          memberName:        o.user.fullName,
          ownershipPct:      Number(o.ownershipPct),
          amountContributed: Number(o.amountContributed),
          acquiredAt:        o.acquiredAt,
        })),
      })),
    })
  } catch (error: any) {
    console.error('GET /api/assets error:', error)
    return NextResponse.json({ success: false, error: error.message || 'Failed to fetch assets' }, { status: 500 })
  }
}

// ── POST /api/assets ──────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Validate
    const parseResult = createAssetSchema.safeParse(body)
    if (!parseResult.success) {
      const details = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ')
      return NextResponse.json({ success: false, error: `Validation failed: ${details}` }, { status: 400 })
    }
    const data = parseResult.data

    // Check group exists
    const group = await prisma.group.findUnique({ where: { id: data.groupId } })
    if (!group) {
      return NextResponse.json({ success: false, error: 'Group not found. Please select a valid group.' }, { status: 404 })
    }

    // Build create payload — only include new fields if they exist on the model
    // This makes the API resilient whether or not npm run db:push has been run
    const createData: any = {
      groupId:         data.groupId,
      name:            data.name,
      description:     data.description || null,
      type:            data.type,
      status:          'FUNDING',
      targetAmount:    data.targetAmount,
      currency:        group.currency,
      fundingDeadline: data.fundingDeadline ? new Date(data.fundingDeadline) : null,
      make:            data.make || null,
      model:           data.model || null,
      year:            data.year || null,
      serialNumber:    data.serialNumber || null,
      vin:             data.vin || null,
      location:        data.location || null,
      notes:           data.notes || null,
    }

    // Add new schema fields — these require db:push to have been run
    try {
      createData.campaignType          = data.campaignType
      createData.unitsTotal            = data.unitsTotal || 1
      createData.unitCost              = data.unitCost || null
      createData.contributionPerMember = data.contributionPerMember || null
      createData.positionStrategy      = data.positionStrategy || 'SENIORITY'
      createData.allowOutsiders        = data.allowOutsiders || false
    } catch {
      // New fields not on schema yet — will still create the asset without them
    }

    const asset = await prisma.$transaction(async (tx) => {
      const a = await tx.asset.create({ data: createData })

      await tx.auditLog.create({
        data: {
          groupId:     data.groupId,
          action:      'CREATE',
          entityType:  'Asset',
          entityId:    a.id,
          description: `${data.campaignType} campaign "${a.name}" created. Target: $${data.targetAmount}`,
        },
      })
      return a
    })

    return NextResponse.json({
      success: true,
      data:    { id: asset.id, name: asset.name, status: asset.status },
      message: `"${asset.name}" campaign created successfully`,
    }, { status: 201 })

  } catch (error: any) {
    console.error('POST /api/assets error:', error)

    // Surface the real database error to help diagnose
    let errorMsg = 'Failed to create asset campaign'
    if (error?.message?.includes('column') || error?.message?.includes('field')) {
      errorMsg = 'Database schema is outdated. Please run: npm run db:push — then try again.'
    } else if (error?.message?.includes('Unique constraint')) {
      errorMsg = 'An asset with this name already exists in this group.'
    } else if (error?.code === 'P2002') {
      errorMsg = 'Duplicate entry detected.'
    } else if (error?.message) {
      errorMsg = error.message
    }

    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 })
  }
}

// ── PATCH /api/assets — update asset settings ─────────────────
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { assetId, allowOutsiders, status, notes } = body

    if (!assetId) return NextResponse.json({ success: false, error: 'assetId required' }, { status: 400 })

    const updateData: any = {}
    if (allowOutsiders !== undefined) updateData.allowOutsiders = allowOutsiders
    if (status !== undefined)         updateData.status         = status
    if (notes !== undefined)          updateData.notes          = notes

    const asset = await prisma.asset.update({
      where: { id: assetId },
      data:  updateData,
      select: { id: true, name: true, allowOutsiders: true, status: true },
    })

    await prisma.auditLog.create({
      data: {
        action:      'UPDATE',
        entityType:  'Asset',
        entityId:    assetId,
        description: `Asset "${asset.name}" updated: ${JSON.stringify(updateData)}`,
      },
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      data:    asset,
      message: allowOutsiders !== undefined
        ? `Outside contributors ${allowOutsiders ? 'enabled' : 'disabled'} for "${asset.name}"`
        : `Asset "${asset.name}" updated`,
    })
  } catch (error: any) {
    console.error('PATCH /api/assets error:', error)
    return NextResponse.json({ success: false, error: error.message || 'Failed to update asset' }, { status: 500 })
  }
}
