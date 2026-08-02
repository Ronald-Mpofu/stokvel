// src/app/api/cron/expire-memberships/route.ts
// Sweeps Community Memberships past expiry + grace to EXPIRED.
//
// Phase 2d.
//
// ⚠ DO NOT SCHEDULE THIS YET
//   Renewal reminders (phase 4) do not exist. Expiring someone who was
//   never warned is the behaviour that generates support load and ill
//   will, and it is the single change most likely to make the platform
//   feel arbitrary to a paying member.
//
//   Deploy the route now — it is inert until something calls it — and
//   add the vercel.json schedule only once T-30 / T-7 / T-1 reminders
//   are sending. Until then, run it manually if you want to observe it.
//
// ── AUTHENTICATION ───────────────────────────────────────────
// No cookie: Vercel Cron calls this server-to-server. It authenticates
// with a bearer secret instead, compared in constant time.
//
// TWO THINGS ARE REQUIRED before this can be reached:
//   1. CRON_SECRET set in the Vercel environment
//   2. '/api/cron' added to API_PUBLIC in middleware.ts — otherwise
//      middleware 401s the request before this handler ever runs
//
// Being in API_PUBLIC does NOT make it open: the secret check below is
// the actual gate, exactly as the Stripe webhook verifies a signature.
//
// ── SCHEDULE (phase 4, vercel.json) ──────────────────────────
//   { "crons": [
//       { "path": "/api/cron/expire-memberships", "schedule": "0 2 * * *" }
//   ] }

import { NextRequest, NextResponse } from 'next/server'
import { expireLapsed, EXPIRY_GRACE_DAYS } from '@/lib/community-membership'

export const dynamic = 'force-dynamic'

/**
 * Length-safe, timing-safe comparison. A plain === on secrets leaks
 * information through response timing.
 */
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

function authorise(req: NextRequest): NextResponse | null {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    console.error('GET /api/cron/expire-memberships error: CRON_SECRET not set')
    return NextResponse.json(
      { success: false, error: 'Cron not configured' },
      { status: 500 }
    )
  }

  const header = req.headers.get('authorization') || ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''

  if (!provided || !secretsMatch(provided, expected)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorised' },
      { status: 401 }
    )
  }

  return null
}

export async function GET(req: NextRequest) {
  const authErr = authorise(req)
  if (authErr) return authErr

  try {
    const started = Date.now()
    const { expired } = await expireLapsed()

    // Logged unconditionally, including zero, so the absence of a log
    // line means the cron did not fire — distinguishable from a run
    // that found nothing to do.
    console.log(
      `[cron] expire-memberships: ${expired} expired ` +
      `(grace ${EXPIRY_GRACE_DAYS}d, ${Date.now() - started}ms)`
    )

    return NextResponse.json({
      success: true,
      data: {
        expired,
        graceDays: EXPIRY_GRACE_DAYS,
        ranAt: new Date().toISOString(),
      },
    })
  } catch (e: any) {
    console.error('GET /api/cron/expire-memberships error:', e?.message)
    return NextResponse.json(
      { success: false, error: 'Sweep failed' },
      { status: 500 }
    )
  }
}

// POST is accepted too — some schedulers only issue POST.
export async function POST(req: NextRequest) {
  return GET(req)
}
