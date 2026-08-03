// src/lib/entitlement/index.ts
// Community Membership + group entitlement resolver.
// Version 2 — SHADOW MODE. Resolves and logs. Enforces NOTHING.
//
// ── WHAT CHANGED FROM v1 ─────────────────────────────────────
// Truth-table row 4 (group subscription) is now wired against
// "PlatformSubscription", replacing the placeholder that passed every
// group. The resolver now applies all four rows.
//
// It matches on ps."groupId" = g."id" rather than on ps."scope",
// because groupId is populated ONLY for group-scoped subscriptions —
// MEMBER_ANNUAL rows carry a userId and a null groupId. That avoids
// depending on the exact scope string literal.
//
// A new reason, GROUP_SUBSCRIPTION_LAPSED, distinguishes "you are in no
// qualifying group" from "your group qualifies on every axis except
// that its subscription has lapsed". Those are very different support
// conversations and the shadow log needs to tell them apart.
//
// ── THE MODEL ────────────────────────────────────────────────
// Portal access is OR-based across two independent entitlement
// sources. Community Membership grants FEATURES, not access:
//
//   isEntitled = isStaffRole
//             OR communityMembershipActive
//             OR hasQualifyingGroupMembership
//
// A user who fails all three is NOT locked out. They drop to a
// read-only floor: they keep sight of their own contributions, stakes,
// loan balances and statements, and lose the ability to transact.
// Hard-locking someone out of the record of money they paid in is not a
// state this system produces.
//
//   canAccessPortal  read-only floor — true for any valid user
//   canTransact      the real gate — requires entitlement
//   canSeeAdverts    Community Membership only (rule 2c)
//
// ── WHY NOT THE JWT ──────────────────────────────────────────
// Entitlement goes stale for reasons that have nothing to do with the
// user: their group is paused, its member count drops, its subscription
// lapses. A 15-minute token would serve a stale answer for up to 15
// minutes after any of those. So this resolves server-side, per
// request, and the joiningFeePaid claim is superseded, not extended.
//
// ── WHY NOT MIDDLEWARE ───────────────────────────────────────
// middleware.ts runs on the Edge runtime and cannot reach Prisma.
// Enforcement (phase 5) belongs in the dashboard/portal layout and in a
// shared API guard.
//
// ── COST ─────────────────────────────────────────────────────
// ONE round trip, memoised per request. No aggregates on the hot path —
// the member-count check is precomputed into Group.reachedMinimumAt by
// migration 1b, and the subscription check is a correlated EXISTS.

import { cache } from 'react'
import type { NextRequest } from 'next/server'
import prisma from '@/lib/prisma/client'
import { getClaims, getClaimsFromRequest } from '@/lib/auth'

// ── Configuration ────────────────────────────────────────────

/** Roles that never pay and are always entitled. */
const STAFF_ROLES = ['SYSTEM_ADMIN', 'NATIONAL_ADMIN', 'AUDITOR']

/** Truth-table row 1 — MemberStatus values that qualify. */
const QUALIFYING_MEMBER_STATUSES = ['ACTIVE', 'SUSPENDED', 'DEFAULTED']

/** Truth-table row 2 — GroupStatus values that qualify. */
const QUALIFYING_GROUP_STATUSES = ['ACTIVE', 'PAUSED', 'COMPLETED']

/**
 * Truth-table row 3 — ramp-up window. A group that has not yet reached
 * minMembers still qualifies this many days after activation, so early
 * invitees are not billed the fee rule 3b exempts them from.
 */
const GROUP_RAMP_UP_DAYS = 60

/**
 * Truth-table row 4 — Stripe subscription statuses that count as
 * current. Stripe's own vocabulary.
 *
 * past_due is deliberately INCLUDED: Stripe is still retrying the card
 * and the admin may well fix it. Dropping every member of the group the
 * moment a renewal charge bounces is too sharp an edge for something
 * outside those members' control.
 */
const CURRENT_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due']

/**
 * Truth-table row 4 — member-side grace beyond the subscription's own
 * period end. Members do not control their group's billing, so they get
 * time to react to a lapse caused by someone else's card.
 */
const GROUP_SUBSCRIPTION_GRACE_DAYS = 30

/**
 * PHASE 5 — enforcement is LIVE.
 *
 * Set back to false to disable everything below in one deploy. That is
 * the rollback: no code changes, no migration.
 */
export const ENTITLEMENT_ENFORCED = true

// ── Types ────────────────────────────────────────────────────

