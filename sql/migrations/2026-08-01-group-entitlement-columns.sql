-- ============================================================
-- 2026-08-01-group-entitlement-columns.sql
-- Phase 1b — Group columns backing truth-table row 3 (size check)
--
-- RUN AFTER 2026-08-01-community-membership.sql.
--
-- Idempotent. Safe to re-run.
--
-- WHY THESE COLUMNS EXIST
--   Truth-table row 3 is "memberCount >= minMembers". Evaluating that
--   live means a COUNT(*) over "GroupMember" per group, per request, on
--   the entitlement hot path. Instead:
--
--     reachedMinimumAt  stamped ONCE, the first time a group's ACTIVE
--                       member count reaches minMembers. Never cleared.
--                       The check becomes IS NOT NULL — index-friendly,
--                       no aggregate.
--
--     activatedAt       stamped when the group first becomes ACTIVE.
--                       Powers the ramp-up window: a group that has not
--                       yet reached minimum still qualifies for
--                       GROUP_RAMP_UP_DAYS after activation, so the
--                       first 2-3 invitees are not billed the annual
--                       fee that rule 3b promises they will not pay.
--
--   Together these close the shell-group-of-one arbitrage (a group that
--   never reaches minimum stops conferring entitlement once the ramp-up
--   window elapses) without penalising genuine growth.
--
--   NOT in schema.prisma. Access via $queryRawUnsafe only — never add
--   these to a Prisma select.
-- ============================================================

BEGIN;

-- ── 1. Columns ───────────────────────────────────────────────
ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS "activatedAt"      TIMESTAMPTZ;
ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS "reachedMinimumAt" TIMESTAMPTZ;

-- Partial index: the resolver joins Group and filters on these two.
-- Only non-DISSOLVED, non-deleted groups are ever candidates.
CREATE INDEX IF NOT EXISTS "idx_group_entitlement"
  ON "Group" ("status", "reachedMinimumAt", "activatedAt")
  WHERE "deletedAt" IS NULL;

-- Supports the GroupMember side of the resolver join.
CREATE INDEX IF NOT EXISTS "idx_groupmember_userid_status"
  ON "GroupMember" ("userId", "status");


-- ── 2. Backfill activatedAt ──────────────────────────────────
-- No historical record of when each group flipped to ACTIVE exists, so
-- createdAt is the honest approximation. For groups already past their
-- ramp-up window this value is irrelevant anyway — reachedMinimumAt
-- below is what will carry them.
UPDATE "Group"
SET "activatedAt" = COALESCE("activatedAt", "createdAt")
WHERE "status" IN ('ACTIVE'::"GroupStatus", 'PAUSED'::"GroupStatus", 'COMPLETED'::"GroupStatus")
  AND "activatedAt" IS NULL;


-- ── 3. Backfill reachedMinimumAt ─────────────────────────────
-- Stamp every group whose CURRENT active-equivalent member count
-- already meets minMembers. This is the one place a live COUNT(*) runs,
-- and it runs once, at migration time.
--
-- "Active-equivalent" uses the same MemberStatus set as the resolver
-- (ACTIVE, SUSPENDED, DEFAULTED) so the backfill and the runtime check
-- agree. A disciplined member still counts toward group size.
UPDATE "Group" g
SET "reachedMinimumAt" = COALESCE(g."reachedMinimumAt", now())
FROM (
  SELECT gm."groupId", COUNT(*) AS member_count
  FROM "GroupMember" gm
  WHERE gm."status" IN (
    'ACTIVE'::"MemberStatus", 'SUSPENDED'::"MemberStatus", 'DEFAULTED'::"MemberStatus"
  )
  GROUP BY gm."groupId"
) counts
WHERE counts."groupId" = g."id"
  AND counts.member_count >= g."minMembers"
  AND g."reachedMinimumAt" IS NULL
  AND g."deletedAt" IS NULL;


-- ── 4. Confirmation ──────────────────────────────────────────
SELECT
  COUNT(*)                                                  AS groups_total,
  COUNT(*) FILTER (WHERE "activatedAt"      IS NOT NULL)    AS with_activated_at,
  COUNT(*) FILTER (WHERE "reachedMinimumAt" IS NOT NULL)    AS reached_minimum,
  COUNT(*) FILTER (
    WHERE "reachedMinimumAt" IS NULL
      AND "status" IN ('ACTIVE'::"GroupStatus", 'PAUSED'::"GroupStatus", 'COMPLETED'::"GroupStatus")
  )                                                         AS below_minimum_qualifying_status
FROM "Group"
WHERE "deletedAt" IS NULL;

COMMIT;

-- ============================================================
-- MAINTENANCE — NOT part of this migration, but required before
-- phase 5 enforcement. Two write paths must stamp these columns:
--
--   1. Group activation (status → ACTIVE)
--        SET "activatedAt" = COALESCE("activatedAt", now())
--
--   2. Member join / reinstate — after the GroupMember row is written:
--        UPDATE "Group" g SET "reachedMinimumAt" = now()
--        WHERE g.id = $1 AND g."reachedMinimumAt" IS NULL
--          AND (SELECT COUNT(*) FROM "GroupMember" m
--               WHERE m."groupId" = g.id
--                 AND m.status IN ('ACTIVE','SUSPENDED','DEFAULTED')) >= g."minMembers"
--
-- Without these, new groups never stamp reachedMinimumAt and every
-- member silently falls out of entitlement when ramp-up elapses.
-- ============================================================
