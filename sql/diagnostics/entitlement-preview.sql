-- ============================================================
-- entitlement-preview.sql  (v2 — corrected)
-- READ ONLY. No writes, no DDL. Safe to run any number of times.
--
-- v1 BUG: a single WITH block was followed by two SELECT statements.
-- A CTE is scoped to ONE statement, so the second SELECT failed with
-- 'relation "resolved" does not exist'. Each query below now carries
-- its own CTE block and is independently runnable — you can highlight
-- and run either one on its own.
--
-- Previews what src/lib/entitlement/index.ts WOULD resolve for every
-- user, before that file is deployed. Mirrors the resolver exactly:
-- same MemberStatus set, same GroupStatus set, same 60-day ramp-up,
-- same three entitlement sources.
--
-- Row 4 of the truth table (group subscription) is NOT applied here,
-- for the same reason it is not applied in the resolver — the table
-- has not been wired yet. Both over-report entitlement by the same
-- amount, so the two stay in agreement.
--
-- Run AFTER both 2026-08-01 migrations.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- QUERY A — Summary
-- ════════════════════════════════════════════════════════════
WITH cm AS (
  SELECT "userId", "status", "expiresAt"
  FROM "CommunityMembership"
),
grp AS (
  SELECT DISTINCT gm."userId"
  FROM "GroupMember" gm
  JOIN "Group" g ON g."id" = gm."groupId"
  WHERE gm."status" IN (
          'ACTIVE'::"MemberStatus", 'SUSPENDED'::"MemberStatus", 'DEFAULTED'::"MemberStatus"
        )
    AND g."status" IN (
          'ACTIVE'::"GroupStatus", 'PAUSED'::"GroupStatus", 'COMPLETED'::"GroupStatus"
        )
    AND g."deletedAt" IS NULL
    AND (
      g."reachedMinimumAt" IS NOT NULL
      OR (g."activatedAt" IS NOT NULL AND g."activatedAt" > now() - interval '60 days')
    )
),
resolved AS (
  SELECT
    u."id",
    u."email",
    u."role"::text   AS role,
    u."status"::text AS user_status,
    (u."role"::text IN ('SYSTEM_ADMIN','NATIONAL_ADMIN','AUDITOR'))    AS is_staff,
    COALESCE(cm."status" = 'ACTIVE' AND cm."expiresAt" > now(), false) AS cm_active,
    (grp."userId" IS NOT NULL)                                        AS has_qualifying_group,
    cm."status"                                                       AS cm_status,
    cm."expiresAt"                                                    AS cm_expires_at
  FROM "User" u
  LEFT JOIN cm  ON cm."userId"  = u."id"
  LEFT JOIN grp ON grp."userId" = u."id"
  WHERE u."deletedAt" IS NULL
)
SELECT
  COUNT(*)                                                                   AS users,
  COUNT(*) FILTER (WHERE is_staff OR cm_active OR has_qualifying_group)       AS entitled,
  COUNT(*) FILTER (WHERE NOT (is_staff OR cm_active OR has_qualifying_group)) AS would_be_blocked,
  COUNT(*) FILTER (WHERE is_staff)                                           AS via_staff_role,
  COUNT(*) FILTER (WHERE cm_active)                                          AS via_community_membership,
  COUNT(*) FILTER (WHERE has_qualifying_group)                               AS via_qualifying_group,
  COUNT(*) FILTER (WHERE cm_active AND has_qualifying_group)                 AS both_sources
FROM resolved;


-- ════════════════════════════════════════════════════════════
-- QUERY B — Every user the resolver would flag
--
-- Read this list. If it contains anyone you did not expect, the truth
-- table is wrong and this is the cheapest possible time to find out.
-- ════════════════════════════════════════════════════════════
WITH cm AS (
  SELECT "userId", "status", "expiresAt"
  FROM "CommunityMembership"
),
grp AS (
  SELECT DISTINCT gm."userId"
  FROM "GroupMember" gm
  JOIN "Group" g ON g."id" = gm."groupId"
  WHERE gm."status" IN (
          'ACTIVE'::"MemberStatus", 'SUSPENDED'::"MemberStatus", 'DEFAULTED'::"MemberStatus"
        )
    AND g."status" IN (
          'ACTIVE'::"GroupStatus", 'PAUSED'::"GroupStatus", 'COMPLETED'::"GroupStatus"
        )
    AND g."deletedAt" IS NULL
    AND (
      g."reachedMinimumAt" IS NOT NULL
      OR (g."activatedAt" IS NOT NULL AND g."activatedAt" > now() - interval '60 days')
    )
),
resolved AS (
  SELECT
    u."id",
    u."email",
    u."role"::text   AS role,
    u."status"::text AS user_status,
    (u."role"::text IN ('SYSTEM_ADMIN','NATIONAL_ADMIN','AUDITOR'))    AS is_staff,
    COALESCE(cm."status" = 'ACTIVE' AND cm."expiresAt" > now(), false) AS cm_active,
    (grp."userId" IS NOT NULL)                                        AS has_qualifying_group,
    cm."status"                                                       AS cm_status,
    cm."expiresAt"                                                    AS cm_expires_at
  FROM "User" u
  LEFT JOIN cm  ON cm."userId"  = u."id"
  LEFT JOIN grp ON grp."userId" = u."id"
  WHERE u."deletedAt" IS NULL
)
SELECT
  "email",
  role,
  user_status,
  COALESCE(cm_status, '—')  AS community_membership,
  cm_expires_at,
  has_qualifying_group,
  CASE
    WHEN cm_status IS NULL       THEN 'No Community Membership, no qualifying group'
    WHEN cm_status = 'SUSPENDED' THEN 'Opted out of Community Membership, no qualifying group'
    ELSE                              'Community Membership lapsed, no qualifying group'
  END                       AS why
FROM resolved
WHERE NOT (is_staff OR cm_active OR has_qualifying_group)
ORDER BY role, "email";
