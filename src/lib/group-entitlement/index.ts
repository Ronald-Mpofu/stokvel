// src/lib/group-entitlement/index.ts
// Write-path hooks for the two columns migration 1b added to "Group".
//
// Phase 2b.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────
// Migration 1b backfilled activatedAt and reachedMinimumAt for existing
// groups, but nothing stamps them going forward. Without these hooks,
// every NEW group leaves reachedMinimumAt null forever, and its members
// silently drop out of entitlement the moment the 60-day ramp-up window
// elapses. That failure is invisible in shadow mode and catastrophic
// after phase 5.
//
// ── WHERE TO CALL ────────────────────────────────────────────
//   stampGroupActivated(groupId)
//     wherever a group's status is set to ACTIVE — creation-with-active,
//     the settings status control, and any admin activation route.
//
//   stampGroupReachedMinimum(groupId)
//     after ANY write that increases a group's active-equivalent member
//     count: invite acceptance, direct member add, member reinstatement
//     (EXITED/SUSPENDED back to ACTIVE).
//
// Both are safe to call redundantly. Both are no-ops once stamped.
//
// ── NOT IN PRISMA ────────────────────────────────────────────
// activatedAt and reachedMinimumAt are raw-SQL columns. Never add them
// to a Prisma select.

import prisma from '@/lib/prisma/client'

/**
 * MemberStatus values that count toward group size.
 *
 * Deliberately matches QUALIFYING_MEMBER_STATUSES in
 * src/lib/entitlement/index.ts and the backfill in migration 1b. A
 * disciplined member still counts toward the group's size — suspending
 * someone should not shrink the group below minimum and cascade a
 * lockout onto everyone else.
 *
 * If you change this set, change it in all three places.
 */
const COUNTING_MEMBER_STATUSES = ['ACTIVE', 'SUSPENDED', 'DEFAULTED']

function memberStatusList(): string {
  return COUNTING_MEMBER_STATUSES.map(s => `'${s}'::"MemberStatus"`).join(', ')
}

/**
 * Stamp activatedAt the first time a group becomes ACTIVE.
 *
 * Starts the 60-day ramp-up window during which members of a
 * below-minimum group are still entitled — the window that stops early
 * invitees being billed a fee rule 3b exempts them from.
 *
 * No-op if already stamped. Never overwrites.
 */
export async function stampGroupActivated(groupId: string): Promise<void> {
  if (!groupId) return
  try {
    await prisma.$executeRawUnsafe(
      `
      UPDATE "Group"
      SET "activatedAt" = now()
      WHERE "id" = $1
        AND "activatedAt" IS NULL
      `,
      groupId
    )
  } catch (e: any) {
    console.error('stampGroupActivated error:', e?.message)
  }
}

/**
 * Stamp reachedMinimumAt the first time a group's counting member total
 * reaches minMembers.
 *
 * Once stamped it is never cleared, so a group that later shrinks does
 * not strip entitlement from members who have been contributing for
 * months. That is intentional: the size check exists to stop
 * shell-group-of-one arbitrage at creation time, not to police
 * attrition in an established group.
 *
 * The COUNT here is the only aggregate in the entitlement system, and it
 * runs on member-write, not on request. Once stamped, the WHERE clause
 * short-circuits on the IS NULL test before the subquery is evaluated.
 */
export async function stampGroupReachedMinimum(groupId: string): Promise<void> {
  if (!groupId) return
  try {
    await prisma.$executeRawUnsafe(
      `
      UPDATE "Group" g
      SET "reachedMinimumAt" = now()
      WHERE g."id" = $1
        AND g."reachedMinimumAt" IS NULL
        AND g."deletedAt" IS NULL
        AND (
          SELECT COUNT(*)
          FROM "GroupMember" m
          WHERE m."groupId" = g."id"
            AND m."status" IN (${memberStatusList()})
        ) >= g."minMembers"
      `,
      groupId
    )
  } catch (e: any) {
    console.error('stampGroupReachedMinimum error:', e?.message)
  }
}

/**
 * Convenience for routes that both activate a group and add members in
 * one operation. Order matters only cosmetically; both are idempotent.
 */
export async function stampGroupEntitlement(groupId: string): Promise<void> {
  await stampGroupActivated(groupId)
  await stampGroupReachedMinimum(groupId)
}

/**
 * Read-only. Returns why a group does or does not currently confer
 * entitlement — for an admin-facing diagnostic panel, and for support
 * answering "why is my member being asked to pay?".
 *
 * Does NOT include the subscription check (truth-table row 4), which is
 * not yet wired.
 */
export async function getGroupEntitlementStatus(groupId: string): Promise<{
  groupId: string
  status: string
  memberCount: number
  minMembers: number
  activatedAt: string | null
  reachedMinimumAt: string | null
  confersEntitlement: boolean
  reason: string
} | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<
      {
        id: string
        status: string
        minMembers: number
        activatedAt: Date | null
        reachedMinimumAt: Date | null
        member_count: bigint
        in_ramp_up: boolean
      }[]
    >(
      `
      SELECT
        g."id",
        g."status"::text AS status,
        g."minMembers",
        g."activatedAt",
        g."reachedMinimumAt",
        (
          SELECT COUNT(*) FROM "GroupMember" m
          WHERE m."groupId" = g."id"
            AND m."status" IN (${memberStatusList()})
        )::bigint AS member_count,
        COALESCE(g."activatedAt" > now() - interval '60 days', false) AS in_ramp_up
      FROM "Group" g
      WHERE g."id" = $1 AND g."deletedAt" IS NULL
      `,
      groupId
    )

    const r = rows?.[0]
    if (!r) return null

    const statusOk = ['ACTIVE', 'PAUSED', 'COMPLETED'].includes(r.status)
    const sizeOk = r.reachedMinimumAt !== null || r.in_ramp_up
    const confers = statusOk && sizeOk

    let reason: string
    if (!statusOk) {
      reason = `Group status ${r.status} does not confer entitlement.`
    } else if (r.reachedMinimumAt) {
      reason = 'Group has reached its minimum membership.'
    } else if (r.in_ramp_up) {
      reason = `Within the 60-day ramp-up window; still below ${r.minMembers} members.`
    } else {
      reason =
        `Ramp-up window has elapsed and the group has never reached ` +
        `${r.minMembers} members. Members are not entitled through this group.`
    }

    return {
      groupId: r.id,
      status: r.status,
      memberCount: Number(r.member_count),
      minMembers: r.minMembers,
      activatedAt: r.activatedAt ? new Date(r.activatedAt).toISOString() : null,
      reachedMinimumAt: r.reachedMinimumAt
        ? new Date(r.reachedMinimumAt).toISOString()
        : null,
      confersEntitlement: confers,
      reason,
    }
  } catch (e: any) {
    console.error('getGroupEntitlementStatus error:', e?.message)
    return null
  }
}
