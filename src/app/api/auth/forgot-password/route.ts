// src/app/api/auth/forgot-password/route.ts
// Step 1 of password reset: user submits their email, we mint a single-use
// token (60-min expiry) and store only its hash. The raw token goes out in
// an email link.
//
// Version 2.0 — email delivery wired via src/lib/email/send.ts.
//
// Security: the response is always a generic success, whether or not the
// email matches an account, so this endpoint can't be used to discover which
// emails are registered. Email failures are logged loudly server-side but
// NEVER change the response.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID, createHash } from 'crypto'
import prisma from '@/lib/prisma/client'
import { sendEmail, emailLayout, emailButton, appUrl, isEmailConfigured } from '@/lib/email/send'

export const dynamic = 'force-dynamic'

const RESET_TTL_MINUTES = 60

const schema = z.object({
  email: z.string().email(),
})

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

const GENERIC_MESSAGE =
  'If an account exists for that email, a password reset link has been sent.'

function genericResponse() {
  return NextResponse.json({ success: true, message: GENERIC_MESSAGE })
}

// ── Reset email ───────────────────────────────────────────────
async function sendResetEmail(to: string, resetUrl: string, fullName: string | null) {
  const greeting = fullName ? `Hi ${fullName.split(' ')[0]},` : 'Hi there,'

  const html = emailLayout({
    icon: '🔐',
    heading: 'Password reset request',
    body: `
      <p style="font-size:16px;color:#0D2137;font-weight:600;margin:0 0 8px">${greeting}</p>
      <p style="font-size:14px;color:#475569;line-height:1.6;margin:0 0 24px">
        We received a request to reset the password for your Windfall Community Deals
        account. Click the button below to choose a new one.
      </p>

      <div style="background:#FFFBEB;border-left:4px solid #B45309;border-radius:4px;padding:14px 18px;margin-bottom:24px">
        <p style="font-size:13px;color:#854D0E;margin:0">
          This link expires in ${RESET_TTL_MINUTES} minutes and can only be used once.
        </p>
      </div>

      ${emailButton(resetUrl, '🔑 Reset My Password')}

      <p style="font-size:13px;color:#64748B;line-height:1.6;margin:24px 0 0">
        If you did not request this, you can safely ignore this email — your
        password will not change until someone uses the link above.
      </p>`,
    footer:
      'You received this because a password reset was requested for this email address. ' +
      'If that was not you, no action is needed.',
  })

  await sendEmail({
    to,
    subject: 'Reset your Windfall Community Deals password',
    html,
    text:
      `${greeting}\n\nWe received a request to reset your Windfall Community Deals password.\n\n` +
      `Reset it here (expires in ${RESET_TTL_MINUTES} minutes, single use):\n${resetUrl}\n\n` +
      `If you did not request this, you can safely ignore this email.`,
  })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email } = schema.parse(body)
    const normalised = email.trim().toLowerCase()

    const user = await prisma.user.findUnique({
      where: { email: normalised },
      select: { id: true, status: true, email: true, fullName: true },
    })

    if (!user || user.status !== 'ACTIVE') return genericResponse()

    // Mint token: raw goes in the URL, only the hash is stored.
    const rawToken = `${randomUUID()}${randomUUID()}`.replace(/-/g, '')
    const tokenHash = hashToken(rawToken)
    const id = randomUUID()
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

    // Link must point at the canonical domain, not the request origin —
    // on Vercel a request can arrive at a preview deployment URL, and a
    // reset link pointing there is useless to the recipient.
    const resetUrl = `${appUrl(new URL(req.url).origin)}/reset-password?token=${rawToken}`

    // ── Send (added v2) ───────────────────────────────────────
    // Failures are logged but NEVER surface to the caller: a different
    // response on send failure would reveal that the account exists.
    // Missing configuration is logged as an error, not thrown, so a
    // misconfigured environment degrades rather than breaks.
    if (!isEmailConfigured()) {
      console.error(
        '[forgot-password] RESEND_API_KEY is not set — reset link generated but NOT sent for',
        normalised,
      )
    } else {
      try {
        await sendResetEmail(user.email, resetUrl, user.fullName)
        console.log('[forgot-password] reset email sent to', normalised)
      } catch (e: any) {
        console.error('[forgot-password] email send FAILED for', normalised, '::', e?.message)
      }
    }

    // Dev convenience: surfaces the link without needing a mailbox.
    // Absent in production — never expose a reset token in an API response
    // there, since the endpoint is public and unauthenticated.
    if (process.env.NODE_ENV !== 'production') {
      return NextResponse.json({
        success: true,
        message: GENERIC_MESSAGE,
        devResetUrl: resetUrl,
      })
    }

    return genericResponse()
  } catch (e: any) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'A valid email address is required' }, { status: 400 })
    }
    console.error('POST /api/auth/forgot-password error:', e?.message)
    // Still generic to the client — don't surface internals on this endpoint.
    return genericResponse()
  }
}

// ============================================================
// KNOWN TRADE-OFF — TIMING
//
// The send only happens when the account exists, so a response for a
// registered email takes measurably longer than for an unregistered one.
// A determined attacker could use that to enumerate accounts despite the
// identical message.
//
// Not addressed here because the alternatives are worse: firing the send
// without awaiting risks the lambda freezing mid-flight and silently
// dropping reset emails, which is a real user-facing failure versus a
// statistical side channel.
//
// The proper fix is a queue — enqueue the send, return immediately, and
// let a worker deliver. Worth doing when the notification system lands.
// ============================================================
