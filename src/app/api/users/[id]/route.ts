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

    // Set kycReviewedAt when KYC status changes
    if (kycStatus === 'VERIFIED' || kycStatus === 'REJECTED') {
      updateData.kycReviewedAt = new Date()
    }

    const user = await prisma.user.update({
      where: { id: params.id },
      data:  updateData,
    })

    // Audit log
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
