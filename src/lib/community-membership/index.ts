// src/lib/community-membership/index.ts
// Community Membership lifecycle — the ONLY writer to
// "CommunityMembership" and "CommunityMembershipEvent".
//
// Phase 2a, VERSION 2 — corrected for Stripe subscription mode.
//
// ── WHAT CHANGED FROM v1 ─────────────────────────────────────
// v1 assumed one-off annual payments. /api/joining-fee actually creates
// a Stripe Checkout session in SUBSCRIPTION mode (scope MEMBER_ANNUAL),
// so:
//
//   1. expiresAt is now WRITTEN, not computed. Callers pass Stripe's
//      current_period_end. Computing +12 months locally would create a
//      second clock that drifts from Stripe's — the exact problem
//      moving off User.joiningFeeExpiresAt was meant to solve. The
//      local computation survives only as a fallback for the one-off
//      rails (bank transfer, mobile money), which have no subscription.
//
//   2. Opting out is CANCEL AT PERIOD END, not immediate suspension.
//      v1 set autoRenew = false in Postgres and did nothing in Stripe,
//      so a member who left kept being charged annually. This version
//      returns the subscription id the caller must cancel, and refuses
//      to record the opt-out as complete until told the cancellation
//      succeeded.
//
//      The member keeps access and advert visibility through the period
//      they already paid for. Nothing is forfeited, which is what makes
//      rule 3f's non-refundable clause read as "you keep what you paid
//      for" rather than "we keep your money".
//
// ── WHY A SERVICE ────────────────────────────────────────────
// Five call sites will mutate membership state: the Stripe webhook, the
// profile opt-out control, the profile opt-in control (rule 3f), the
// expiry sweep, and admin support. Every one must also write the audit
// event, and that trail is what defends the non-refundable clause.
// Routing all mutations through here means it cannot be forgotten.
//
// ── NOT IN PRISMA ────────────────────────────────────────────
// Both tables are raw SQL. Never add them to a Prisma select.

import prisma from '@/lib/prisma/client'
import { resolveEntitlement } from '@/lib/entitlement'

// ── Configuration ────────────────────────────────────────────

/**
 * Fallback term for rails with no subscription — bank transfer and
 * mobile money are one-off payments. Card payments ignore this and use
 * Stripe's current_period_end.
 */
export const MEMBERSHIP_TERM_MONTHS = 12

/**
 * Days past expiry before the sweep flips ACTIVE → EXPIRED.
 * Renewal reminders (phase 4) must land inside this window.
 */
export const EXPIRY_GRACE_DAYS = 14

// ── Types ────────────────────────────────────────────────────

export type MembershipStatus = 'ACTIVE' | 'SUSPENDED' | 'EXPIRED'

export type MembershipSource =
  | 'DIRECT_REGISTRATION'
  | 'OPT_IN_FROM_INVITE'
  | 'BACKFILL'
  | 'ADMIN_GRANT'

export type CommunityMembership = {
  userId: string
  status: MembershipStatus
  startedAt: string
  expiresAt: string
  optedOutAt: string | null
  autoRenew: boolean
  cancelAtPeriodEnd: boolean
  currency: string
  source: MembershipSource
  stripeSubscriptionId: string | null
  stripeCustomerId: string | null
}

export type MutationResult =
  | { ok: true; membership: CommunityMembership; message: string }
  | { ok: false; code: string; message: string; membership?: CommunityMembership }

type MembershipRow = {
  userId: string
  status: MembershipStatus
  startedAt: Date
  expiresAt: Date
  optedOutAt: Date | null
  autoRenew: boolean
  cancelAtPeriodEnd: boolean
  currency: string
  source: MembershipSource
  stripeSubscriptionId: string | null
  stripeCustomerId: string | null
}

const SELECT_COLS = `
  "userId", "status", "startedAt", "expiresAt", "optedOutAt",
  "autoRenew", "cancelAtPeriodEnd", "currency", "source",
  "stripeSubscriptionId", "stripeCustomerId"
`

