// src/app/api/assets/queue/route.ts
// Manages the Round Robin asset queue — initialise, fetch, reorder

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'
import { randomBytes } from 'crypto'

// GET /api/assets/queue?assetId=xxx  — fetch queue for an asset
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const assetId = searchParams.get('assetId')
    if (!assetId) return NextResponse.json({ success: false, error: 'assetId required' }, { status: 400 })

    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
      include: {
        group: { select: { name: true, currency: true, contributionAmount: true } },
        queue: {
          include: { user: { select: { fullName: true, email: true, phone: true, reputationScore: true, tier: true } } },
          orderBy: { position: 'asc' },
        },
        costingSheet: { select: { totals: true, status: true } },
      },
    })

    if (!asset) return NextResponse.json({ success: false, error: 'Asset not found' }, { status: 404 })
    if (asset.campaignType !== 'ROUND_ROBIN') return NextResponse.json({ success: false, error: 'Asset is not a Round Robin campaign' }, { status: 400 })

    // Calculate per-queue-entry progress
    const currentEntry = asset.queue.find(e => e.status === 'FUNDING')
    const nextEntry    = asset.queue.find(e => e.status === 'WAITING')
    const unitCost     = Number(asset.unitCost || asset.targetAmount / Math.max(1, asset.unitsTotal))

    // Summary stats
    const delivered  = asset.queue.filter(e => e.status === 'DELIVERED').length
    const inProgress = asset.queue.filter(e => ['FUNDING','SOURCING','ORDERED'].includes(e.status)).length
    const waiting    = asset.queue.filter(e => e.status === 'WAITING').length
    const skipped    = asset.queue.filter(e => e.status === 'SKIPPED').length
    const totalRaisedForCurrent = currentEntry ? Number(currentEntry.raisedAmount) : 0
    const currentProgress = currentEntry ? Math.min(100, Math.round(totalRaisedForCurrent / unitCost * 100)) : 0

    return NextResponse.json({
      success: true,
      data: {
        asset: {
          id:                   asset.id,
          name:                 asset.name,
          type:                 asset.type,
          currency:             asset.group.currency,
          unitsTotal:           asset.unitsTotal,
          unitCost,
          contributionPerMember: Number(asset.contributionPerMember || asset.group.contributionAmount),
          positionStrategy:     asset.positionStrategy,
          allowOutsiders:       asset.allowOutsiders,
          groupName:            asset.group.name,
          status:               asset.status,
          make:                 asset.make,
          model:                asset.model,
          year:                 asset.year,
        },
        queue: asset.queue.map(e => ({
          id:             e.id,
          position:       e.position,
          userId:         e.userId,
          memberName:     e.user.fullName,
          memberEmail:    e.user.email,
          memberPhone:    e.user.phone,
          reputationScore: Number(e.user.reputationScore),
          tier:           e.user.tier,
          status:         e.status,
          targetAmount:   Number(e.targetAmount),
          raisedAmount:   Number(e.raisedAmount),
          fundingProgress: Number(e.targetAmount) > 0
            ? Math.min(100, Math.round(Number(e.raisedAmount) / Number(e.targetAmount) * 100))
            : 0,
          fundingStarted:  e.fundingStarted,
          orderedAt:       e.orderedAt,
          deliveredAt:     e.deliveredAt,
          deliveryNotes:   e.deliveryNotes,
          deliveryPhotoUrls: e.deliveryPhotoUrls,
          skippedAt:       e.skippedAt,
          skipReason:      e.skipReason,
          serialNumber:    e.serialNumber,
          createdAt:       e.createdAt,
        })),
        summary: {
          delivered, inProgress, waiting, skipped,
          totalMembers:     asset.queue.length,
          currentEntry:     currentEntry ? { position: currentEntry.position, memberName: currentEntry.user.fullName } : null,
          nextEntry:        nextEntry    ? { position: nextEntry.position,    memberName: nextEntry.user.fullName }    : null,
          currentProgress,
          totalRaisedForCurrent,
          unitCost,
          isQueueInitialised: asset.queue.length > 0,
          cycleComplete:    delivered === asset.unitsTotal,
        },
      },
    })
  } catch (e) {
    console.error('GET /api/assets/queue error:', e)
    return NextResponse.json({ success: false, error: 'Failed to fetch queue' }, { status: 500 })
  }
}

// POST /api/assets/queue — initialise queue from group members
const initSchema = z.object({
  assetId:  z.string().uuid(),
  strategy: z.enum(['SENIORITY','RANDOM','GROUP_VOTE']).default('SENIORITY'),
  memberIds: z.array(z.string().uuid()).optional(), // explicit order for GROUP_VOTE
})

