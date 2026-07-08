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

// ── POST /api/users — provision a staff user (SYSTEM_ADMIN only) ──
// Creates the account with an unusable random password and returns a
// one-time setup link for the admin to share. Staff roles are fee-exempt
// by role in middleware, so no joining fee is involved.
// NOTE: middleware already restricts /api/users to SYSTEM_ADMIN; the
// session check below is defence-in-depth, not the only barrier.

import { z } from 'zod'
import { randomUUID, randomBytes, createHash } from 'crypto'
import { getSessionFromRequest, hashPassword } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const STAFF_ROLES = ['SYSTEM_ADMIN', 'NATIONAL_ADMIN', 'AUDITOR'] as const

const provisionSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().min(6).max(20).regex(/^\+?[0-9\s-]+$/, 'Invalid phone'),
  role: z.enum(STAFF_ROLES),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req)
    if (!session || session.role !== 'SYSTEM_ADMIN') {
      return NextResponse.json(
        { success: false, error: 'Access denied. System Admin only.' },
        { status: 403 }
      )
    }

    const parsed = provisionSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      )
    }
    const email = parsed.data.email.toLowerCase().trim()
    const phone = parsed.data.phone.replace(/[\s-]/g, '')
    const { fullName, role } = parsed.data

    // One query for both uniqueness checks
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { phone }] },
      select: { email: true },
    })
    if (existing) {
      return NextResponse.json(
        { success: false, error: 'A user with this email or phone already exists' },
        { status: 409 }
      )
    }

    // Unusable random password — never known to anyone; replaced at setup
    const passwordHash = await hashPassword(randomBytes(32).toString('hex'))

    let user
    try {
      user = await prisma.user.create({
        data: { email, phone, passwordHash, fullName: fullName.trim(), role },
        select: { id: true, email: true, fullName: true, role: true },
      })
    } catch (e: any) {
      if (e?.code === 'P2002') {
        return NextResponse.json(
          { success: false, error: 'A user with this email or phone already exists' },
          { status: 409 }
        )
      }
      throw e
    }

    // One-time setup token (72h). Stored hashed; raw value returned once.
    const rawToken = randomBytes(32).toString('hex')
    const tokenHash = createHash('sha256').update(rawToken).digest('hex')
    await prisma.$executeRawUnsafe(
      `INSERT INTO "UserSetupToken" ("id","userId","tokenHash","createdById","expiresAt")
       VALUES ($1,$2,$3,$4, now() + interval '72 hours')`,
      randomUUID(), user.id, tokenHash, session.id
    )

    await prisma.auditLog.create({
      data: {
        userId: session.id,
        action: 'CREATE',
        entityType: 'User',
        entityId: user.id,
        description: `Provisioned ${role} account for ${user.email}`,
        ipAddress: req.ip || 'unknown',
        userAgent: req.headers.get('user-agent') || undefined,
      },
    })

    const origin = req.nextUrl.origin
    return NextResponse.json({
      success: true,
      message: 'Staff user created. Share the setup link — it expires in 72 hours.',
      data: {
        user,
        setupLink: `${origin}/setup/${rawToken}`,
      },
    })
  } catch (e: any) {
    console.error('POST /api/users error:', e?.message)
    return NextResponse.json({ success: false, error: 'Failed to create user' }, { status: 500 })
  }
}
