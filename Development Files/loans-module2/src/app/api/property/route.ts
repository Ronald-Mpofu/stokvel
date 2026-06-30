// src/app/api/property/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'

const propertySchema = z.object({
  groupId:          z.string().uuid(),
  name:             z.string().min(2),
  description:      z.string().optional(),
  propertyAddress:  z.string().optional(),
  propertyType:     z.string().default('residential'),
  targetCapital:    z.coerce.number().positive(),
  currency:         z.string().default('USD'),
  managementFeePct:    z.coerce.number().min(0).max(1).default(0.10),
  maintenanceReservePct: z.coerce.number().min(0).max(1).default(0.05),
  bondAmount:       z.coerce.number().optional(),
  bondProvider:     z.string().optional(),
  notes:            z.string().optional(),
})

const contributeSchema = z.object({
  propertyGroupId: z.string().uuid(),
  userId:          z.string().uuid(),
  amount:          z.coerce.number().positive(),
  paymentMethod:   z.string().default('BANK_TRANSFER'),
  paymentRef:      z.string().optional(),
})

const rentalSchema = z.object({
  propertyGroupId: z.string().uuid(),
  period:          z.string().regex(/^\d{4}-\d{2}$/),
  grossRental:     z.coerce.number().positive(),
  notes:           z.string().optional(),
})

const valuationSchema = z.object({
  propertyGroupId: z.string().uuid(),
  valuationDate:   z.string(),
  marketValue:     z.coerce.number().positive(),
  valuedBy:        z.string().optional(),
  method:          z.string().optional(),
  documentUrl:     z.string().optional(),
  notes:           z.string().optional(),
})