export async function POST(req: NextRequest) {
  try {
    const data = initSchema.parse(await req.json())

    const asset = await prisma.asset.findUniqueOrThrow({
      where: { id: data.assetId },
      include: {
        group: {
          include: {
            members: {
              where: { status: 'ACTIVE' },
              include: {
                user: { select: { id: true, fullName: true, reputationScore: true, createdAt: true } },
              },
            },
          },
        },
        queue: true,
      },
    })

    if (asset.campaignType !== 'ROUND_ROBIN') {
      return NextResponse.json({ success: false, error: 'Not a Round Robin campaign' }, { status: 400 })
    }
    if (asset.queue.length > 0) {
      return NextResponse.json({ success: false, error: 'Queue already initialised. Reset it first to reinitialise.' }, { status: 400 })
    }

    const members = asset.group.members
    let ordered: typeof members

    if (data.strategy === 'SENIORITY') {
      ordered = [...members].sort((a, b) => {
        if (b.cyclesCompleted !== a.cyclesCompleted) return b.cyclesCompleted - a.cyclesCompleted
        return new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime()
      })
    } else if (data.strategy === 'RANDOM') {
      ordered = cryptoShuffle([...members])
    } else {
      // GROUP_VOTE — use provided order
      if (!data.memberIds || data.memberIds.length === 0) {
        return NextResponse.json({ success: false, error: 'memberIds required for GROUP_VOTE strategy' }, { status: 400 })
      }
      const memberMap = Object.fromEntries(members.map(m => [m.userId, m]))
      ordered = data.memberIds.map(id => memberMap[id]).filter(Boolean)
    }

    const unitCost = Number(asset.unitCost || asset.targetAmount / Math.max(1, asset.unitsTotal))

    await prisma.$transaction(async (tx) => {
      // Create queue entries
      await tx.assetQueueEntry.createMany({
        data: ordered.map((m, i) => ({
          assetId:      data.assetId,
          userId:       m.userId,
          position:     i + 1,
          status:       i === 0 ? 'FUNDING' : 'WAITING',
          targetAmount: unitCost,
          raisedAmount: 0,
          fundingStarted: i === 0 ? new Date() : null,
        })),
      })

      // Update asset position strategy
      await tx.asset.update({
        where: { id: data.assetId },
        data:  { positionStrategy: data.strategy },
      })

      await tx.auditLog.create({
        data: {
          action:      'CREATE',
          entityType:  'AssetQueue',
          entityId:    data.assetId,
          description: `Round Robin queue initialised for "${asset.name}". ${ordered.length} members. Strategy: ${data.strategy}`,
        },
      })
    })

    return NextResponse.json({
      success: true,
      message: `Queue initialised with ${ordered.length} members. ${ordered[0]?.user.fullName} is first in line.`,
      data:    { memberCount: ordered.length, firstMember: ordered[0]?.user.fullName },
    })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ success: false, error: 'Invalid input' }, { status: 400 })
    console.error('POST /api/assets/queue error:', e)
    return NextResponse.json({ success: false, error: 'Failed to initialise queue' }, { status: 500 })
  }
}

// PATCH — record contribution to current queue entry
const contribSchema = z.object({
  assetId:       z.string().uuid(),
  userId:        z.string().uuid(),
  amount:        z.coerce.number().positive(),
  paymentMethod: z.string().default('ECOCASH'),
  paymentRef:    z.string().optional(),
})

