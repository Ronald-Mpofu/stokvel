// src/app/api/users/route.ts
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const role      = searchParams.get('role')
    const status    = searchParams.get('status')
    const kycStatus = searchParams.get('kycStatus')
    const search    = searchParams.get('search')

    const where: any = {}
    if (role)      where.role      = role
    if (status)    where.status    = status
    if (kycStatus) where.kycStatus = kycStatus
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email:    { contains: search, mode: 'insensitive' } },
        { phone:    { contains: search, mode: 'insensitive' } },
      ]
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true, fullName: true, email: true, phone: true,
        role: true, status: true, kycStatus: true, tier: true,
        reputationScore: true, country: true, city: true,
        createdAt: true, lastLoginAt: true, emailVerifiedAt: true,
        isBlacklisted: true, blacklistReason: true,
        _count: { select: { groupMemberships: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({
      success: true,
      data: users.map(u => ({
        ...u,
        reputationScore: Number(u.reputationScore),
        groupCount: u._count.groupMemberships,
      })),
    })
  } catch (e: any) {
    console.error('GET /api/users error:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
