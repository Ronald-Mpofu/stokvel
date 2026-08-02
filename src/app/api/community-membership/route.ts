// src/app/api/community-membership/route.ts
// Member self-service for Community Membership.
//
//   GET                        → current membership + entitlement context
//   POST { action: 'cancel' }  → opt out (cancel at period end)
//   POST { action: 'resume' }  → revoke a pending cancellation
//
// Phase 2c.
//
// ── THE THREE-STEP CANCEL ────────────────────────────────────
// Opting out touches two systems that can disagree, so the order is
// deliberate and must not be rearranged:
//
//   1. requestOptOut()                    validate only, no writes
//   2. scheduleSubscriptionCancellation() Stripe agrees
//   3. confirmOptOut()                    record it
//
// Writing step 3 before step 2 is how a member ends up marked as
// departed while their card keeps being charged. If Stripe fails, we
// return an error and NOTHING has been written — the member can retry
// and their membership is untouched.
//
// The reverse (resume) runs the same way in reverse.
//
// ── WHAT CANCELLING DOES NOT DO ──────────────────────────────
// It does not end access immediately. The member keeps full access and
// advert visibility through the period they already paid for; the
// membership simply stops renewing, and the expiry sweep flips it to
// EXPIRED afterwards. Nothing is forfeited, which is what makes the
// non-refundable clause (rule 3f) defensible.
//
// ── RULE 2d ──────────────────────────────────────────────────
// Cancelling is refused when Community Membership is the member's LAST
// entitlement source. Enforced inside requestOptOut against live
// entitlement, not a stored flag.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import {
  getCommunityMembership,
  requestOptOut,
  confirmOptOut,
  revokeCancellation,
} from '@/lib/community-membership'
import { getEntitlementFromRequest } from '@/lib/entitlement'
import {
  scheduleSubscriptionCancellation,
  revokeSubscriptionCancellation,
} from '@/lib/payments/stripe/adapter'

export const dynamic = 'force-dynamic'

const ActionSchema = z.object({
  action: z.enum(['cancel', 'resume']),
})

function clientIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for')
  return fwd ? fwd.split(',')[0].trim() : null
}

// ── GET ───────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { error, claims } = await requireAuth(req)
    if (error) return error

    // Both are memoised per request, so this is two queries, not more.
    const [membership, entitlement] = await Promise.all([
      getCommunityMembership(claims.id),
      getEntitlementFromRequest(req),
    ])

    // Surfaced so the profile UI can explain WHY cancelling is
    // unavailable, rather than showing a disabled button with no reason.
    const hasOtherSource = !!entitlement && (
      entitlement.qualifyingGroupIds.length > 0 ||
      entitlement.reasons.includes('STAFF_ROLE')
    )

    return NextResponse.json({
      success: true,
      data: {
        membership,
        canCancel:
          !!membership &&
          membership.status === 'ACTIVE' &&
          !membership.cancelAtPeriodEnd &&
          hasOtherSource,
        canResume: !!membership && membership.cancelAtPeriodEnd,
        blockedReason:
          membership && membership.status === 'ACTIVE' && !hasOtherSource
            ? 'Community Membership is currently your only active membership. ' +
              'Join a group first, then you can end this at any time.'
            : null,
        entitlement: entitlement
          ? {
              isEntitled: entitlement.isEntitled,
              canSeeAdverts: entitlement.canSeeAdverts,
              qualifyingGroupCount: entitlement.qualifyingGroupIds.length,
            }
          : null,
      },
    })
  } catch (e: any) {
    console.error('GET /api/community-membership error:', e?.message)
    return NextResponse.json(
      { success: false, error: 'Could not load membership' },
      { status: 500 }
    )
  }
}