export async function PATCH(req: NextRequest) {
  try {
    const data = contribSchema.parse(await req.json())

    // Validate asset exists
    const assetCheck = await prisma.asset.findUnique({ where: { id: data.assetId }, select: { id: true, name: true, status: true, campaignType: true } })
    if (!assetCheck) {
      return NextResponse.json({ success: false, error: `Asset not found. Please refresh and try again.` }, { status: 404 })
    }
    if (assetCheck.campaignType !== 'ROUND_ROBIN') {
      return NextResponse.json({ success: false, error: `This asset is not a Round Robin campaign. Use the standard contribution form instead.` }, { status: 400 })
    }

    // Validate user exists
    const userCheck = await prisma.user.findUnique({ where: { id: data.userId }, select: { id: true, fullName: true } })
    if (!userCheck) {
      return NextResponse.json({ success: false, error: `Member not found (userId: ${data.userId}). Please refresh and select a valid member.` }, { status: 400 })
    }

    const currentEntry = await prisma.assetQueueEntry.findFirst({
      where: { assetId: data.assetId, status: 'FUNDING' },
      include: { asset: { include: { group: { select: { currency: true, name: true } } } } },
    })

    if (!currentEntry) {
      // Help diagnose — check if queue has been initialised at all
      const queueCount = await prisma.assetQueueEntry.count({ where: { assetId: data.assetId } })
      if (queueCount === 0) {
        return NextResponse.json({ success: false, error: `Queue has not been initialised yet for "${assetCheck.name}". Go to Queue Manager and click Initialise Queue first.` }, { status: 400 })
      }
      const currentStatuses = await prisma.assetQueueEntry.findMany({ where: { assetId: data.assetId }, select: { status: true, position: true }, orderBy: { position: 'asc' } })
      const statusSummary = currentStatuses.map(e => `#${e.position}:${e.status}`).join(', ')
      return NextResponse.json({ success: false, error: `No queue entry is currently in FUNDING stage. Queue status: [${statusSummary}]. Advance the queue to activate the next member.` }, { status: 400 })
    }

    const newRaised     = Number(currentEntry.raisedAmount) + data.amount
    const isFullyFunded = newRaised >= Number(currentEntry.targetAmount)
    const fundingPct    = Math.min(100, Math.round(newRaised / Number(currentEntry.targetAmount) * 100))
    const ref           = data.paymentRef || `RR-${Date.now()}`

    // ── Parallel batch transaction — all 3 writes fire at once ──
    await prisma.$transaction([
      // 1. Update queue entry
      prisma.assetQueueEntry.update({
        where: { id: currentEntry.id },
        data: {
          raisedAmount: newRaised,
          status:       isFullyFunded ? 'SOURCING' : 'FUNDING',
          orderedAt:    isFullyFunded ? new Date() : undefined,
        },
      }),
      // 2. Increment asset raised amount
      prisma.asset.update({
        where: { id: data.assetId },
        data:  { raisedAmount: { increment: data.amount } },
      }),
      // 3. Transaction log
      prisma.transaction.create({
        data: {
          type:          'ASSET_CONTRIBUTION',
          status:        'COMPLETED',
          amount:        data.amount,
          currency:      currentEntry.asset.group.currency,
          assetId:       data.assetId,
          userId:        data.userId,
          reference:     ref,
          paymentMethod: data.paymentMethod as any,
          description:   `Round Robin contribution: ${currentEntry.asset.name} — Position ${currentEntry.position}`,
        },
      }),
    ], { timeout: 15000 })

    // ── Audit log — fire-and-forget, non-blocking ────────────
    prisma.auditLog.create({
      data: {
        userId:      data.userId,
        action:      'UPDATE',
        entityType:  'AssetQueueEntry',
        entityId:    currentEntry.id,
        description: `$${data.amount} contributed by ${userCheck.fullName} to RR position ${currentEntry.position}. ${isFullyFunded ? 'FULLY FUNDED — moving to sourcing.' : `${fundingPct}% funded.`}`,
      },
    }).catch(e => console.warn('Audit log failed (non-critical):', e.message))

    return NextResponse.json({
      success: true,
      message: isFullyFunded
        ? `🎉 Fully funded! "${currentEntry.asset.name}" position ${currentEntry.position} is moving to sourcing. Time to place the order.`
        : `$${data.amount} recorded for ${userCheck.fullName}. Position ${currentEntry.position} is ${fundingPct}% funded.`,
      data: { newRaisedAmount: newRaised, isFullyFunded, fundingProgress: fundingPct },
    })
  } catch (e: any) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: `Validation: ${e.errors.map((x:any) => x.message).join(', ')}` }, { status: 400 })
    }
    console.error('PATCH /api/assets/queue error:', e)

    let msg = 'Failed to record contribution'
    if (e?.code === 'P2025')      msg = 'Queue entry or asset not found. Please refresh.'
    else if (e?.code === 'P2002') msg = 'Duplicate entry detected.'
    else if (e?.code === 'P2003') msg = 'Invalid user or asset ID.'
    else if (e?.message?.includes('No entry currently in funding'))
                                  msg = 'No queue entry is currently in the funding stage. Initialise or advance the queue first.'
    else if (e?.message?.includes('column') || e?.message?.includes('field does not exist'))
                                  msg = 'Database schema outdated — run: npm run db:push then npm run db:generate'
    else if (e?.message?.includes('connect') || e?.message?.includes('timeout'))
                                  msg = 'Database connection timeout. Please try again in a moment.'
    else if (e?.message)          msg = e.message

    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

// DELETE — reset/clear queue (admin only)
export async function DELETE(req: NextRequest) {
  try {
    const { assetId } = await req.json()
    await prisma.assetQueueEntry.deleteMany({ where: { assetId } })
    await prisma.asset.update({ where: { id: assetId }, data: { raisedAmount: 0 } })
    return NextResponse.json({ success: true, message: 'Queue reset. You can now reinitialise.' })
  } catch (e) {
    return NextResponse.json({ success: false, error: 'Failed to reset queue' }, { status: 500 })
  }
}

function cryptoShuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomBytes(4).readUInt32BE(0) % (i + 1)
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}
