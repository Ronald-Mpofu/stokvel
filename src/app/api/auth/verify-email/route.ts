// src/app/api/auth/verify-email/route.ts
//
// Phase 6a, version 2 — adds the change-email exit route.
//
//   POST { action: 'verify', token }        public. Consume a link.
//   POST { action: 'resend' }               authenticated. New link.
//   POST { action: 'change-email', email }  authenticated. Fix a typo.
//   GET  ?token=...                         same as verify.
//
// ── WHY CHANGE-EMAIL EXISTS ──────────────────────────────────
// Verification blocks payment, so a member who mistyped their address
// is stuck: the link goes somewhere they cannot read, and resending
// only sends it to the same wrong address again. Without a way out,
// their only option is to abandon the account — and the address is now
// taken by a dead registration, so they cannot even re-register with
// the correct one.
//
// This is the exit. It is only available while UNVERIFIED and is
// self-limiting: the new address must still be confirmed, so it cannot
// be used to take over anyone else's email.
//
// ── MIDDLEWARE ───────────────────────────────────────────────
// '/api/auth/verify-email' in API_PUBLIC and '/verify-email' in
// PUBLIC_ROUTES — a link may be opened on a device with no session.
// The resend and change-email branches guard themselves.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'
import { getSessionFromRequest, unauthorized } from '@/lib/auth'
import { sendVerificationEmail, verifyEmailToken } from '@/lib/email-verification'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  action: z.enum(['verify', 'resend', 'change-email']).default('verify'),
  token: z.string().min(16).optional(),
  email: z.string().email('Enter a valid email address').optional(),
})

function clientIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for')
  return fwd ? fwd.split(',')[0].trim() : null
}

async function handleVerify(token: string) {
  const result = await verifyEmailToken(token)

  if (!result.ok) {
    return NextResponse.json(
      { success: false, code: result.code, error: result.message },
      { status: 400 }
    )
  }

  return NextResponse.json({
    success: true,
    data: { alreadyVerified: result.alreadyVerified },
    message: result.alreadyVerified
      ? 'This email was already confirmed.'
      : 'Email confirmed. Thank you.',
  })
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) {
    return NextResponse.json(
      { success: false, code: 'MISSING_TOKEN', error: 'No verification token supplied.' },
      { status: 400 }
    )
  }
  return handleVerify(token)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any))
    const parsed = BodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message || 'Invalid request' },
        { status: 400 }
      )
    }

    // ── Verify (public) ─────────────────────────────────────
    if (parsed.data.action === 'verify') {
      if (!parsed.data.token) {
        return NextResponse.json(
          { success: false, code: 'MISSING_TOKEN', error: 'No verification token supplied.' },
          { status: 400 }
        )
      }
      return handleVerify(parsed.data.token)
    }

    // Everything below needs a session.
    const session = await getSessionFromRequest(req)
    if (!session) return unauthorized()

    // ── Change email (exit route) ───────────────────────────
    if (parsed.data.action === 'change-email') {
      const newEmail = (parsed.data.email || '').toLowerCase().trim()
      if (!newEmail) {
        return NextResponse.json(
          { success: false, error: 'Enter the correct email address.' },
          { status: 400 }
        )
      }

      const current = await prisma.$queryRawUnsafe<any[]>(
        `SELECT "email", "emailVerifiedAt" FROM "User"
         WHERE "id" = $1 AND "deletedAt" IS NULL`,
        session.id
      )
      if (!current?.length) return unauthorized()

      // Once verified, the address is the confirmed sign-in ID and
      // changing it belongs in profile settings with a confirmation
      // step on BOTH addresses. This route is the pre-verification
      // escape hatch only.
      if (current[0].emailVerifiedAt) {
        return NextResponse.json({
          success: false,
          code: 'ALREADY_VERIFIED',
          error: 'This address is already confirmed. Change it from your profile instead.',
        }, { status: 409 })
      }

      if (newEmail === String(current[0].email).toLowerCase()) {
        return NextResponse.json({
          success: false,
          code: 'SAME_EMAIL',
          error: 'That is the address already on the account.',
        }, { status: 400 })
      }

      const taken = await prisma.user.findFirst({
        where: { email: newEmail },
        select: { id: true },
      })
      if (taken) {
        return NextResponse.json({
          success: false,
          code: 'EMAIL_TAKEN',
          error: 'An account with that email already exists. Try signing in instead.',
        }, { status: 409 })
      }

      const oldEmail = current[0].email

      // Change the address and void every outstanding token in one
      // statement. Leaving old tokens live would let a link sent to the
      // WRONG address verify the corrected account — which is exactly
      // the situation this route exists to escape.
      await prisma.$executeRawUnsafe(
        `UPDATE "User" SET "email" = $2, "updatedAt" = now() WHERE "id" = $1`,
        session.id, newEmail
      )
      await prisma.$executeRawUnsafe(
        `UPDATE "EmailVerificationToken"
         SET "usedAt" = now()
         WHERE "userId" = $1 AND "usedAt" IS NULL`,
        session.id
      )

      await prisma.auditLog.create({
        data: {
          userId: session.id,
          action: 'UPDATE',
          entityType: 'User',
          entityId: session.id,
          oldValues: { email: oldEmail },
          newValues: { email: newEmail },
          ipAddress: clientIp(req) || 'unknown',
          userAgent: req.headers.get('user-agent') || undefined,
          description: 'Email address corrected before verification',
        },
      })

      const sendResult = await sendVerificationEmail(session.id, {
        email: newEmail,
        fullName: session.fullName,
        ipAddress: clientIp(req),
      })

      // The address IS changed even if the email fails — the member can
      // request another link, and reverting would put them back at the
      // wrong address with no way forward.
      return NextResponse.json({
        success: true,
        data: { email: newEmail, emailSent: sendResult.ok },
        message: sendResult.ok
          ? `Address updated. We've sent a confirmation link to ${newEmail}.`
          : `Address updated to ${newEmail}, but the email could not be sent just now. ` +
            `Use "Send another link" in a moment.`,
      })
    }

    // ── Resend ──────────────────────────────────────────────
    // Always for the CALLER. Accepting a userId or email here would
    // turn this into a way to mail arbitrary addresses.
    const result = await sendVerificationEmail(session.id, {
      email: session.email,
      fullName: session.fullName,
      ipAddress: clientIp(req),
    })

    if (!result.ok) {
      const status = result.code === 'RATE_LIMITED' ? 429
        : result.code === 'ALREADY_VERIFIED' ? 409
        : 500
      return NextResponse.json(
        { success: false, code: result.code, error: result.message },
        { status }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Verification email sent. Check your inbox, and your spam folder just in case.',
    })
  } catch (e: any) {
    console.error('POST /api/auth/verify-email error:', e?.message)
    return NextResponse.json({ success: false, error: 'Request failed' }, { status: 500 })
  }
}