function toMembership(r: MembershipRow): CommunityMembership {
  return {
    userId: r.userId,
    status: r.status,
    startedAt: new Date(r.startedAt).toISOString(),
    expiresAt: new Date(r.expiresAt).toISOString(),
    optedOutAt: r.optedOutAt ? new Date(r.optedOutAt).toISOString() : null,
    autoRenew: r.autoRenew,
    cancelAtPeriodEnd: r.cancelAtPeriodEnd,
    currency: r.currency,
    source: r.source,
    stripeSubscriptionId: r.stripeSubscriptionId,
    stripeCustomerId: r.stripeCustomerId,
  }
}

function addMonths(from: Date, months: number): Date {
  const d = new Date(from)
  d.setMonth(d.getMonth() + months)
  return d
}

// ── Read ─────────────────────────────────────────────────────

/** Current membership, or null if the user has never enrolled. */
export async function getCommunityMembership(
  userId: string
): Promise<CommunityMembership | null> {
  const rows = await prisma.$queryRawUnsafe<MembershipRow[]>(
    `SELECT ${SELECT_COLS} FROM "CommunityMembership" WHERE "userId" = $1`,
    userId
  )
  return rows?.[0] ? toMembership(rows[0]) : null
}

/** Find a membership by Stripe subscription id — the webhook's entry point. */
export async function getBySubscriptionId(
  subscriptionId: string
): Promise<CommunityMembership | null> {
  const rows = await prisma.$queryRawUnsafe<MembershipRow[]>(
    `SELECT ${SELECT_COLS} FROM "CommunityMembership" WHERE "stripeSubscriptionId" = $1`,
    subscriptionId
  )
  return rows?.[0] ? toMembership(rows[0]) : null
}

// ── Enrol / renew ────────────────────────────────────────────

export type EnrolInput = {
  userId: string
  currency: string

  /**
   * Stripe's current_period_end. STRONGLY PREFERRED — pass this
   * whenever the payment came through a subscription, so Postgres and
   * Stripe cannot disagree about when the membership ends.
   *
   * Omit ONLY for one-off rails (bank transfer, mobile money), where
   * MEMBERSHIP_TERM_MONTHS is added to today instead.
   */
  expiresAt?: Date | string | null

  stripeSubscriptionId?: string | null
  stripeCustomerId?: string | null
  autoRenew?: boolean
  amountPaid?: number | null
  paymentRef?: string | null
  invoiceId?: string | null
  source?: MembershipSource
  actorUserId?: string | null
  ipAddress?: string | null
}

/**
 * Enrol a new member or record a renewal.
 *
 * NOT IDEMPOTENT BY CALL when expiresAt is omitted — two calls would
 * add two terms. Stripe retries webhooks, so the caller MUST deduplicate
 * on the Stripe event id before calling. Passing expiresAt makes this
 * naturally idempotent, since the value is absolute rather than
 * relative: replaying the same event writes the same date.
 *
 * A member with a pending cancellation who pays again has that
 * cancellation revoked — paying is an unambiguous signal of intent to
 * continue.
 */