// ── GET ───────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const groupId    = searchParams.get('groupId')
    const propertyId = searchParams.get('propertyId')

    // Single property detail
    if (propertyId) {
      const prop = await prisma.propertyGroup.findUnique({
        where:   { id: propertyId },
        include: {
          group:       { select: { name: true, currency: true } },
          stakes:      { include: { user: { select: { fullName: true, email: true, tier: true } } }, orderBy: { ownershipPct: 'desc' } },
          valuations:  { orderBy: { valuationDate: 'desc' } },
          rentalDistributions: {
            include: { shares: true },
            orderBy: { period: 'desc' },
            take:    12,
          },
        },
      })

      if (!prop) return NextResponse.json({ success: false, error: 'Property not found' }, { status: 404 })

      const totalRentalIncome = prop.rentalDistributions.reduce((s,d) => s + Number(d.netDistributed), 0)
      const latestValuation   = prop.valuations[0]
      const capitalGain       = latestValuation && prop.purchasePrice
        ? Number(latestValuation.marketValue) - Number(prop.purchasePrice)
        : 0

      return NextResponse.json({ success: true, data: { ...formatProperty(prop), totalRentalIncome, capitalGain } })
    }

    // List all properties (optionally for a group)
    const where: any = groupId ? { groupId } : {}
    const properties = await prisma.propertyGroup.findMany({
      where,
      include: {
        group:       { select: { name: true, currency: true } },
        stakes:      { select: { userId: true, ownershipPct: true, totalContributed: true } },
        valuations:  { orderBy: { valuationDate: 'desc' }, take: 1 },
        rentalDistributions: { select: { netDistributed: true } },
        _count:      { select: { stakes: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    const summary = {
      total:        properties.length,
      funding:      properties.filter(p => p.status === 'FUNDING').length,
      acquired:     properties.filter(p => p.status === 'ACQUIRED').length,
      renting:      properties.filter(p => p.status === 'RENTING').length,
      sold:         properties.filter(p => p.status === 'SOLD').length,
      totalValue:   properties.reduce((s,p) => s + (p.valuations[0] ? Number(p.valuations[0].marketValue) : Number(p.currentValue || 0)), 0),
      totalRaised:  properties.reduce((s,p) => s + Number(p.raisedCapital), 0),
      totalIncome:  properties.reduce((s,p) => s + p.rentalDistributions.reduce((ss,d) => ss + Number(d.netDistributed), 0), 0),
    }

    return NextResponse.json({ success: true, data: { properties: properties.map(formatProperty), summary } })
  } catch (e: any) {
    console.error('GET /api/property error:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── POST ──────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (body.action === 'CONTRIBUTE')  return handleContribute(body)
    if (body.action === 'RECORD_RENTAL') return handleRental(body)
    if (body.action === 'ADD_VALUATION') return handleValuation(body)
    if (body.action === 'UPDATE_STATUS') return handleStatusUpdate(body)

    // Create new property
    const data = propertySchema.parse(body)

    const property = await prisma.propertyGroup.create({
      data: {
        groupId:              data.groupId,
        name:                 data.name,
        description:          data.description,
        propertyAddress:      data.propertyAddress,
        propertyType:         data.propertyType,
        targetCapital:        data.targetCapital,
        currency:             data.currency as any,
        managementFeePct:     data.managementFeePct,
        maintenanceReservePct: data.maintenanceReservePct,
        bondAmount:           data.bondAmount,
        bondProvider:         data.bondProvider,
        notes:                data.notes,
        status:               'FUNDING',
      },
    })

    await prisma.auditLog.create({
      data: {
        action:      'CREATE',
        entityType:  'PropertyGroup',
        entityId:    property.id,
        description: `Property "${data.name}" created. Target: $${data.targetCapital.toLocaleString()}`,
      } as any,
    })

    return NextResponse.json({ success: true, data: { id: property.id }, message: `"${data.name}" property investment created` }, { status: 201 })
  } catch (e: any) {
    if (e instanceof z.ZodError) return NextResponse.json({ success: false, error: e.errors.map(x => x.message).join('; ') }, { status: 400 })
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── Contribute capital ────────────────────────────────────────
async function handleContribute(body: any): Promise<NextResponse> {
  const data = contributeSchema.parse(body)

  const property = await prisma.propertyGroup.findUnique({
    where:   { id: data.propertyGroupId },
    include: { stakes: true, group: { select: { currency: true } } },
  })
  if (!property) return NextResponse.json({ success: false, error: 'Property not found' }, { status: 404 })
  if (!['FUNDING', 'ACQUIRED'].includes(property.status)) {
    return NextResponse.json({ success: false, error: `Cannot contribute to a property with status: ${property.status}` }, { status: 400 })
  }

  const newRaised  = Number(property.raisedCapital) + data.amount
  const existingStake = property.stakes.find(s => s.userId === data.userId)
  const myContrib  = Number(existingStake?.totalContributed || 0) + data.amount

  await prisma.$transaction([
    // Update property raised capital
    prisma.propertyGroup.update({
      where: { id: data.propertyGroupId },
      data:  { raisedCapital: newRaised },
    }),
    // Upsert stake
    existingStake
      ? prisma.propertyStake.update({
          where: { id: existingStake.id },
          data:  { totalContributed: myContrib, ownershipPct: myContrib / newRaised * 100 },
        })
      : prisma.propertyStake.create({
          data: {
            propertyGroupId: data.propertyGroupId,
            userId:          data.userId,
            ownershipPct:    data.amount / newRaised * 100,
            totalContributed: data.amount,
            currency:        property.group.currency,
          },
        }),
    // Recalculate all other stakes
    prisma.$executeRaw`
      UPDATE "PropertyStake"
      SET "ownershipPct" = ("totalContributed" / ${newRaised}::decimal) * 100
      WHERE "propertyGroupId" = ${data.propertyGroupId}
      AND "userId" != ${data.userId}
    `,
    // Transaction record
    prisma.transaction.create({
      data: {
        type:          'INVESTMENT_CONTRIBUTION',
        status:        'COMPLETED',
        amount:        data.amount,
        currency:      property.group.currency,
        description:   `Property investment: ${property.name}`,
        reference:     data.paymentRef || `PROP-${Date.now()}`,
        paymentMethod: data.paymentMethod as any,
        userId:        data.userId,
      },
    }),
  ])

  return NextResponse.json({
    success: true,
    message: `$${data.amount.toFixed(2)} contributed. ${(myContrib / newRaised * 100).toFixed(2)}% ownership.`,
    data:    { newRaised, ownershipPct: myContrib / newRaised * 100 },
  })
}

// ── Record rental income ──────────────────────────────────────
async function handleRental(body: any): Promise<NextResponse> {
  const data = rentalSchema.parse(body)

  const property = await prisma.propertyGroup.findUnique({
    where:   { id: data.propertyGroupId },
    include: { stakes: { include: { user: { select: { fullName: true } } } }, group: { select: { currency: true } } },
  })
  if (!property) return NextResponse.json({ success: false, error: 'Property not found' }, { status: 404 })

  // Check not already distributed for this period
  const existing = await prisma.rentalDistribution.findFirst({
    where: { propertyGroupId: data.propertyGroupId, period: data.period },
  })
  if (existing) return NextResponse.json({ success: false, error: `Rental already recorded for ${data.period}` }, { status: 409 })

  const mgmtFee    = data.grossRental * Number(property.managementFeePct)
  const maintRes   = data.grossRental * Number(property.maintenanceReservePct)
  const platformFee = data.grossRental * 0.01  // 1% platform fee
  const netDist    = data.grossRental - mgmtFee - maintRes - platformFee

  const distribution = await prisma.$transaction(async (tx) => {
    const dist = await tx.rentalDistribution.create({
      data: {
        propertyGroupId: data.propertyGroupId,
        period:          data.period,
        grossRental:     data.grossRental,
        managementFee:   mgmtFee,
        maintenanceReserve: maintRes,
        platformFee,
        netDistributed:  netDist,
        currency:        property.group.currency,
      },
    })

    // Create shares for each stakeholder
    const shares = property.stakes.map(s => ({
      distributionId: dist.id,
      userId:         s.userId,
      ownershipPct:   Number(s.ownershipPct),
      amount:         netDist * Number(s.ownershipPct) / 100,
    }))

    await tx.rentalDistributionShare.createMany({ data: shares })

    // Update monthly rental on property
    await tx.propertyGroup.update({
      where: { id: data.propertyGroupId },
      data:  { monthlyRental: data.grossRental },
    })

    return dist
  })

  return NextResponse.json({
    success: true,
    message: `Rental of $${data.grossRental.toFixed(2)} recorded for ${data.period}. $${netDist.toFixed(2)} distributed to ${property.stakes.length} investors.`,
    data:    { id: distribution.id, netDistributed: netDist, sharesCreated: property.stakes.length },
  })
}

// ── Add valuation ─────────────────────────────────────────────
async function handleValuation(body: any): Promise<NextResponse> {
  const data = valuationSchema.parse(body)

  const val = await prisma.propertyValuation.create({
    data: {
      propertyGroupId: data.propertyGroupId,
      valuationDate:   new Date(data.valuationDate),
      marketValue:     data.marketValue,
      currency:        'USD' as any,
      valuedBy:        data.valuedBy,
      method:          data.method,
      documentUrl:     data.documentUrl,
      notes:           data.notes,
    },
  })

  // Update current value on property
  await prisma.propertyGroup.update({
    where: { id: data.propertyGroupId },
    data:  { currentValue: data.marketValue, lastValuationDate: new Date(data.valuationDate) },
  })

  return NextResponse.json({ success: true, data: { id: val.id }, message: `Valuation of $${data.marketValue.toLocaleString()} recorded.` })
}

// ── Status update (acquire, list for rent, mark sold) ─────────
async function handleStatusUpdate(body: any): Promise<NextResponse> {
  const { propertyGroupId, status, purchaseDate, purchasePrice, salePrice, soldAt } = body

  const updateData: any = { status }
  if (purchaseDate)  updateData.purchaseDate  = new Date(purchaseDate)
  if (purchasePrice) updateData.purchasePrice = purchasePrice
  if (salePrice)     updateData.salePrice     = salePrice
  if (soldAt)        updateData.soldAt        = new Date(soldAt)

  await prisma.propertyGroup.update({ where: { id: propertyGroupId }, data: updateData })

  return NextResponse.json({ success: true, message: `Property status updated to ${status}` })
}

// ── Format ────────────────────────────────────────────────────
function formatProperty(p: any) {
  const latestVal = p.valuations?.[0]
  const totalIncome = (p.rentalDistributions || []).reduce((s: number, d: any) => s + Number(d.netDistributed), 0)
  const fundingPct  = Number(p.targetCapital) > 0
    ? Math.min(100, Math.round(Number(p.raisedCapital) / Number(p.targetCapital) * 100))
    : 0

  return {
    id:               p.id,
    groupId:          p.groupId,
    groupName:        p.group?.name,
    name:             p.name,
    description:      p.description,
    propertyAddress:  p.propertyAddress,
    propertyType:     p.propertyType,
    status:           p.status,
    currency:         p.group?.currency || p.currency,
    targetCapital:    Number(p.targetCapital),
    raisedCapital:    Number(p.raisedCapital),
    fundingPct,
    currentValue:     latestVal ? Number(latestVal.marketValue) : Number(p.currentValue || 0),
    lastValuationDate: latestVal?.valuationDate || p.lastValuationDate,
    monthlyRental:    Number(p.monthlyRental || 0),
    managementFeePct: Number(p.managementFeePct),
    maintenanceReservePct: Number(p.maintenanceReservePct),
    purchaseDate:     p.purchaseDate,
    purchasePrice:    Number(p.purchasePrice || 0),
    bondAmount:       Number(p.bondAmount || 0),
    bondProvider:     p.bondProvider,
    salePrice:        Number(p.salePrice || 0),
    soldAt:           p.soldAt,
    notes:            p.notes,
    stakeCount:       p._count?.stakes || p.stakes?.length || 0,
    totalIncome,
    stakes:           p.stakes?.map((s: any) => ({
      userId:          s.userId,
      fullName:        s.user?.fullName,
      email:           s.user?.email,
      tier:            s.user?.tier,
      ownershipPct:    Number(s.ownershipPct),
      totalContributed: Number(s.totalContributed),
      currentValue:    (latestVal ? Number(latestVal.marketValue) : Number(p.currentValue || 0)) * Number(s.ownershipPct) / 100,
    })),
    valuations:        p.valuations?.map((v: any) => ({
      id:            v.id,
      valuationDate: v.valuationDate,
      marketValue:   Number(v.marketValue),
      valuedBy:      v.valuedBy,
      method:        v.method,
      notes:         v.notes,
    })),
    rentalDistributions: p.rentalDistributions?.map((d: any) => ({
      id:             d.id,
      period:         d.period,
      grossRental:    Number(d.grossRental),
      managementFee:  Number(d.managementFee),
      maintenanceReserve: Number(d.maintenanceReserve),
      netDistributed: Number(d.netDistributed),
      distributedAt:  d.distributedAt,
      sharesCount:    d.shares?.length || 0,
    })),
    createdAt: p.createdAt,
  }
}
