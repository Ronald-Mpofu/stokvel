import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'

const incomeSchema = z.object({
  assetId:     z.string().uuid(),
  groupId:     z.string().uuid(),
  type:        z.enum(['RENTAL','HIRE','DIVIDEND','SALE_PROCEEDS','OTHER']),
  amount:      z.coerce.number().positive(),
  expenses:    z.coerce.number().min(0).default(0),
  description: z.string().min(1),
  incomeDate:  z.string(),
  reference:   z.string().optional(),
  notes:       z.string().optional(),
})

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const assetId = searchParams.get('assetId')
    if (!assetId) return NextResponse.json({ success:false, error:'assetId required' }, { status:400 })

    const [incomes, asset] = await Promise.all([
      prisma.assetIncome.findMany({
        where: { assetId },
        include: { distributions: true },
        orderBy: { incomeDate: 'desc' },
      }),
      prisma.asset.findUnique({
        where: { id: assetId },
        include: {
          ownerships: { include: { user: { select: { fullName: true } } } },
          backers:    { where: { status: 'ACTIVE' }, select: { id: true, fullName: true, ownershipPct: true } },
          group:      { select: { currency: true } },
        },
      }),
    ])

    if (!asset) return NextResponse.json({ success:false, error:'Asset not found' }, { status:404 })

    const totalIncome = incomes.reduce((s,i) => s + Number(i.netAmount), 0)
    const totalDistributed = incomes.filter(i => i.status === 'DISTRIBUTED').reduce((s,i) => s + Number(i.netAmount), 0)

    return NextResponse.json({
      success: true,
      data: {
        incomes: incomes.map(i => ({
          id:           i.id,
          type:         i.type,
          amount:       Number(i.amount),
          expenses:     Number(i.expenses),
          netAmount:    Number(i.netAmount),
          description:  i.description,
          incomeDate:   i.incomeDate,
          reference:    i.reference,
          status:       i.status,
          distributedAt: i.distributedAt,
          notes:        i.notes,
          createdAt:    i.createdAt,
          distributions: i.distributions.map(d => ({
            id:           d.id,
            userId:       d.userId,
            backerId:     d.backerId,
            ownershipPct: Number(d.ownershipPct),
            shareAmount:  Number(d.shareAmount),
            status:       d.status,
            paidAt:       d.paidAt,
          })),
        })),
        stakeholders: [
          ...asset.ownerships.map(o => ({
            id:           o.userId,
            name:         o.user.fullName,
            type:         'MEMBER',
            ownershipPct: Number(o.ownershipPct),
          })),
          ...asset.backers.map(b => ({
            id:           b.id,
            name:         b.fullName,
            type:         'BACKER',
            ownershipPct: Number(b.ownershipPct),
          })),
        ],
        summary: { totalIncome, totalDistributed, pendingDistribution: totalIncome - totalDistributed },
      },
    })
  } catch (e: any) {
    return NextResponse.json({ success:false, error:e.message }, { status:500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (body.action === 'DISTRIBUTE') return handleDistribute(body)

    const data = incomeSchema.parse(body)
    const netAmount = data.amount - data.expenses

    const asset = await prisma.asset.findUnique({
      where: { id: data.assetId },
      include: { group: { select: { currency: true } } },
    })
    if (!asset) return NextResponse.json({ success:false, error:'Asset not found' }, { status:404 })

    const income = await prisma.assetIncome.create({
      data: {
        assetId:     data.assetId,
        groupId:     data.groupId,
        type:        data.type,
        amount:      data.amount,
        expenses:    data.expenses,
        netAmount,
        currency:    asset.group.currency as any,
        description: data.description,
        incomeDate:  new Date(data.incomeDate),
        reference:   data.reference,
        notes:       data.notes,
      },
    })

    // Update asset incomeGenerated
    await prisma.asset.update({
      where: { id: data.assetId },
      data:  { incomeGenerated: { increment: netAmount } },
    })

    return NextResponse.json({
      success: true,
      data:    { id: income.id, netAmount },
      message: `Income of $${netAmount.toFixed(2)} recorded. Ready to distribute.`,
    }, { status:201 })
  } catch (e: any) {
    if (e instanceof z.ZodError) return NextResponse.json({ success:false, error:e.errors.map((x:any)=>x.message).join('; ') }, { status:400 })
    return NextResponse.json({ success:false, error:e.message }, { status:500 })
  }
}

async function handleDistribute(body: any): Promise<NextResponse> {
  const { incomeId } = body
  const income = await prisma.assetIncome.findUniqueOrThrow({
    where: { id: incomeId },
    include: {
      asset: {
        include: {
          ownerships: { include: { user: { select: { fullName: true } } } },
          backers:    { where: { status: 'ACTIVE' } },
          group:      { select: { currency: true } },
        },
      },
    },
  })

  if (income.status === 'DISTRIBUTED') {
    return NextResponse.json({ success:false, error:'Already distributed' }, { status:400 })
  }

  const shares: any[] = []
  const asset = income.asset
  const netAmount = Number(income.netAmount)

  // Member shares
  for (const o of asset.ownerships) {
    const pct = Number(o.ownershipPct)
    if (pct > 0) {
      shares.push({ incomeId, assetId: asset.id, userId: o.userId, ownershipPct: pct, shareAmount: netAmount * pct / 100, currency: asset.group.currency })
    }
  }
  // Backer shares
  for (const b of asset.backers) {
    const pct = Number(b.ownershipPct)
    if (pct > 0) {
      shares.push({ incomeId, assetId: asset.id, backerId: b.id, ownershipPct: pct, shareAmount: netAmount * pct / 100, currency: asset.group.currency })
    }
  }

  await prisma.$transaction([
    prisma.assetIncomeShare.createMany({ data: shares }),
    prisma.assetIncome.update({ where: { id: incomeId }, data: { status: 'DISTRIBUTED', distributedAt: new Date() } }),
    prisma.auditLog.create({ data: { action:'UPDATE', entityType:'AssetIncome', entityId:incomeId, description:`Income $${netAmount} distributed to ${shares.length} stakeholders` } }),
  ])

  return NextResponse.json({
    success: true,
    message: `$${netAmount.toFixed(2)} distributed to ${shares.length} stakeholders`,
    data:    { shares: shares.length },
  })
}