export type EntitlementReason =
  | 'STAFF_ROLE'
  | 'COMMUNITY_MEMBERSHIP_ACTIVE'
  | 'QUALIFYING_GROUP'
  | 'COMMUNITY_MEMBERSHIP_EXPIRED'
  | 'COMMUNITY_MEMBERSHIP_OPTED_OUT'
  | 'NO_COMMUNITY_MEMBERSHIP'
  | 'NO_QUALIFYING_GROUP'
  | 'GROUP_SUBSCRIPTION_LAPSED'
  | 'USER_NOT_FOUND'
  | 'USER_BLACKLISTED'
  | 'RESOLVER_ERROR'

export type Entitlement = {
  userId: string
  /** Read-only floor. False only for blacklisted or unknown users. */
  canAccessPortal: boolean
  /** The real gate — contribute, borrow, join schemes, vote. */
  canTransact: boolean
  /** Group adverts visibility (rule 2c). Community Membership only. */
  canSeeAdverts: boolean
  /** True when any of the three entitlement sources holds. */
  isEntitled: boolean
  /** Every reason that applied, granting and denying. Ordered. */
  reasons: EntitlementReason[]
  communityMembership: {
    status: string
    expiresAt: string | null
    optedOut: boolean
  } | null
  /** Groups conferring entitlement — all four truth-table rows pass. */
  qualifyingGroupIds: string[]
  /**
   * Groups passing rows 1-3 but failing row 4. Non-empty here with an
   * empty qualifyingGroupIds means the member is losing entitlement
   * because of their group's billing, not their own conduct.
   */
  subscriptionLapsedGroupIds: string[]
  resolvedAt: string
}

type ResolverRow = {
  user_found: boolean
  user_status: string | null
  user_role: string | null
  cm_status: string | null
  cm_expires_at: Date | null
  cm_opted_out_at: Date | null
  qualifying_group_ids: string[] | null
  sub_lapsed_group_ids: string[] | null
}

// ── The query ────────────────────────────────────────────────
// One round trip. Four CTEs, each hitting a single index:
//   me       → User primary key
//   cm       → uq_communitymembership_userid
//   grp_base → idx_groupmember_userid_status + idx_group_entitlement
//   grp      → grp_base minus groups whose subscription has lapsed
//
// Enum comparisons use explicit ::"Type" casts on the literals.
// Postgres will not implicitly resolve a text list against an enum.
function buildQuery(): string {
  const memberStatuses = QUALIFYING_MEMBER_STATUSES
    .map(s => `'${s}'::"MemberStatus"`)
    .join(', ')
  const groupStatuses = QUALIFYING_GROUP_STATUSES
    .map(s => `'${s}'::"GroupStatus"`)
    .join(', ')
  // PlatformSubscription.status is TEXT, not an enum — no cast needed.
  const subStatuses = CURRENT_SUBSCRIPTION_STATUSES
    .map(s => `'${s}'`)
    .join(', ')

  return `
    WITH me AS (
      SELECT u."id", u."status"::text AS status, u."role"::text AS role
      FROM "User" u
      WHERE u."id" = $1 AND u."deletedAt" IS NULL
    ),
    cm AS (
      SELECT c."status", c."expiresAt", c."optedOutAt"
      FROM "CommunityMembership" c
      WHERE c."userId" = $1
    ),
    grp_base AS (
      -- Truth-table rows 1-3.
      SELECT gm."groupId"
      FROM "GroupMember" gm
      JOIN "Group" g ON g."id" = gm."groupId"
      WHERE gm."userId" = $1
        AND gm."status" IN (${memberStatuses})
        AND g."status"  IN (${groupStatuses})
        AND g."deletedAt" IS NULL
        AND (
          g."reachedMinimumAt" IS NOT NULL
          OR (
            g."activatedAt" IS NOT NULL
            AND g."activatedAt" > now() - ($2::int * interval '1 day')
          )
        )
    ),
    grp AS (
      -- Truth-table row 4. Matches on groupId rather than scope:
      -- groupId is populated only for group-scoped subscriptions, so
      -- MEMBER_ANNUAL rows (userId set, groupId null) cannot match.
      SELECT b."groupId"
      FROM grp_base b
      WHERE EXISTS (
        SELECT 1
        FROM "PlatformSubscription" ps
        -- Deliberately NOT checking canceledAt. Stripe sets
        -- canceled_at the moment a cancel_at_period_end is REQUESTED,
        -- while status stays 'active' until the period actually ends.
        -- Testing canceledAt IS NULL would strip entitlement from every
        -- member of a group that is still fully paid up. status plus
        -- currentPeriodEnd is the correct pair.
        WHERE ps."groupId" = b."groupId"
          AND ps."status" IN (${subStatuses})
          AND (
            ps."currentPeriodEnd" IS NULL
            OR ps."currentPeriodEnd" > now() - ($3::int * interval '1 day')
          )
      )
    )
    SELECT
      (SELECT COUNT(*) FROM me) > 0                       AS user_found,
      (SELECT status FROM me)                             AS user_status,
      (SELECT role   FROM me)                             AS user_role,
      (SELECT "status"     FROM cm)                       AS cm_status,
      (SELECT "expiresAt"  FROM cm)                       AS cm_expires_at,
      (SELECT "optedOutAt" FROM cm)                       AS cm_opted_out_at,
      COALESCE(
        (SELECT array_agg("groupId") FROM grp), ARRAY[]::text[]
      )                                                   AS qualifying_group_ids,
      COALESCE(
        (SELECT array_agg(b."groupId") FROM grp_base b
          WHERE b."groupId" NOT IN (SELECT "groupId" FROM grp)),
        ARRAY[]::text[]
      )                                                   AS sub_lapsed_group_ids
  `
}

