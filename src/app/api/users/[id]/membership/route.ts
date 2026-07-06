// src/app/api/users/[id]/membership/route.ts
// Rule 4: remove from Group — only if user has no Windfall scheme participation
// Rule 5: remove from Scheme — only if user has no transactions in that scheme
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { action, groupId, scheme, schemeId } = await req.json()
    const userId = params.id

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, fullName: true } })
    if (!user) return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 })

    // ── Rule 4: REMOVE FROM GROUP ──────────────────────────────
    if (action === 'REMOVE_FROM_GROUP') {
      if (!groupId) return NextResponse.json({ success: false, error: 'groupId is required' }, { status: 400 })

      // Check scheme participation — blocks group removal
      const counts = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          _count: {
            select: {
              savingsPoolMemberships: true,
              savingsLoans:           true,
              assetOwnerships:        true,
              assetQueueEntries:      true,
              loansAsBorrower:        true,
              propertyStakes:         true,
              investmentAllocations:  true,
            },
          },
        },
      })
      const c = counts!._count
      const schemeBlockers: string[] = []
      if (c.savingsPoolMemberships > 0) schemeBlockers.push(`${c.savingsPoolMemberships} savings pool membership(s)`)
      if (c.savingsLoans > 0)           schemeBlockers.push(`${c.savingsLoans} savings loan(s)`)
      if (c.assetOwnerships > 0)        schemeBlockers.push(`${c.assetOwnerships} asset stake(s)`)
      if (c.assetQueueEntries > 0)      schemeBlockers.push(`${c.assetQueueEntries} asset queue position(s)`)
      if (c.loansAsBorrower > 0)        schemeBlockers.push(`${c.loansAsBorrower} loan(s)`)
      if (c.propertyStakes > 0)         schemeBlockers.push(`${c.propertyStakes} property stake(s)`)
      if (c.investmentAllocations > 0)  schemeBlockers.push(`${c.investmentAllocations} investment allocation(s)`)

      if (schemeBlockers.length > 0) {
        return NextResponse.json({
          success: false,
          error: `Cannot remove from group — user still belongs to Windfall scheme(s): ${schemeBlockers.join(', ')}. Exit all schemes first.`,
        }, { status: 400 })
      }

      const removed = await prisma.groupMember.deleteMany({ where: { groupId, userId } })
      if (removed.count === 0) {
        return NextResponse.json({ success: false, error: 'User is not a member of this group.' }, { status: 404 })
      }

      await prisma.auditLog.create({
        data: { action: 'DELETE', entityType: 'GroupMember', entityId: `${groupId}:${userId}`, description: `${user.fullName} removed from group` } as any,
      }).catch(() => {})

      return NextResponse.json({ success: true, message: `${user.fullName} removed from the group.` })
    }

    // ── Rule 5: REMOVE FROM SCHEME ─────────────────────────────
    if (action === 'REMOVE_FROM_SCHEME') {
      if (!scheme || !schemeId) return NextResponse.json({ success: false, error: 'scheme and schemeId are required' }, { status: 400 })

      // Savings Pool
      if (scheme === 'SAVINGS_POOL') {
        const contribCount = await prisma.savingsContribution.count({ where: { poolId: schemeId, userId, status: 'PAID' } })
        if (contribCount > 0) {
          return NextResponse.json({ success: false, error: `Cannot remove: user has ${contribCount} paid contribution(s) in this savings pool.` }, { status: 400 })
        }
        // Remove membership + any unpaid contribution schedule rows
        await prisma.$transaction(async (tx) => {
          await tx.savingsContribution.deleteMany({ where: { poolId: schemeId, userId } })
          await tx.savingsPoolMember.deleteMany({ where: { poolId: schemeId, userId } })
        })
        return NextResponse.json({ success: true, message: `${user.fullName} removed from the savings pool.` })
      }

      // Asset (shared ownership)
      if (scheme === 'ASSET') {
        const txnCount = await prisma.transaction.count({ where: { assetId: schemeId, userId } })
        if (txnCount > 0) {
          return NextResponse.json({ success: false, error: `Cannot remove: user has ${txnCount} payment transaction(s) on this asset.` }, { status: 400 })
        }
        await prisma.assetOwnership.deleteMany({ where: { assetId: schemeId, userId } })
        return NextResponse.json({ success: true, message: `${user.fullName} removed from the asset campaign.` })
      }

      // Asset queue (Round Robin)
      if (scheme === 'ASSET_QUEUE') {
        const txnCount = await prisma.transaction.count({ where: { assetId: schemeId, userId } })
        if (txnCount > 0) {
          return NextResponse.json({ success: false, error: `Cannot remove: user has ${txnCount} payment transaction(s) in this queue.` }, { status: 400 })
        }
        await prisma.assetQueueEntry.deleteMany({ where: { assetId: schemeId, userId } })
        return NextResponse.json({ success: true, message: `${user.fullName} removed from the asset queue.` })
      }

      return NextResponse.json({ success: false, error: `Unknown scheme type: ${scheme}. Supported: SAVINGS_POOL, ASSET, ASSET_QUEUE.` }, { status: 400 })
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 })
  } catch (e: any) {
    console.error('membership route error:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
