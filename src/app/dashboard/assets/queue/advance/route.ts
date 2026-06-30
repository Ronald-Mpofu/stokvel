// src/app/api/assets/queue/advance/route.ts
// Advances queue: SOURCING→ORDERED→DELIVERED, then activates next member

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'

const schema = z.object({
  entryId:          z.string().uuid(),
  action:           z.enum(['MARK_ORDERED','MARK_DELIVERED','SKIP']),
  serialNumber:     z.string().optional(),
  deliveryNotes:    z.string().optional(),
  deliveryPhotoUrls: z.array(z.string()).optional(),
  skipReason:       z.string().optional(),
  supplierRef:      z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const data = schema.parse(await req.json())

    const entry = await prisma.assetQueueEntry.findUniqueOrThrow({
      where: { id: data.entryId },
      include: {
        asset: { include: { group: { select: { name: true, currency: true } } } },
        user:  { select: { fullName: true } },
      },
    })

    let message = ''

    await prisma.$transaction(async (tx) => {
      if (data.action === 'MARK_ORDERED') {
        if (entry.status !== 'SOURCING') throw new Error('Entry must be in SOURCING status to mark as ordered')
        await tx.assetQueueEntry.update({
          where: { id: data.entryId },
          data: { status: 'ORDERED', orderedAt: new Date(), serialNumber: data.serialNumber },
        })
        message = `Order placed for ${entry.user.fullName}'s unit. Awaiting delivery.`
      }

      else if (data.action === 'MARK_DELIVERED') {
        if (!['ORDERED','SOURCING'].includes(entry.status)) throw new Error('Entry must be ORDERED or SOURCING to mark delivered')
        await tx.assetQueueEntry.update({
          where: { id: data.entryId },
          data: {
            status:            'DELIVERED',
            deliveredAt:       new Date(),
            deliveryNotes:     data.deliveryNotes,
            deliveryPhotoUrls: data.deliveryPhotoUrls ? JSON.stringify(data.deliveryPhotoUrls) : undefined,
            serialNumber:      data.serialNumber || entry.serialNumber,
          },
        })

        // Create ownership record for this member
        await tx.assetOwnership.upsert({
          where: { assetId_userId: { assetId: entry.assetId, userId: entry.userId } },
          update: { amountContributed: entry.raisedAmount, ownershipPct: 100 },
          create: {
            assetId:           entry.assetId,
            userId:            entry.userId,
            ownershipPct:      100,   // They own 100% of THEIR unit
            amountContributed: entry.raisedAmount,
          },
        })

        // Activate next WAITING entry
        const nextEntry = await tx.assetQueueEntry.findFirst({
          where: { assetId: entry.assetId, status: 'WAITING' },
          orderBy: { position: 'asc' },
        })
        if (nextEntry) {
          await tx.assetQueueEntry.update({
            where: { id: nextEntry.id },
            data:  { status: 'FUNDING', fundingStarted: new Date() },
          })
          message = `✅ Delivered to ${entry.user.fullName}! Queue advanced — ${nextEntry.userId} is now funding.`
        } else {
          // All delivered — mark asset as completed
          await tx.asset.update({
            where: { id: entry.assetId },
            data:  { status: 'ACQUIRED', acquiredAt: new Date() },
          })
          message = `🎉 Final unit delivered to ${entry.user.fullName}! Full Round Robin cycle complete.`
        }
      }

      else if (data.action === 'SKIP') {
        await tx.assetQueueEntry.update({
          where: { id: data.entryId },
          data: { status: 'SKIPPED', skippedAt: new Date(), skipReason: data.skipReason },
        })
        // Activate next WAITING entry
        const nextEntry = await tx.assetQueueEntry.findFirst({
          where: { assetId: entry.assetId, status: 'WAITING' },
          orderBy: { position: 'asc' },
        })
        if (nextEntry) {
          await tx.assetQueueEntry.update({
            where: { id: nextEntry.id },
            data:  { status: 'FUNDING', fundingStarted: new Date() },
          })
        }
        message = `${entry.user.fullName} skipped. Queue advanced to next member.`
      }

      await tx.auditLog.create({
        data: {
          action:      'UPDATE',
          entityType:  'AssetQueueEntry',
          entityId:    data.entryId,
          description: `Queue action: ${data.action} for position ${entry.position} (${entry.user.fullName}). ${message}`,
        },
      })
    })

    return NextResponse.json({ success: true, message })
  } catch (e: any) {
    console.error('Queue advance error:', e)
    return NextResponse.json({ success: false, error: e.message || 'Failed to advance queue' }, { status: 500 })
  }
}