// ── Resolution ───────────────────────────────────────────────

function denied(userId: string, reason: EntitlementReason): Entitlement {
  return {
    userId,
    canAccessPortal: reason !== 'USER_BLACKLISTED' && reason !== 'USER_NOT_FOUND',
    canTransact: false,
    canSeeAdverts: false,
    isEntitled: false,
    reasons: [reason],
    communityMembership: null,
    qualifyingGroupIds: [],
    subscriptionLapsedGroupIds: [],
    resolvedAt: new Date().toISOString(),
  }
}

async function resolve(userId: string): Promise<Entitlement> {
  let row: ResolverRow | undefined

  try {
    const rows = await prisma.$queryRawUnsafe<ResolverRow[]>(
      buildQuery(),
      userId,
      GROUP_RAMP_UP_DAYS,
      GROUP_SUBSCRIPTION_GRACE_DAYS
    )
    row = rows?.[0]
  } catch (e: any) {
    // ── FAIL CLOSED ───────────────────────────────────────────
    // In shadow mode this failed OPEN, which was right: nothing was
    // enforced, so a resolver fault should not have been the reason
    // someone could not use the platform.
    //
    // Under enforcement the calculus inverts. canTransact gates
    // contributions, loans and payouts, and a database blip must not
    // become a licence to move money without an entitlement check.
    // Read access is unaffected — canAccessPortal stays true, so the
    // member still sees every record of their own money.
    console.error('resolveEntitlement query error (failing closed):', e?.message)
    return {
      ...denied(userId, 'RESOLVER_ERROR'),
      canAccessPortal: true,
    }
  }

  if (!row || !row.user_found) return denied(userId, 'USER_NOT_FOUND')
  if (row.user_status === 'BLACKLISTED') return denied(userId, 'USER_BLACKLISTED')

  const now = Date.now()
  const reasons: EntitlementReason[] = []

  // Source 1 — staff
  const isStaff = !!row.user_role && STAFF_ROLES.includes(row.user_role)
  if (isStaff) reasons.push('STAFF_ROLE')

  // Source 2 — Community Membership
  const cmExpiresAt = row.cm_expires_at ? new Date(row.cm_expires_at) : null
  const cmActive =
    row.cm_status === 'ACTIVE' && !!cmExpiresAt && cmExpiresAt.getTime() > now

  if (cmActive) {
    reasons.push('COMMUNITY_MEMBERSHIP_ACTIVE')
  } else if (row.cm_status === 'SUSPENDED') {
    reasons.push('COMMUNITY_MEMBERSHIP_OPTED_OUT')
  } else if (row.cm_status) {
    reasons.push('COMMUNITY_MEMBERSHIP_EXPIRED')
  } else {
    reasons.push('NO_COMMUNITY_MEMBERSHIP')
  }

  // Source 3 — qualifying group membership
  const groupIds = row.qualifying_group_ids ?? []
  const lapsedIds = row.sub_lapsed_group_ids ?? []

  if (groupIds.length > 0) {
    reasons.push('QUALIFYING_GROUP')
  } else if (lapsedIds.length > 0) {
    // Passes rows 1-3, fails row 4. The member did nothing wrong —
    // their group's billing did. Distinguished so support can say so.
    reasons.push('GROUP_SUBSCRIPTION_LAPSED')
  } else {
    reasons.push('NO_QUALIFYING_GROUP')
  }

  const isEntitled = isStaff || cmActive || groupIds.length > 0

  return {
    userId,
    canAccessPortal: true,
    canTransact: isEntitled,
    canSeeAdverts: cmActive || isStaff,
    isEntitled,
    reasons,
    communityMembership: row.cm_status
      ? {
          status: row.cm_status,
          expiresAt: cmExpiresAt ? cmExpiresAt.toISOString() : null,
          optedOut: !!row.cm_opted_out_at,
        }
      : null,
    qualifyingGroupIds: groupIds,
    subscriptionLapsedGroupIds: lapsedIds,
    resolvedAt: new Date().toISOString(),
  }
}

