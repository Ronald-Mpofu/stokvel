// src/app/api/users/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: params.id },
      include: {
        groupMemberships: { include: { group: { select: { id: true, name: true, status: true } } } },
        kycDocuments: true,
        reputationHistory: { orderBy: { createdAt: 'desc' }, take: 10 },
        auditLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    })
    if (!user) return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 })
    return NextResponse.json({ success: true, data: { ...user, reputationScore: Number(user.reputationScore) } })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json()
    const { role, status, kycStatus, tier } = body

    const updateData: any = {}
    if (role)      updateData.role      = role
    if (status)    updateData.status    = status
    if (kycStatus) updateData.kycStatus = kycStatus
    if (tier)      updateData.tier      = tier

    if (kycStatus === 'VERIFIED' || kycStatus === 'REJECTED') {
      updateData.kycReviewedAt = new Date()
    }

    const user = await prisma.user.update({
      where: { id: params.id },
      data:  updateData,
    })

    await prisma.auditLog.create({
      data: {
        action:      'UPDATE',
        entityType:  'User',
        entityId:    params.id,
        description: `User updated: ${Object.keys(updateData).join(', ')}`,
      } as any,
    }).catch(() => {})

    return NextResponse.json({ success: true, message: 'User updated successfully', data: { id: user.id } })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── DELETE — full account deletion (Rules 1–3) ────────────────
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: params.id },
      select: {
        id: true, fullName: true, email: true,
        _count: {
          select: {
            groupMemberships:       true,
            contributions:          true,
            payoutsReceived:        true,
            loansAsBorrower:        true,
            loansAsGuarantor:       true,
            assetOwnerships:        true,
            assetQueueEntries:      true,
            savingsPoolMemberships: true,
            savingsContributions:   true,
            savingsLoans:           true,
            savingsPayouts:         true,
            propertyStakes:         true,
            investmentAllocations:  true,
            sentInvitations:        true,
          },
        },
      },
    })
    if (!user) return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 })

    const c = user._count
    const transactionCount = await prisma.transaction.count({ where: { userId: params.id } })

    // ── Enforce Rules 2 & 3 server-side ──────────────────────
    if (c.groupMemberships > 0) {
      return NextResponse.json({ success: false, error: 'Cannot delete: user belongs to one or more groups. Remove them from all groups first.' }, { status: 400 })
    }
    if (c.contributions > 0 || transactionCount > 0 || c.payoutsReceived > 0) {
      return NextResponse.json({ success: false, error: 'Cannot delete: user has payment transactions or contributions on record.' }, { status: 400 })
    }
    const schemeTotal =
      c.savingsPoolMemberships + c.savingsContributions + c.savingsLoans + c.savingsPayouts +
      c.loansAsBorrower + c.loansAsGuarantor + c.assetOwnerships + c.assetQueueEntries +
      c.propertyStakes + c.investmentAllocations
    if (schemeTotal > 0) {
      return NextResponse.json({ success: false, error: 'Cannot delete: user still participates in one or more Windfall schemes.' }, { status: 400 })
    }
    if (c.sentInvitations > 0) {
      return NextResponse.json({ success: false, error: 'Cannot delete: user has sent member invitations that must be cancelled first.' }, { status: 400 })
    }

    // ── Delete — clean up dependent housekeeping records first ─
    await prisma.$transaction(async (tx) => {
      await tx.notification.deleteMany({ where: { userId: params.id } })
      await tx.reputationEvent.deleteMany({ where: { userId: params.id } })
      await tx.kycDocument.deleteMany({ where: { userId: params.id } })
      await tx.auditLog.deleteMany({ where: { userId: params.id } })
      await tx.paymentMethodRecord.deleteMany({ where: { userId: params.id } }).catch(() => {})
      await tx.user.delete({ where: { id: params.id } })
    })

    // Audit trail (not linked to the deleted user)
    await prisma.auditLog.create({
      data: {
        action:      'DELETE',
        entityType:  'User',
        entityId:    params.id,
        description: `User account deleted: ${user.fullName} (${user.email})`,
      } as any,
    }).catch(() => {})

    return NextResponse.json({ success: true, message: `${user.fullName} has been permanently deleted.` })
  } catch (e: any) {
    console.error('DELETE /api/users/[id] error:', e)
    let msg = e.message
    if (e?.code === 'P2003') msg = 'Cannot delete: user still has linked records in the system.'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
