// src/app/api/auth/login/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'
import {
  verifyPassword, signAccessToken, signRefreshToken,
  setAuthCookies
} from '@/lib/auth'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, password } = loginSchema.parse(body)

    // Raw SQL (single round trip): "joiningFeePaid" is a raw-SQL column
    // NOT in schema.prisma, so it cannot go through findUnique's select.
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id","email","fullName","passwordHash","role","tier",
              "kycStatus","reputationScore","status","profilePhotoUrl",
              "isBlacklisted","joiningFeePaid"
       FROM "User"
       WHERE "email" = $1 AND "deletedAt" IS NULL
       LIMIT 1`,
      email.toLowerCase()
    )
    const user = rows[0] || null

    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return NextResponse.json(
        { success: false, error: 'Invalid email or password' },
        { status: 401 }
      )
    }

    if (user.status !== 'ACTIVE') {
      return NextResponse.json(
        { success: false, error: `Account is ${user.status.toLowerCase()}. Contact support.` },
        { status: 403 }
      )
    }

    const sessionUser = {
      id: user.id, email: user.email, fullName: user.fullName,
      role: user.role as any, tier: user.tier as any,
      kycStatus: user.kycStatus as any,
      reputationScore: Number(user.reputationScore),
      profilePhotoUrl: user.profilePhotoUrl,
      joiningFeePaid: user.joiningFeePaid === true,
    }

    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken(sessionUser),
      signRefreshToken(user.id),
    ])

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastLoginIp: req.ip || 'unknown' },
    })

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'LOGIN',
        entityType: 'User',
        entityId: user.id,
        ipAddress: req.ip || 'unknown',
        userAgent: req.headers.get('user-agent') || undefined,
        description: `User ${user.email} logged in`,
      },
    })

    const response = NextResponse.json({
      success: true,
      data: { user: sessionUser },
      message: 'Login successful',
    })

    return setAuthCookies(response, accessToken, refreshToken)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.errors },
        { status: 400 }
      )
    }
    console.error('Login error:', error)
    return NextResponse.json(
      { success: false, error: 'An error occurred. Please try again.' },
      { status: 500 }
    )
  }
}