// ── Shadow logging ───────────────────────────────────────────
// Writes only when a user WOULD have been blocked, deduped to one row
// per user per UTC day. Fire-and-forget: a logging failure must never
// surface to the caller or delay a response.
export async function logShadowMiss(
  ent: Entitlement,
  role: string | null,
  path: string | null
): Promise<void> {
  if (ent.isEntitled) return
  // Deliberately NOT skipped under enforcement. In shadow mode this was
  // evidence for the truth table; now it is the record of who is
  // actually being restricted — the first thing anyone will want when a
  // member says they cannot contribute.

  try {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "EntitlementShadowLog" ("userId", "role", "reasons", "path")
      VALUES ($1, $2, $3::text[], $4)
      ON CONFLICT ("userId", "day") DO UPDATE
        SET "hitCount"   = "EntitlementShadowLog"."hitCount" + 1,
            "lastSeenAt" = now()
      `,
      ent.userId,
      role,
      ent.reasons,
      path
    )
  } catch (e: any) {
    console.error('logShadowMiss error:', e?.message)
  }
}

// ── Public API ───────────────────────────────────────────────

/** Resolve for an explicit user id. One query. Not memoised. */
export async function resolveEntitlement(userId: string): Promise<Entitlement> {
  return resolve(userId)
}

/**
 * Resolve for a server component / layout, from cookies.
 * Memoised per request via React cache() — same pattern as getSession.
 */
export const getEntitlement = cache(async (): Promise<Entitlement | null> => {
  try {
    const claims = await getClaims()
    if (!claims) return null
    const ent = await resolve(claims.id)
    // No request path available in a server component — pass null.
    void logShadowMiss(ent, claims.role, null)
    return ent
  } catch {
    return null
  }
})

const requestCache = new WeakMap<NextRequest, Entitlement | null>()

/**
 * Resolve for an API request. Memoised per request via WeakMap — same
 * pattern as getClaimsFromRequest and getSessionFromRequest.
 */
export async function getEntitlementFromRequest(
  req: NextRequest
): Promise<Entitlement | null> {
  if (requestCache.has(req)) return requestCache.get(req)!

  const claims = await getClaimsFromRequest(req)
  if (!claims) {
    requestCache.set(req, null)
    return null
  }

  const ent = await resolve(claims.id)
  requestCache.set(req, ent)
  void logShadowMiss(ent, claims.role, req.nextUrl?.pathname ?? null)
  return ent
}

/**
 * Guard for MUTATING API routes. Returns a response to send, or null to
 * proceed:
 *
 *   const blocked = await requireEntitlement(req)
 *   if (blocked) return blocked
 *
 * Read routes should NOT use this. The read-only floor is deliberate —
 * a member who has lapsed keeps full sight of their contributions,
 * stakes, loan balances and statements. Only the ability to move money
 * is withheld.
 *
 * 402 Payment Required rather than 403: the caller is authenticated and
 * permitted in principle, and the resolution is a payment. The reasons
 * array is returned so the UI can say WHICH condition failed instead of
 * showing a generic refusal.
 */
export async function requireEntitlement(
  req: NextRequest
): Promise<NextResponse | null> {
  const entitlement = await getEntitlementFromRequest(req)

  if (!ENTITLEMENT_ENFORCED) return null

  if (!entitlement) {
    return NextResponse.json(
      { success: false, error: 'Unauthorised. Please log in.' },
      { status: 401 }
    )
  }

  if (entitlement.reasons.includes('USER_BLACKLISTED')) {
    return NextResponse.json(
      { success: false, code: 'ACCOUNT_SUSPENDED', error: 'This account has been suspended.' },
      { status: 403 }
    )
  }

  if (!entitlement.canTransact) {
    // Group billing is the one case where the member did nothing wrong,
    // so it gets its own message and no payment prompt — there is
    // nothing for them to pay.
    const groupLapsed = entitlement.subscriptionLapsedGroupIds.length > 0

    return NextResponse.json(
      {
        success: false,
        code: groupLapsed ? 'GROUP_SUBSCRIPTION_LAPSED' : 'MEMBERSHIP_REQUIRED',
        error: groupLapsed
          ? 'Your group\u2019s subscription needs attention. Your records are safe — new ' +
            'activity resumes once the group administrator resolves it.'
          : 'An active membership is required for this. Your records stay available in ' +
            'the meantime.',
        reasons: entitlement.reasons,
        data: { renewAt: groupLapsed ? null : '/dashboard/join-fee' },
      },
      { status: 402 }
    )
  }

  return null
}
