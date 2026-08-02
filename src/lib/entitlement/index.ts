// src/lib/entitlement/index.ts
// Community Membership + group entitlement resolver.
// Phase 1c — SHADOW MODE. Resolves and logs. Enforces NOTHING.
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
// read-only floor: they keep sight of their own contributions,
// stakes, loan balances and statements, and lose the ability to
// transact. Hard-locking someone out of the record of money they
// paid in is not a state this system produces.
//
//   canAccessPortal  read-only floor — true for any valid user
//   canTransact      the real gate — requires entitlement
//   canSeeAdverts    Community Membership only (rule 2c)
//
// ── WHY NOT THE JWT ──────────────────────────────────────────
// Entitlement goes stale for reasons that have nothing to do with
// the user: their group is paused, its member count drops, its
// subscription lapses. A 15-minute token would serve a stale
// answer for up to 15 minutes after any of those. So this resolves
// server-side, per request, against the database — and the
// joiningFeePaid claim in the JWT is superseded, not extended.
//
// ── WHY NOT MIDDLEWARE ───────────────────────────────────────
// middleware.ts runs on the Edge runtime and cannot reach Prisma.
// Enforcement (phase 5) belongs in the dashboard/portal layout and
// in a shared API guard, not in middleware.
//
// ── COST ─────────────────────────────────────────────────────
// ONE database round trip, memoised per request. A layout, a page
// and three API guards calling this in one request cost one query
// between them. No aggregates on the hot path — the member-count
// check is precomputed into Group.reachedMinimumAt by migration 1b.

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
 * Truth-table row 4 — group subscription currency.
 *
 * NOT YET WIRED. The group subscription table has not been supplied, so
 * this predicate is a placeholder that passes every group. Consequence:
 * the shadow log UNDER-REPORTS — nobody is currently flagged on the
 * subscription axis. Treat phase-1 findings as provisional until this
 * is replaced.
 *
 * To wire: substitute a correlated EXISTS against the real table, e.g.
 *
 *   AND EXISTS (
 *     SELECT 1 FROM "GroupSubscription" gs
 *     WHERE gs."groupId" = g.id
 *       AND gs.status = 'ACTIVE'
 *       AND gs."currentPeriodEnd" > now() - interval '14 days'
 *   )
 *
 * Nothing else in this file changes.
 */
const GROUP_SUBSCRIPTION_PREDICATE = 'TRUE /* TODO: group subscription check not wired */'

/** Phase 5 flips this. While false, nothing is enforced. */
export const ENTITLEMENT_ENFORCED = false

// ── Types ────────────────────────────────────────────────────

export type EntitlementReason =
  | 'STAFF_ROLE'
  | 'COMMUNITY_MEMBERSHIP_ACTIVE'
  | 'QUALIFYING_GROUP'
  | 'COMMUNITY_MEMBERSHIP_EXPIRED'
  | 'COMMUNITY_MEMBERSHIP_OPTED_OUT'
  | 'NO_COMMUNITY_MEMBERSHIP'
  | 'NO_QUALIFYING_GROUP'
  | 'USER_NOT_FOUND'
  | 'USER_BLACKLISTED'

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
  qualifyingGroupIds: string[]
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
}

// ── The query ────────────────────────────────────────────────
// One round trip. Three CTEs, each hitting a single index:
//   me   → User primary key
//   cm   → uq_communitymembership_userid
//   grp  → idx_groupmember_userid_status + idx_group_entitlement
//
// Enum comparisons use explicit ::"Type" casts on the literal arrays.
// Postgres will not implicitly resolve a text[] against an enum column.
function buildQuery(): string {
  const memberStatuses = QUALIFYING_MEMBER_STATUSES
    .map(s => `'${s}'::"MemberStatus"`)
    .join(', ')
  const groupStatuses = QUALIFYING_GROUP_STATUSES
    .map(s => `'${s}'::"GroupStatus"`)
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
    grp AS (
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
        AND ${GROUP_SUBSCRIPTION_PREDICATE}
    )
    SELECT
      (SELECT COUNT(*) FROM me) > 0                                    AS user_found,
      (SELECT status FROM me)                                          AS user_status,
      (SELECT role   FROM me)                                          AS user_role,
      (SELECT "status"     FROM cm)                                    AS cm_status,
      (SELECT "expiresAt"  FROM cm)                                    AS cm_expires_at,
      (SELECT "optedOutAt" FROM cm)                                    AS cm_opted_out_at,
      COALESCE(
        (SELECT array_agg("groupId") FROM grp), ARRAY[]::text[]
      )                                                                AS qualifying_group_ids
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
    resolvedAt: new Date().toISOString(),
  }
}

async function resolve(userId: string): Promise<Entitlement> {
  let row: ResolverRow | undefined

  try {
    const rows = await prisma.$queryRawUnsafe<ResolverRow[]>(
      buildQuery(),
      userId,
      GROUP_RAMP_UP_DAYS
    )
    row = rows?.[0]
  } catch (e: any) {
    // Fail OPEN in shadow mode. A resolver fault must never be the
    // reason someone cannot use the platform while nothing is being
    // enforced anyway. Revisit this posture at phase 5.
    console.error('resolveEntitlement query error:', e?.message)
    return {
      ...denied(userId, 'USER_NOT_FOUND'),
      canAccessPortal: true,
      canTransact: true,
      isEntitled: true,
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
  if (groupIds.length > 0) {
    reasons.push('QUALIFYING_GROUP')
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
  if (ENTITLEMENT_ENFORCED) return

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
 * Phase 5 API guard. Currently a NO-OP by design — it resolves, logs,
 * and returns null so every caller proceeds. Adding this to routes NOW
 * means phase 5 is a one-line change (ENTITLEMENT_ENFORCED = true)
 * rather than an edit to every route file.
 */
export async function requireEntitlement(
  req: NextRequest
): Promise<{ blocked: false; entitlement: Entitlement | null }> {
  const entitlement = await getEntitlementFromRequest(req)
  // Phase 5: when ENTITLEMENT_ENFORCED and !entitlement?.canTransact,
  // return a 402 with reasons and the renewal path.
  return { blocked: false, entitlement }
}
