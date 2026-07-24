// src/app/api/auth/forgot-password/route.ts
// Step 1 of password reset: user submits their email, we mint a single-use
// token (60-min expiry) and store only its hash. The raw token belongs in
// an email link — email delivery is not yet wired in this project, so until
// the notification system exists the reset URL is returned in the response
// ONLY in non-production, so the flow can be tested end to end.
//
// Security: the response is always a generic success, whether or not the
// email matches an account, so this endpoint can't be used to discover which
// emails are registered.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID, createHash } from 'crypto'
import prisma from '@/lib/prisma/client'

export const dynamic = 'force-dynamic'

const RESET_TTL_MINUTES = 60

const schema = z.object({
  email: z.string().email(),
})

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email } = schema.parse(body)

    const user = await prisma.user.findUnique({
      where:  { email: email.trim().toLowerCase() },
      select: { id: true, status: true },
    })

    // Generic response regardless of outcome — never leak account existence.
    const generic = NextResponse.json({
      success: true,
      message: 'If an account exists for that email, a password reset link has been sent.',
    })

    if (!user || user.status !== 'ACTIVE') return generic

    // Mint token: raw goes in the URL, only the hash is stored.
    const rawToken  = `${randomUUID()}${randomUUID()}`.replace(/-/g, '')
    const tokenHash = hashToken(rawToken)
    const id        = randomUUID()
    const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60_000)

    // Invalidate any earlier unused tokens for this user, then insert the new one.
    await prisma.$executeRawUnsafe(
      `UPDATE "PasswordResetToken" SET "usedAt" = NOW() WHERE "userId" = $1 AND "usedAt" IS NULL`,
      user.id,
    )
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PasswordResetToken" (id, "userId", "tokenHash", "expiresAt", "createdAt")
       VALUES ($1, $2, $3, $4, NOW())`,
      id, user.id, tokenHash, expiresAt,
    )

    const resetUrl = `${new URL(req.url).origin}/reset-password?token=${rawToken}`

    // TODO: when the notification system is wired, send `resetUrl` by email
    // here instead of returning it. See "Notification System" in remaining work.
    if (process.env.NODE_ENV !== 'production') {
      return NextResponse.json({
        success: true,
        message: 'If an account exists for that email, a password reset link has been sent.',
        devResetUrl: resetUrl,   // dev-only convenience; absent in production
      })
    }

    return generic
  } catch (e: any) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'A valid email address is required' }, { status: 400 })
    }
    console.error('POST /api/auth/forgot-password error:', e?.message)
    // Still generic to the client — don't surface internals on this endpoint.
    return NextResponse.json({
      success: true,
      message: 'If an account exists for that email, a password reset link has been sent.',
    })
  }
}
