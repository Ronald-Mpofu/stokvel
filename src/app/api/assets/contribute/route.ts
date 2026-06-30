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

    // ── Pre-flight checks (outside transaction — fast reads) ──
    const [user, asset] = await Promise.all([
      prisma.user.findUnique({ where: { id: data.userId }, select: { id: true, fullName: true } }),
      prisma.asset.findUnique({
        where: { id: data.assetId },
        select: {
          id: true, name: true, status: true,
          raisedAmount: true, targetAmount: true,
          group: { select: { currency: true } },
          ownerships: { select: { id: true, userId: true, amountContributed: true } },
        },
      }),
    ])

    if (!user) {
      return NextResponse.json({ success: false, error: `Member not found. Please refresh and select a valid member.` }, { status: 400 })
    }
    if (!asset) {
      return NextResponse.json({ success: false, error: `Asset not found. Please refresh and try again.` }, { status: 404 })
    }
    if (asset.status !== 'FUNDING') {
      return NextResponse.json({ success: false, error: `Asset is no longer accepting contributions. Current status: ${asset.status}` }, { status: 400 })
    }

    const newRaised      = Number(asset.raisedAmount) + data.amount
    const isFullyFunded  = newRaised >= Number(asset.targetAmount)
    const fundingPct     = Math.min(100, Math.round(newRaised / Number(asset.targetAmount) * 100))
    const existing       = asset.ownerships.find(o => o.userId === data.userId)
    const myNewContrib   = Number(existing?.amountContributed || 0) + data.amount

    // ── Pre-calculate all new ownership %s (no DB needed) ────
    const ownershipUpdates = asset.ownerships.map(o => ({
      id:         o.id,
      userId:     o.userId,
      newContrib: o.userId === data.userId ? myNewContrib : Number(o.amountContributed),
      newPct:     newRaised > 0
        ? ((o.userId === data.userId ? myNewContrib : Number(o.amountContributed)) / newRaised) * 100
        : 0,
    }))
    // New owner not yet in ownerships
    const newOwnerPct = existing ? null : (data.amount / newRaised) * 100

    // ── Interactive transaction — supports timeout ────────────
    await prisma.$transaction(async (tx) => {
      // 1. Update asset raised amount + status
      await tx.asset.update({
        where: { id: data.assetId },
        data: {
          raisedAmount:    newRaised,
          status:          isFullyFunded ? 'ACQUIRED' : 'FUNDING',
          acquisitionCost: isFullyFunded ? newRaised  : undefined,
          acquiredAt:      isFullyFunded ? new Date() : undefined,
        },
      })

      // 2. Upsert this member's ownership record
      if (existing) {
        await tx.assetOwnership.update({
          where: { id: existing.id },
          data:  { amountContributed: myNewContrib, ownershipPct: myNewContrib / newRaised * 100 },
        })
      } else {
        await tx.assetOwnership.create({
          data: {
            assetId:           data.assetId,
            userId:            data.userId,
            amountContributed: data.amount,
            ownershipPct:      newOwnerPct!,
          },
        })
      }

      // 3. Recalculate existing OTHER owners' percentages in one batch
      await tx.$executeRaw`
        UPDATE "AssetOwnership"
        SET "ownershipPct" = ("amountContributed" / ${newRaised}::decimal) * 100
        WHERE "assetId" = ${data.assetId}
        AND "userId" != ${data.userId}
      `

      // 4. Transaction log
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
    }, { timeout: 15000 })

    // ── Audit log — fire-and-forget, non-blocking ────────────
    prisma.auditLog.create({
      data: {
        userId:      data.userId,
        action:      'CREATE',
        entityType:  'AssetOwnership',
        entityId:    data.assetId,
        description: `$${data.amount} contributed to "${asset.name}" by ${user.fullName}. ${isFullyFunded ? 'FULLY FUNDED!' : `${fundingPct}% funded.`}`,
      },
    }).catch(e => console.warn('Audit log failed (non-critical):', e.message))

    return NextResponse.json({
      success: true,
      message: isFullyFunded
        ? `🎉 Asset fully funded! "${asset.name}" is now acquired.`
        : `Contribution of $${data.amount} recorded for ${user.fullName}. ${fundingPct}% funded.`,
      data: { newRaisedAmount: newRaised, isFullyFunded, fundingProgress: fundingPct },
    })

  } catch (error: any) {
    console.error('Asset contribute error:', error)

    let msg = 'Failed to record contribution'
    if (error?.code === 'P2025')      msg = 'Asset or member record not found. Please refresh and try again.'
    else if (error?.code === 'P2002') msg = 'Duplicate contribution detected — this may have already been recorded.'
    else if (error?.code === 'P2003') msg = 'Invalid member or asset reference. Please refresh.'
    else if (error?.message?.includes('column') || error?.message?.includes('does not exist'))
                                      msg = 'Database schema is outdated. Run: npm run db:push, then npm run db:generate'
    else if (error?.message?.includes('timeout') || error?.message?.includes('connect'))
                                      msg = 'Database timeout — the connection is busy. Wait 10 seconds and try again. If this persists, check your Supabase connection pooler settings.'
    else if (error?.message)          msg = error.message

    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
