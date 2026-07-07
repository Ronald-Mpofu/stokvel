// src/app/api/auth/register/route.ts
// Public self-signup — always creates role = MEMBER (admins are provisioned, never self-registered).
// Mirrors login route mechanics: JWT access/refresh tokens + setAuthCookies + audit log.
// After success the client redirects to /dashboard/join-fee (fee gate).
//
// NOTE: assumes @/lib/auth exports hashPassword (counterpart of verifyPassword).
// If yours is named differently (e.g. hashPw), change the single import below.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'
import {
  hashPassword, signAccessToken, signRefreshToken,
  setAuthCookies
} from '@/lib/auth'

const registerSchema = z.object({
  fullName: z.string().min(2, 'Full name is required').max(120),
  email: z.string().email('Enter a valid email address'),
  phone: z.string().min(6, 'Enter a valid phone number').max(20)
    .regex(/^\+?[0-9\s-]+$/, 'Phone may only contain digits, spaces, dashes and a leading +'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  country: z.string().length(2, 'Choose your country').optional(),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = registerSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      )
    }

    const email = parsed.data.email.toLowerCase().trim()
    const phone = parsed.data.phone.replace(/[\s-]/g, '')
    const { fullName, password, country } = parsed.data

    // ONE query for both uniqueness checks (email + phone are indexed)
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { phone }] },
      select: { email: true, phone: true },
    })
    if (existing) {
      const which = existing.email === email ? 'email address' : 'phone number'
      return NextResponse.json(
        { success: false, error: `An account with this ${which} already exists. Try signing in.` },
        { status: 409 }
      )
    }

    const passwordHash = await hashPassword(password)

    let user
    try {
      user = await prisma.user.create({
        data: {
          email,
          phone,
          passwordHash,
          fullName: fullName.trim(),
          role: 'MEMBER',          // public signup NEVER creates admins
          country: country || null,
          // joiningFeePaid defaults to false via the raw-SQL column default
        },
        select: {
          id: true, email: true, fullName: true, role: true, tier: true,
          kycStatus: true, reputationScore: true, profilePhotoUrl: true,
        },
      })
    } catch (e: any) {
      // Race-condition safety: unique constraint hit between check and create
      if (e?.code === 'P2002') {
        return NextResponse.json(
          { success: false, error: 'An account with these details already exists. Try signing in.' },
          { status: 409 }
        )
      }
      throw e
    }

    const sessionUser = {
      id: user.id, email: user.email, fullName: user.fullName,
      role: user.role as any, tier: user.tier as any,
      kycStatus: user.kycStatus as any,
      reputationScore: Number(user.reputationScore),
      profilePhotoUrl: user.profilePhotoUrl,
    }

    // Auto-login: same token pair as the login route
    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken(sessionUser),
      signRefreshToken(user.id),
    ])

    // Audit log — CREATE action, fire-and-forget is NOT used: audit must persist
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'CREATE',
        entityType: 'User',
        entityId: user.id,
        ipAddress: req.ip || 'unknown',
        userAgent: req.headers.get('user-agent') || undefined,
        description: `User ${user.email} registered`,
      },
    })

    const response = NextResponse.json({
      success: true,
      data: { user: sessionUser },
      message: 'Account created',
    })

    return setAuthCookies(response, accessToken, refreshToken)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.errors },
        { status: 400 }
      )
    }
    console.error('POST /api/auth/register error:', (error as any)?.message)
    return NextResponse.json(
      { success: false, error: 'An error occurred. Please try again.' },
      { status: 500 }
    )
  }
}
