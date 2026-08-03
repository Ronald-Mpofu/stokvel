// src/lib/email-verification/index.ts
// Email verification tokens — issue, send, verify.
//
// Phase 6a.
//
// ── DESIGN ───────────────────────────────────────────────────
// Same shape as the password reset flow: a random token is emailed,
// and only its SHA-256 HASH is stored. A database leak yields nothing
// usable, because the raw token exists only in the message that was
// sent.
//
// ── VERIFICATION DOES NOT BLOCK PAYMENT ──────────────────────
// Deliberate. Email is slow and lossy — it lands in spam, arrives late,
// or the link expires while someone is at work. Putting it between
// registration and payment turns every delivery problem into a lost
// signup at the moment intent is highest.
//
// So the email is sent in parallel with registration, and verification
// gates TRANSACTING rather than paying. Someone who pays and never
// verifies is a support conversation. Someone who never pays because
// the email was slow is simply gone.
//
// Enforcement lives in the entitlement resolver, not here — one place,
// applied consistently, rather than a checkpoint on one route.
//
// ── NOT IN PRISMA ────────────────────────────────────────────
// EmailVerificationToken is raw SQL. Never add it to a Prisma select.

import { randomBytes, createHash } from 'crypto'
import prisma from '@/lib/prisma/client'
import { sendNotification, textToHtmlWithButton } from '@/lib/notifications/engine'

/** Hours a verification link stays valid. */
export const TOKEN_TTL_HOURS = 48

/** Resend ceiling per user per hour — stops the endpoint being a mail cannon. */
export const MAX_SENDS_PER_HOUR = 3

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export type IssueResult =
  | { ok: true; sent: boolean }
  | { ok: false; code: string; message: string }

/**
 * Issue a token and email it.
 *
 * NEVER THROWS. Registration calls this and must not fail because a
 * mail provider is down — the account is already created, and the
 * member can request a fresh link later.
 */
export async function sendVerificationEmail(
  userId: string,
  opts: { email?: string | null; fullName?: string | null; ipAddress?: string | null } = {}
): Promise<IssueResult> {
  try {
    let email = opts.email ?? null
    let fullName = opts.fullName ?? null

    if (!email) {
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT "email", "fullName", "emailVerifiedAt" FROM "User"
         WHERE "id" = $1 AND "deletedAt" IS NULL`,
        userId
      )
      if (!rows?.length) {
        return { ok: false, code: 'USER_NOT_FOUND', message: 'Account not found.' }
      }
      if (rows[0].emailVerifiedAt) {
        return { ok: false, code: 'ALREADY_VERIFIED', message: 'This email is already verified.' }
      }
      email = rows[0].email
      fullName = rows[0].fullName
    }

    // Rate limit. Counted on issued tokens rather than a separate
    // counter, so it survives restarts and cannot be reset by retrying.
    const recent = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count FROM "EmailVerificationToken"
       WHERE "userId" = $1 AND "createdAt" > now() - interval '1 hour'`,
      userId
    )
    if (Number(recent?.[0]?.count ?? 0) >= MAX_SENDS_PER_HOUR) {
      return {
        ok: false,
        code: 'RATE_LIMITED',
        message: 'Too many verification emails requested. Please try again in an hour.',
      }
    }

    // 32 bytes of entropy, hex-encoded. Only the hash is stored.
    const raw = randomBytes(32).toString('hex')

    await prisma.$executeRawUnsafe(
      `INSERT INTO "EmailVerificationToken"
         ("userId", "email", "tokenHash", "expiresAt", "ipAddress")
       VALUES ($1, $2, $3, now() + ($4::int * interval '1 hour'), $5)`,
      userId, email, hashToken(raw), TOKEN_TTL_HOURS, opts.ipAddress ?? null
    )

    const link = `${APP_URL}/verify-email?token=${raw}`
    const name = String(fullName || 'there').split(' ')[0]

    // The plain-text body still carries the URL, because it doubles as
    // the text/plain part and as the fallback for any client that
    // refuses HTML.
    const body =
      `Hi ${name},\n\n` +
      `Welcome to Windfall Community Deals. Please confirm this is your email address — ` +
      `it will also be the address you sign in with.\n\n` +
      `${link}\n\n` +
      `The link is valid for ${TOKEN_TTL_HOURS} hours.\n\n` +
      `If you didn't create an account with us, you can ignore this message.`

    const res = await sendNotification({
      userId,
      type: 'EMAIL_VERIFICATION',
      subject: 'Confirm your email address',
      body,
      // Explicit HTML with a real button. Without this the engine falls
      // back to textToHtml, which now linkifies but still gives a bare
      // URL rather than something obviously clickable.
      html: textToHtmlWithButton(
        `Hi ${name},\n\n` +
        `Welcome to Windfall Community Deals. Please confirm this is your email address — ` +
        `it will also be the address you sign in with.\n\n` +
        `The link is valid for ${TOKEN_TTL_HOURS} hours. If you didn't create an account ` +
        `with us, you can ignore this message.`,
        'Confirm your email address',
        { label: 'Confirm my email', url: link }
      ),
      channels: ['EMAIL'],
      email,
      fullName,
      metadata: { purpose: 'email_verification' },
    })

    return { ok: true, sent: res.sent.includes('EMAIL') }
  } catch (e: any) {
    console.error('sendVerificationEmail error:', e?.message)
    return { ok: false, code: 'SEND_FAILED', message: 'Could not send the verification email.' }
  }
}

