// src/app/api/members/route.ts
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const groupId = searchParams.get('groupId')
    const status  = searchParams.get('status') || 'ACTIVE'

    const where: any = { status }
    if (groupId) where.groupId = groupId

    const members = await prisma.groupMember.findMany({
      where,
      include: {
        user:  { select: { id: true, fullName: true, email: true, phone: true, tier: true, reputationScore: true, kycStatus: true } },
        group: { select: { name: true, currency: true } },
      },
      orderBy: { user: { fullName: 'asc' } },
    })

    return NextResponse.json({
      success: true,
      data: members.map(m => ({
        id:             m.user.id,
        memberId:       m.id,
        fullName:       m.user.fullName,
        email:          m.user.email,
        phone:          m.user.phone,
        tier:           m.user.tier,
        reputationScore: Number(m.user.reputationScore),
        kycStatus:      m.user.kycStatus,
        role:           m.role,
        status:         m.status,
        payoutPosition: m.payoutPosition,
        totalContributed: Number(m.totalContributed),
        groupId:        m.groupId,
        groupName:      m.group.name,
        joinedAt:       m.joinedAt,
      })),
    })
  } catch (error) {
    console.error('GET /api/members error:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch members' }, { status: 500 })
  }
}
