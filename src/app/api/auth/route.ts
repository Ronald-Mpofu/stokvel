// src/app/api/auth/refresh/route.ts
// POST — verifies the refresh_token cookie and re-issues both tokens.
// The new access token is built from CURRENT database state, which is
// what flips joiningFeePaid to true in the JWT after the payment
// webhook updates the DB (the token itself can't be updated by the
// webhook — it lives in the member's browser).
// Already allowlisted in middleware API_PUBLIC.

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'
import {
  verifyToken, signAccessToken, signRefreshToken,
  setAuthCookies, clearAuthCookies
} from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const refreshToken = req.cookies.get('refresh_token')?.value
    if (!refreshToken) {
      return NextResponse.json(
        { success: false, error: 'No refresh token. Please log in.' },
        { status: 401 }
      )
    }

    const payload = await verifyToken(refreshToken)
    if (!payload || (payload as any).type !== 'refresh' || !payload.sub) {
      const res = NextResponse.json(
        { success: false, error: 'Invalid refresh token. Please log in.' },
        { status: 401 }
      )
      return clearAuthCookies(res)
    }

    // Raw SQL (single round trip): "joiningFeePaid" is a raw-SQL column
    // NOT in schema.prisma, so it cannot go through findUnique's select.
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id","email","fullName","role","tier","kycStatus",
              "reputationScore","status","profilePhotoUrl","joiningFeePaid"
       FROM "User"
       WHERE "id" = $1 AND "deletedAt" IS NULL
       LIMIT 1`,
      payload.sub
    )
    const user = rows[0] || null

    if (!user || user.status !== 'ACTIVE') {
      const res = NextResponse.json(
        { success: false, error: 'Account unavailable. Please log in.' },
        { status: 401 }
      )
      return clearAuthCookies(res)
    }

    const sessionUser = {
      id: user.id, email: user.email, fullName: user.fullName,
      role: user.role as any, tier: user.tier as any,
      kycStatus: user.kycStatus as any,
      reputationScore: Number(user.reputationScore),
      profilePhotoUrl: user.profilePhotoUrl,
      joiningFeePaid: user.joiningFeePaid === true,
    }

    // Rotate BOTH tokens — same mechanics as login.
    // No audit log here: refresh fires routinely (15-min access expiry)
    // and would flood AuditLog with noise; LOGIN entries remain the
    // meaningful auth trail.
    const [accessToken, newRefreshToken] = await Promise.all([
      signAccessToken(sessionUser as any),
      signRefreshToken(user.id),
    ])

    const response = NextResponse.json({
      success: true,
      data: { user: sessionUser },
      message: 'Session refreshed',
    })

    return setAuthCookies(response, accessToken, newRefreshToken)
  } catch (e: any) {
    console.error('POST /api/auth/refresh error:', e?.message)
    return NextResponse.json(
      { success: false, error: 'Could not refresh session. Please log in.' },
      { status: 500 }
    )
  }
}