export async function enrolOrRenew(input: EnrolInput): Promise<MutationResult> {
  const {
    userId,
    currency,
    expiresAt: expiresAtInput = null,
    stripeSubscriptionId = null,
    stripeCustomerId = null,
    autoRenew = true,
    amountPaid = null,
    paymentRef = null,
    invoiceId = null,
    source = 'DIRECT_REGISTRATION',
    actorUserId = null,
    ipAddress = null,
  } = input

  try {
    const existing = await getCommunityMembership(userId)
    const now = new Date()

    // Absolute date from Stripe wins. Fall back to a computed term only
    // for one-off rails. When computing, extend from the current expiry
    // if it is still in the future, so paying early loses nothing.
    let expiresAt: Date
    if (expiresAtInput) {
      expiresAt = new Date(expiresAtInput)
    } else {
      const base =
        existing && new Date(existing.expiresAt) > now
          ? new Date(existing.expiresAt)
          : now
      expiresAt = addMonths(base, MEMBERSHIP_TERM_MONTHS)
    }

    const expiresBefore = existing ? new Date(existing.expiresAt) : null
    const event = existing ? 'RENEWED' : 'ENROLLED'

    // Data-modifying CTE: the mutation and its audit row commit
    // together, so the event can never be lost between round trips.
    const rows = await prisma.$queryRawUnsafe<MembershipRow[]>(
      `
      WITH upserted AS (
        INSERT INTO "CommunityMembership"
          ("userId", "status", "startedAt", "expiresAt", "currency",
           "amountPaid", "lastPaymentIntentId", "stripeCustomerId",
           "stripeSubscriptionId", "autoRenew", "cancelAtPeriodEnd",
           "lastInvoiceId", "source", "optedOutAt", "remainingDaysAtOptOut",
           "updatedAt")
        VALUES
          ($1, 'ACTIVE', now(), $2::timestamptz, $3,
           $4::numeric, $5, $6,
           $7, $8::boolean, false,
           $9, $10, NULL, NULL,
           now())
        ON CONFLICT ("userId") DO UPDATE SET
          "status"                = 'ACTIVE',
          "expiresAt"             = EXCLUDED."expiresAt",
          "currency"              = EXCLUDED."currency",
          "amountPaid"            = EXCLUDED."amountPaid",
          "autoRenew"             = EXCLUDED."autoRenew",
          "cancelAtPeriodEnd"     = false,
          "lastPaymentIntentId"   = COALESCE(EXCLUDED."lastPaymentIntentId", "CommunityMembership"."lastPaymentIntentId"),
          "stripeCustomerId"      = COALESCE(EXCLUDED."stripeCustomerId", "CommunityMembership"."stripeCustomerId"),
          "stripeSubscriptionId"  = COALESCE(EXCLUDED."stripeSubscriptionId", "CommunityMembership"."stripeSubscriptionId"),
          "lastInvoiceId"         = COALESCE(EXCLUDED."lastInvoiceId", "CommunityMembership"."lastInvoiceId"),
          "optedOutAt"            = NULL,
          "remainingDaysAtOptOut" = NULL,
          "updatedAt"             = now()
        RETURNING ${SELECT_COLS}
      ),
      logged AS (
        INSERT INTO "CommunityMembershipEvent"
          ("userId", "event", "expiresAtBefore", "expiresAtAfter",
           "amount", "currency", "paymentRef", "actorUserId", "ipAddress", "metadata")
        SELECT $1, $11, $12::timestamptz, u."expiresAt",
               $4::numeric, $3, $5, $13, $14,
               jsonb_build_object(
                 'invoiceId', $9,
                 'stripeSubscriptionId', $7,
                 'expiryFromStripe', $15::boolean
               )
        FROM upserted u
        RETURNING 1
      )
      SELECT ${SELECT_COLS} FROM upserted
      `,
      userId,                                   // $1
      expiresAt.toISOString(),                  // $2
      currency,                                 // $3
      amountPaid,                               // $4
      paymentRef,                               // $5
      stripeCustomerId,                         // $6
      stripeSubscriptionId,                     // $7
      autoRenew,                                // $8
      invoiceId,                                // $9
      source,                                   // $10
      event,                                    // $11
      expiresBefore ? expiresBefore.toISOString() : null, // $12
      actorUserId,                              // $13
      ipAddress,                                // $14
      !!expiresAtInput                          // $15
    )

    return {
      ok: true,
      membership: toMembership(rows[0]),
      message:
        event === 'ENROLLED'
          ? 'Community Membership activated.'
          : 'Community Membership renewed.',
    }
  } catch (e: any) {
    console.error('enrolOrRenew error:', e?.message)
    return {
      ok: false,
      code: 'ENROL_FAILED',
      message: 'Could not update Community Membership.',
    }
  }
}

// ── Opt out (two-step, because Stripe must agree) ────────────

export type CancellationIntent =
  | { ok: false; code: string; message: string }
  | {
      ok: true
      /** Cancel this in Stripe with cancel_at_period_end, then call confirmOptOut. */
      stripeSubscriptionId: string | null
      expiresAt: string
      message: string
    }

/**
 * STEP 1 of opt-out. Validates only — writes nothing.
 *
 * Returns the Stripe subscription id the caller must cancel. Splitting
 * this from the database write is deliberate: recording an opt-out that
 * Stripe never received is how a member ends up marked as departed
 * while their card keeps being charged. Write only after Stripe agrees.
 *
 * RULE 2d — blocked when Community Membership is the caller's last
 * entitlement source. Live entitlement is resolved rather than trusting
 * a stored flag, because group state changes for reasons unrelated to
 * this user. The refusal is framed as protective: "this is currently
 * your only active membership" reads very differently from "you cannot
 * leave".
 */