// ── POST ──────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    // verifyStatus: true — one extra query to re-check live account
    // standing rather than trusting the token snapshot. Appropriate for
    // an action with a billing consequence.
    const { error, claims } = await requireAuth(req, { verifyStatus: true })
    if (error) return error

    const body = await req.json().catch(() => ({}))
    const parsed = ActionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'action must be "cancel" or "resume"' },
        { status: 400 }
      )
    }

    const ip = clientIp(req)

    // ── Cancel ────────────────────────────────────────────────
    if (parsed.data.action === 'cancel') {
      // STEP 1 — validate. Writes nothing. Enforces rule 2d.
      const intent = await requestOptOut(claims.id)
      if (!intent.ok) {
        // LAST_ENTITLEMENT_SOURCE is a 409, not a 403: the request is
        // well-formed and the member is permitted in principle — the
        // current state just makes it unsafe.
        const status = intent.code === 'LAST_ENTITLEMENT_SOURCE' ? 409 : 400
        return NextResponse.json(
          { success: false, code: intent.code, error: intent.message },
          { status }
        )
      }

      // STEP 2 — Stripe. Only when a subscription exists: bank transfer
      // and mobile money members have none, and neither do the rows
      // backfilled before stripeSubscriptionId existed.
      if (intent.stripeSubscriptionId) {
        try {
          await scheduleSubscriptionCancellation(intent.stripeSubscriptionId)
        } catch (e: any) {
          console.error('POST /api/community-membership Stripe cancel failed:', e?.message)
          // Nothing has been written. The member's membership is
          // untouched and they can retry safely.
          return NextResponse.json(
            {
              success: false,
              code: 'STRIPE_CANCEL_FAILED',
              error: 'We could not reach the payment provider. Nothing has changed — please try again.',
            },
            { status: 502 }
          )
        }
      }

      // STEP 3 — record it, now that Stripe agrees.
      const result = await confirmOptOut(claims.id, {
        actorUserId: claims.id,
        ipAddress: ip,
      })
      if (!result.ok) {
        // Stripe IS cancelled but the write failed. Log loudly — this
        // is the one state that needs manual reconciliation.
        console.error(
          'POST /api/community-membership: Stripe cancelled but DB write failed for',
          claims.id, intent.stripeSubscriptionId, result.code
        )
        return NextResponse.json(
          { success: false, code: result.code, error: result.message },
          { status: 500 }
        )
      }

      return NextResponse.json({
        success: true,
        message: result.message,
        data: { membership: result.membership },
      })
    }

    // ── Resume ────────────────────────────────────────────────
    const existing = await getCommunityMembership(claims.id)
    if (!existing) {
      return NextResponse.json(
        { success: false, code: 'NOT_ENROLLED', error: 'You do not currently hold a Community Membership.' },
        { status: 400 }
      )
    }

    if (existing.stripeSubscriptionId) {
      try {
        await revokeSubscriptionCancellation(existing.stripeSubscriptionId)
      } catch (e: any) {
        console.error('POST /api/community-membership Stripe resume failed:', e?.message)
        return NextResponse.json(
          {
            success: false,
            code: 'STRIPE_RESUME_FAILED',
            error: 'We could not reach the payment provider. Nothing has changed — please try again.',
          },
          { status: 502 }
        )
      }
    }

    const resumed = await revokeCancellation(claims.id, {
      actorUserId: claims.id,
      ipAddress: ip,
    })
    if (!resumed.ok) {
      // ALREADY_ENDED means the period lapsed while they hesitated —
      // a new checkout is required, so point them at it.
      const status = resumed.code === 'ALREADY_ENDED' ? 409 : 400
      return NextResponse.json(
        {
          success: false,
          code: resumed.code,
          error: resumed.message,
          data: resumed.code === 'ALREADY_ENDED' ? { renewAt: '/dashboard/join-fee' } : undefined,
        },
        { status }
      )
    }

    return NextResponse.json({
      success: true,
      message: resumed.message,
      data: { membership: resumed.membership },
    })
  } catch (e: any) {
    console.error('POST /api/community-membership error:', e?.message)
    return NextResponse.json(
      { success: false, error: 'Could not update membership' },
      { status: 500 }
    )
  }
}