export type VerifyResult =
  | { ok: true; userId: string; alreadyVerified: boolean }
  | { ok: false; code: string; message: string }

/**
 * Consume a token and mark the account verified.
 *
 * Single statement: the token is claimed and the user updated together,
 * so a replay cannot verify twice and a crash cannot leave a consumed
 * token against an unverified account.
 */
export async function verifyEmailToken(rawToken: string): Promise<VerifyResult> {
  try {
    if (!rawToken || rawToken.length < 16) {
      return { ok: false, code: 'INVALID', message: 'That verification link is not valid.' }
    }

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `
      WITH claimed AS (
        UPDATE "EmailVerificationToken"
        SET "usedAt" = now()
        WHERE "tokenHash" = $1
          AND "usedAt" IS NULL
          AND "expiresAt" > now()
        RETURNING "userId", "email"
      ),
      verified AS (
        UPDATE "User" u
        SET "emailVerifiedAt" = COALESCE(u."emailVerifiedAt", now()),
            "updatedAt" = now()
        FROM claimed c
        WHERE u."id" = c."userId"
        RETURNING u."id" AS "userId"
      )
      SELECT (SELECT "userId" FROM verified) AS "userId"
      `,
      hashToken(rawToken)
    )

    const userId = rows?.[0]?.userId
    if (userId) return { ok: true, userId, alreadyVerified: false }

    // Nothing claimed. Distinguish the three reasons WITHOUT revealing
    // whether the token ever existed — an expired link and a fabricated
    // one look the same to an attacker, but a used link is worth
    // reporting kindly since it usually means a double-click.
    const info = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "userId", "usedAt", "expiresAt" FROM "EmailVerificationToken"
       WHERE "tokenHash" = $1`,
      hashToken(rawToken)
    )

    if (info?.length && info[0].usedAt) {
      return { ok: true, userId: info[0].userId, alreadyVerified: true }
    }

    return {
      ok: false,
      code: 'EXPIRED_OR_INVALID',
      message: 'That verification link has expired or is not valid. Request a new one.',
    }
  } catch (e: any) {
    console.error('verifyEmailToken error:', e?.message)
    return { ok: false, code: 'VERIFY_FAILED', message: 'Could not verify that link.' }
  }
}

/** True when the account has a confirmed email address. */
export async function isEmailVerified(userId: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ emailVerifiedAt: Date | null }[]>(
    `SELECT "emailVerifiedAt" FROM "User" WHERE "id" = $1`,
    userId
  )
  return !!rows?.[0]?.emailVerifiedAt
}