export async function requestOptOut(userId: string): Promise<CancellationIntent> {
  try {
    const existing = await getCommunityMembership(userId)

    if (!existing) {
      return {
        ok: false,
        code: 'NOT_ENROLLED',
        message: 'You do not currently hold a Community Membership.',
      }
    }

    if (existing.cancelAtPeriodEnd) {
      return {
        ok: false,
        code: 'ALREADY_CANCELLING',
        message: 'Your Community Membership is already set to end on its renewal date.',
      }
    }

    if (existing.status !== 'ACTIVE') {
      return {
        ok: false,
        code: 'NOT_ACTIVE',
        message: 'Your Community Membership is not currently active.',
      }
    }

    const ent = await resolveEntitlement(userId)
    const hasOtherSource =
      ent.qualifyingGroupIds.length > 0 || ent.reasons.includes('STAFF_ROLE')

    if (!hasOtherSource) {
      return {
        ok: false,
        code: 'LAST_ENTITLEMENT_SOURCE',
        message:
          'Community Membership is currently your only active membership. ' +
          'Ending it would limit your account to read-only access. ' +
          'Join a group first, then you can end this at any time.',
      }
    }

    return {
      ok: true,
      stripeSubscriptionId: existing.stripeSubscriptionId,
      expiresAt: existing.expiresAt,
      message: 'Ready to cancel.',
    }
  } catch (e: any) {
    console.error('requestOptOut error:', e?.message)
    return {
      ok: false,
      code: 'OPT_OUT_FAILED',
      message: 'Could not process this request.',
    }
  }
}

/**
 * STEP 2 of opt-out. Call ONLY after Stripe has confirmed the
 * cancellation (or after establishing there is no subscription to
 * cancel — bank transfer and mobile money members, and the four rows
 * backfilled before stripeSubscriptionId existed).
 *
 * The membership stays ACTIVE until expiresAt. The member keeps advert
 * visibility and full access through the period they paid for; it
 * simply will not renew. The expiry sweep flips it to EXPIRED
 * afterwards.
 */
export async function confirmOptOut(
  userId: string,
  opts: { actorUserId?: string | null; ipAddress?: string | null } = {}
): Promise<MutationResult> {
  try {
    const rows = await prisma.$queryRawUnsafe<MembershipRow[]>(
      `
      WITH updated AS (
        UPDATE "CommunityMembership"
        SET "cancelAtPeriodEnd" = true,
            "autoRenew"         = false,
            "optedOutAt"        = now(),
            "updatedAt"         = now()
        WHERE "userId" = $1
          AND "status" = 'ACTIVE'
        RETURNING ${SELECT_COLS}
      ),
      logged AS (
        INSERT INTO "CommunityMembershipEvent"
          ("userId", "event", "expiresAtBefore", "actorUserId", "ipAddress", "metadata")
        SELECT $1, 'CANCELLATION_REQUESTED', u."expiresAt", $2, $3,
               jsonb_build_object('stripeSubscriptionId', u."stripeSubscriptionId")
        FROM updated u
        RETURNING 1
      )
      SELECT ${SELECT_COLS} FROM updated
      `,
      userId,
      opts.actorUserId ?? null,
      opts.ipAddress ?? null
    )

    if (!rows?.length) {
      return {
        ok: false,
        code: 'NOT_ACTIVE',
        message: 'No active Community Membership to end.',
      }
    }

    const membership = toMembership(rows[0])
    const until = new Date(membership.expiresAt).toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })

    return {
      ok: true,
      membership,
      message:
        `Your Community Membership will not renew. You keep full access ` +
        `and group adverts until ${until}.`,
    }
  } catch (e: any) {
    console.error('confirmOptOut error:', e?.message)
    return {
      ok: false,
      code: 'OPT_OUT_FAILED',
      message: 'Could not update Community Membership.',
    }
  }
}

/**
 * Revoke a pending cancellation, before the period ends.
 *
 * The caller must ALSO clear cancel_at_period_end in Stripe. Same
 * two-step discipline as opt-out, in reverse: returns the subscription
 * id so the caller can reinstate it.
 */
