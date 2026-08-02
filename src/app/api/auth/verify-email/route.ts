// src/app/api/auth/verify-email/route.ts
//
// Phase 6a.
//
//   POST { action: 'verify', token }  → public. Consume a link.
//   POST { action: 'resend' }         → authenticated. New link for the caller.
//   GET  ?token=...                   → same as verify, for the page to call.
//
// ── MIDDLEWARE ───────────────────────────────────────────────
// '/api/auth/verify-email' must be in API_PUBLIC, and '/verify-email'
// in PUBLIC_ROUTES. Someone clicking a link from their inbox may not
// have a session — they might be on a different device entirely.
//
// The resend branch guards itself, so a public route is safe here.
//
// ── ENUMERATION ──────────────────────────────────────────────
// Verify responses never say whether an account exists. An expired
// link and a fabricated one produce the same message.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionFromRequest, unauthorized } from '@/lib/auth'
import { sendVerificationEmail, verifyEmailToken } from '@/lib/email-verification'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  action: z.enum(['verify', 'resend']).default('verify'),
  token: z.string().min(16).optional(),
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

    // ── Resend (authenticated) ──────────────────────────────
    // Always for the CALLER. Accepting a userId or email here would
    // turn the endpoint into a way to mail arbitrary addresses.
    const session = await getSessionFromRequest(req)
    if (!session) return unauthorized()

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
    return NextResponse.json(
      { success: false, error: 'Request failed' },
      { status: 500 }
    )
  }
}
