// src/app/api/assets/contribute/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'

const schema = z.object({
  assetId:       z.string().uuid(),
  userId:        z.string().uuid(),
  amount:        z.coerce.number().positive(),
  paymentMethod: z.string().default('ECOCASH'),
  paymentRef:    z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const data = schema.parse(await req.json())

    const asset = await prisma.asset.findUniqueOrThrow({
      where: { id: data.assetId },
      include: {
        group:      { select: { currency: true } },
        ownerships: true,
      },
    })

    if (asset.status !== 'FUNDING') {
      return NextResponse.json({ success: false, error: 'Asset is no longer accepting contributions' }, { status: 400 })
    }

    const newRaised = Number(asset.raisedAmount) + data.amount
    const isFullyFunded = newRaised >= Number(asset.targetAmount)

    await prisma.$transaction(async (tx) => {
      // Update raised amount
      await tx.asset.update({
        where: { id: data.assetId },
        data:  {
          raisedAmount: newRaised,
          status: isFullyFunded ? 'ACQUIRED' : 'FUNDING',
          acquisitionCost: isFullyFunded ? newRaised : undefined,
          acquiredAt:  isFullyFunded ? new Date() : undefined,
        },
      })

      // Recalculate all ownership percentages
      const existingOwnership = asset.ownerships.find(o => o.userId === data.userId)
      const newContributedAmount = Number(existingOwnership?.amountContributed || 0) + data.amount

      if (existingOwnership) {
        await tx.assetOwnership.update({
          where: { id: existingOwnership.id },
          data:  { amountContributed: newContributedAmount },
        })
      } else {
        await tx.assetOwnership.create({
          data: {
            assetId:           data.assetId,
            userId:            data.userId,
            ownershipPct:      0, // recalculated below
            amountContributed: data.amount,
          },
        })
      }

      // Recalculate all ownership percentages based on new total
      const allOwnerships = await tx.assetOwnership.findMany({ where: { assetId: data.assetId } })
      for (const o of allOwnerships) {
        const contrib = o.userId === data.userId ? newContributedAmount : Number(o.amountContributed)
        const pct = newRaised > 0 ? (contrib / newRaised) * 100 : 0
        await tx.assetOwnership.update({ where: { id: o.id }, data: { ownershipPct: pct } })
      }

      // Transaction record
      await tx.transaction.create({
        data: {
          type:          'ASSET_CONTRIBUTION',
          status:        'COMPLETED',
          amount:        data.amount,
          currency:      asset.group.currency,
          assetId:       data.assetId,
          userId:        data.userId,
          reference:     data.paymentRef || `ASSET-${Date.now()}`,
          paymentMethod: data.paymentMethod as any,
          description:   `Asset contribution: ${asset.name}`,
        },
      })

      // Audit
      await tx.auditLog.create({
        data: {
          userId:      data.userId,
          action:      'CREATE',
          entityType:  'AssetOwnership',
          entityId:    data.assetId,
          description: `Contribution of $${data.amount} to asset "${asset.name}". ${isFullyFunded ? 'FULLY FUNDED!' : `${Math.round(newRaised/Number(asset.targetAmount)*100)}% funded.`}`,
        },
      })
    })

    return NextResponse.json({
      success: true,
      message: isFullyFunded
        ? `🎉 Asset fully funded! "${asset.name}" is now acquired.`
        : `Contribution of $${data.amount} recorded. ${Math.round(newRaised/Number(asset.targetAmount)*100)}% funded.`,
      data: { newRaisedAmount: newRaised, isFullyFunded, fundingProgress: Math.round(newRaised/Number(asset.targetAmount)*100) },
    })
  } catch (error) {
    console.error('Asset contribute error:', error)
    return NextResponse.json({ success: false, error: 'Failed to record contribution' }, { status: 500 })
  }
}