export async function revokeCancellation(
  userId: string,
  opts: { actorUserId?: string | null; ipAddress?: string | null } = {}
): Promise<MutationResult> {
  try {
    const existing = await getCommunityMembership(userId)

    if (!existing) {
      return {
        ok: false,
        code: 'NOT_ENROLLED',
        message: 'You do not currently hold a Community Membership.',
      }
    }

    if (!existing.cancelAtPeriodEnd) {
      return {
        ok: false,
        code: 'NOT_CANCELLING',
        message: 'Your Community Membership is not scheduled to end.',
      }
    }

    if (new Date(existing.expiresAt) <= new Date()) {
      return {
        ok: false,
        code: 'ALREADY_ENDED',
        message: 'This membership period has already ended. Renewal payment is required.',
        membership: existing,
      }
    }

    const rows = await prisma.$queryRawUnsafe<MembershipRow[]>(
      `
      WITH updated AS (
        UPDATE "CommunityMembership"
        SET "cancelAtPeriodEnd" = false,
            "autoRenew"         = true,
            "optedOutAt"        = NULL,
            "updatedAt"         = now()
        WHERE "userId" = $1
        RETURNING ${SELECT_COLS}
      ),
      logged AS (
        INSERT INTO "CommunityMembershipEvent"
          ("userId", "event", "expiresAtAfter", "actorUserId", "ipAddress", "metadata")
        SELECT $1, 'CANCELLATION_REVOKED', u."expiresAt", $2, $3,
               jsonb_build_object('stripeSubscriptionId', u."stripeSubscriptionId")
        FROM updated u
        RETURNING 1
      )
      SELECT ${SELECT_COLS} FROM updated
      `,
      userId,
      opts.actorUserId ?? null,
      opts.ipAddress ?? null
    )

    return {
      ok: true,
      membership: toMembership(rows[0]),
      message: 'Your Community Membership will continue to renew.',
    }
  } catch (e: any) {
    console.error('revokeCancellation error:', e?.message)
    return {
      ok: false,
      code: 'REVOKE_FAILED',
      message: 'Could not update Community Membership.',
    }
  }
}

// ── Payment failure ──────────────────────────────────────────

/**
 * Record a failed renewal charge. Does NOT change status — Stripe
 * retries on its own schedule, and expiry plus grace already handles
 * the terminal case. This exists so the event trail explains why a
 * membership lapsed, and so dunning can be built on it later.
 */
export async function recordPaymentFailure(
  userId: string,
  detail: { paymentRef?: string | null; reason?: string | null } = {}
): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "CommunityMembershipEvent"
        ("userId", "event", "paymentRef", "metadata")
      VALUES ($1, 'PAYMENT_FAILED', $2, jsonb_build_object('reason', $3))
      `,
      userId,
      detail.paymentRef ?? null,
      detail.reason ?? null
    )
  } catch (e: any) {
    console.error('recordPaymentFailure error:', e?.message)
  }
}

// ── Expiry sweep ─────────────────────────────────────────────

/**
 * Flip ACTIVE memberships past expiry + grace to EXPIRED, logging one
 * event each. Idempotent — a second run in the same window is a no-op.
 *
 * PHASE 4 DEPENDENCY: do not schedule this until renewal reminders
 * exist. Expiring someone who was never warned is the behaviour that
 * generates support load and ill will.
 */
export async function expireLapsed(): Promise<{ expired: number }> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `
      WITH lapsed AS (
        UPDATE "CommunityMembership"
        SET "status"    = 'EXPIRED',
            "updatedAt" = now()
        WHERE "status" = 'ACTIVE'
          AND "expiresAt" < now() - ($1::int * interval '1 day')
        RETURNING "userId", "expiresAt", "cancelAtPeriodEnd"
      ),
      logged AS (
        INSERT INTO "CommunityMembershipEvent"
          ("userId", "event", "expiresAtBefore", "metadata")
        SELECT l."userId", 'EXPIRED', l."expiresAt",
               jsonb_build_object(
                 'graceDays', $1::int,
                 'sweep', true,
                 'wasCancellation', l."cancelAtPeriodEnd"
               )
        FROM lapsed l
        RETURNING 1
      )
      SELECT COUNT(*)::bigint AS count FROM lapsed
      `,
      EXPIRY_GRACE_DAYS
    )
    return { expired: Number(rows?.[0]?.count ?? 0) }
  } catch (e: any) {
    console.error('expireLapsed error:', e?.message)
    return { expired: 0 }
  }
}
