-- ============================================================
-- Repair: orphaned SavingsPool rows and missing SchemeMember rows
-- ============================================================
--
-- SYMPTOM
--   A group admin opens a Windfall Scheme and is told they are not
--   enrolled, or that no savings pool exists — while the pool plainly
--   exists and they are plainly in it.
--
-- CAUSE
--   Three independent gaps, each invisible on its own:
--
--   1. SavingsPool."schemeId" is NULL. Migration 12 added that column so
--      a scheme resolves to its pool directly rather than by sharing a
--      groupId. The pool creation route never populated it, so
--      /api/schemes/passbook counts zero pools for the scheme and
--      returns NO_POOL.
--
--   2. WindfallScheme."isContributory" is false. /api/groups/schemes
--      drops the card to NO_LEDGER on that flag, so it never becomes
--      tappable regardless of enrolment.
--
--   3. No SchemeMember rows. Enrolment is tracked in two unrelated
--      tables: the hub card gates on SchemeMember, the passbook gates on
--      SavingsPoolMember. The pool route writes the second and not the
--      first, so members exist in the pool and not in the registry.
--
-- SCOPE
--   Every group, not just the one that surfaced this. The pool creation
--   route has been writing rows this way for as long as the column has
--   existed.
--
-- IDEMPOTENT
--   Every statement is guarded. Re-running changes nothing.
--
-- ORDER MATTERS
--   Step 1 must run before steps 2 and 3 — both resolve the scheme
--   through SavingsPool."schemeId", which step 1 is what populates.
-- ============================================================


-- ── Step 0: what is broken, before anything changes ──────────
-- Run this first on its own if you want to see the blast radius.

SELECT
  (SELECT count(*) FROM "SavingsPool" WHERE "schemeId" IS NULL)          AS orphaned_pools,
  (SELECT count(*) FROM "WindfallScheme" ws
    WHERE ws."schemeType" = 'SAVINGS_POOL'::"WindfallSchemeType"
      AND ws."isContributory" = false
      AND EXISTS (SELECT 1 FROM "SavingsPool" sp WHERE sp."groupId" = ws."groupId"))
                                                                          AS schemes_not_contributory,
  (SELECT count(*) FROM "SavingsPoolMember" m
     JOIN "SavingsPool" sp ON sp.id = m."poolId"
     JOIN "WindfallScheme" ws
       ON ws."groupId" = sp."groupId"
      AND ws."schemeType" = 'SAVINGS_POOL'::"WindfallSchemeType"
    WHERE NOT EXISTS (
      SELECT 1 FROM "SchemeMember" sm
       WHERE sm."schemeId" = ws.id AND sm."userId" = m."userId"))
                                                                          AS missing_scheme_members;


-- ── Step 1: link every orphaned pool to its registry row ─────
-- One SAVINGS_POOL scheme exists per group, so the mapping is
-- unambiguous even where a group runs several pools. Multiple pools
-- under one scheme is a supported shape — the passbook route asks the
-- caller to choose via its MULTIPLE_POOLS branch.

UPDATE "SavingsPool" sp
   SET "schemeId" = ws.id
  FROM "WindfallScheme" ws
 WHERE ws."groupId"    = sp."groupId"
   AND ws."schemeType" = 'SAVINGS_POOL'::"WindfallSchemeType"
   AND sp."schemeId"  IS NULL;


-- ── Step 2: mark schemes that actually carry a schedule ──────
-- Only schemes with a pool behind them. A group that has never created
-- a pool keeps the flag false, which is the honest state — its card
-- should read "no contribution schedule", because it has none.

UPDATE "WindfallScheme" ws
   SET "isContributory" = true
 WHERE ws."schemeType"     = 'SAVINGS_POOL'::"WindfallSchemeType"
   AND ws."isContributory" = false
   AND EXISTS (SELECT 1 FROM "SavingsPool" sp WHERE sp."schemeId" = ws.id);


-- ── Step 3: backfill SchemeMember from SavingsPoolMember ─────
-- NOT EXISTS rather than ON CONFLICT: this does not assume a unique
-- index on (schemeId, userId), and stays correct whether or not one is
-- present.
--
-- DISTINCT ON collapses a member who sits in two pools under the same
-- scheme down to a single registry row, keeping the earliest join date.
-- Without it, that member would get two SchemeMember rows and the hub's
-- LEFT JOIN would duplicate their card.
--
-- Status is derived, not assumed ACTIVE — a member who has left the
-- pool should not reappear as enrolled in the registry.
-- addedById is left NULL: nobody added these rows, a migration did, and
-- recording a false actor is worse than recording none.

INSERT INTO "SchemeMember" ("schemeId", "userId", "status", "joinedAt", "exitedAt")
SELECT DISTINCT ON (sp."schemeId", m."userId")
       sp."schemeId",
       m."userId",
       (CASE
          WHEN m."isActive" = true AND m."exitedAt" IS NULL THEN 'ACTIVE'
          ELSE 'EXITED'
        END)::"MemberStatus",
       m."joinedAt",
       m."exitedAt"
  FROM "SavingsPoolMember" m
  JOIN "SavingsPool" sp ON sp.id = m."poolId"
 WHERE sp."schemeId" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "SchemeMember" sm
      WHERE sm."schemeId" = sp."schemeId"
        AND sm."userId"   = m."userId"
   )
 ORDER BY sp."schemeId", m."userId", m."joinedAt";


-- ── Confirmation ─────────────────────────────────────────────
-- All three counts must read 0. Anything else means a step did not
-- apply and the hub will still gate the card.

SELECT
  (SELECT count(*) FROM "SavingsPool" WHERE "schemeId" IS NULL)          AS orphaned_pools_remaining,
  (SELECT count(*) FROM "WindfallScheme" ws
    WHERE ws."schemeType" = 'SAVINGS_POOL'::"WindfallSchemeType"
      AND ws."isContributory" = false
      AND EXISTS (SELECT 1 FROM "SavingsPool" sp WHERE sp."schemeId" = ws.id))
                                                                          AS schemes_not_contributory_remaining,
  (SELECT count(*) FROM "SavingsPoolMember" m
     JOIN "SavingsPool" sp ON sp.id = m."poolId"
    WHERE sp."schemeId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "SchemeMember" sm
         WHERE sm."schemeId" = sp."schemeId" AND sm."userId" = m."userId"))
                                                                          AS missing_scheme_members_remaining;


-- ── Per-group view of the repaired state ─────────────────────
-- Mining PPE should now show 5 pool members and 5 scheme members.

SELECT g.name                                   AS group_name,
       sp.name                                  AS pool_name,
       sp."schemeId",
       ws."isContributory",
       (SELECT count(*) FROM "SavingsPoolMember" m
         WHERE m."poolId" = sp.id AND m."isActive" = true)   AS pool_members,
       (SELECT count(*) FROM "SchemeMember" sm
         WHERE sm."schemeId" = ws.id
           AND sm.status <> 'EXITED'::"MemberStatus")        AS scheme_members
  FROM "SavingsPool" sp
  JOIN "Group" g          ON g.id  = sp."groupId"
  LEFT JOIN "WindfallScheme" ws ON ws.id = sp."schemeId"
 ORDER BY g.name, sp.name;
