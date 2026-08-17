-- ============================================================
-- sql/13-grocery-scheme-link.sql
--
-- Repairs the link between the Grocery Club module tables and the
-- WindfallScheme registry. This is the same class of fault that was
-- repaired for Savings Pools in migration 12.
--
-- WHAT IS BROKEN
--   /api/grocery has never written GroceryClub."schemeId" — the column is
--   nullable with no default and was absent from the INSERT column list.
--   It has also never written "SchemeMember" rows; membership was only
--   recorded in "GroceryMember".
--
--   The mobile hub decides enrolment from "SchemeMember", so the Grocery
--   Club card reads "Not enrolled / Ask your admin" for every member of
--   every group — including the admin who created the club.
--
--   "WindfallScheme"."isContributory" also defaults to false, which would
--   push the card to "No passbook" even once enrolment is fixed.
--
-- ORDER OF PLAY
--   Run this BEFORE deploying src/app/api/grocery/route.ts v1.2. The route
--   change stops the fault recurring; this migration repairs existing rows.
--
-- HOW TO RUN
--   Supabase SQL Editor. The script opens a transaction and ends with
--   ROLLBACK so the first run is a dry run — read the verification output,
--   then change the last line to COMMIT and run it again.
--
-- IDEMPOTENT
--   Every statement is guarded (ON CONFLICT, or a NULL/false predicate).
--   Running it twice changes nothing the second time.
-- ============================================================

BEGIN;

-- ── 1. Every group holding a grocery club needs a GROCERY_CLUB scheme row ──
-- WindfallScheme has UNIQUE ("groupId","schemeType"), so ON CONFLICT is the
-- correct guard and a plain unique index matches it.
INSERT INTO "WindfallScheme"
  (id, "groupId", "schemeType", name, description, status,
   "isContributory", "isRotating", "createdAt", "updatedAt")
SELECT (gen_random_uuid())::text,
       g.id,
       'GROCERY_CLUB'::"WindfallSchemeType",
       'Grocery Club',
       'Bulk grocery buying for members',
       'ACTIVE'::"WindfallSchemeStatus",
       true,    -- contributory: members pay in on a schedule
       false,   -- not rotating: no payout order, everyone receives goods
       NOW(), NOW()
  FROM "Group" g
 WHERE g."deletedAt" IS NULL
   AND EXISTS (SELECT 1 FROM "GroceryClub" gc WHERE gc."groupId" = g.id)
ON CONFLICT ("groupId", "schemeType") DO NOTHING;

-- ── 2. Point every orphaned club at its group's scheme row ────────────────
UPDATE "GroceryClub" gc
   SET "schemeId"  = ws.id,
       "updatedAt" = NOW()
  FROM "WindfallScheme" ws
 WHERE ws."groupId"    = gc."groupId"
   AND ws."schemeType" = 'GROCERY_CLUB'::"WindfallSchemeType"
   AND gc."schemeId" IS NULL;

-- ── 3. Mark those schemes contributory ────────────────────────────────────
-- Only where a club actually exists. A group that has never run a grocery
-- club keeps isContributory = false and correctly reads "No passbook".
UPDATE "WindfallScheme" ws
   SET "isContributory" = true,
       "updatedAt"      = NOW()
 WHERE ws."schemeType"     = 'GROCERY_CLUB'::"WindfallSchemeType"
   AND ws."isContributory" = false
   AND EXISTS (SELECT 1 FROM "GroceryClub" gc WHERE gc."schemeId" = ws.id);

-- ── 4. Backfill SchemeMember from GroceryMember ───────────────────────────
-- A member may sit in several clubs under the same scheme; SchemeMember is
-- UNIQUE ("schemeId","userId") and holds one row per scheme, so the
-- DISTINCT plus ON CONFLICT collapses them. joinedAt takes the earliest
-- club join so seniority survives the backfill.
INSERT INTO "SchemeMember"
  (id, "schemeId", "userId", status, "joinedAt", "createdAt", "updatedAt")
SELECT (gen_random_uuid())::text,
       src."schemeId",
       src."userId",
       'ACTIVE'::"MemberStatus",
       src."joinedAt",
       NOW(), NOW()
  FROM (
        SELECT gc."schemeId"            AS "schemeId",
               gm."userId"              AS "userId",
               MIN(gm."createdAt")      AS "joinedAt"
          FROM "GroceryMember" gm
          JOIN "GroceryClub"   gc ON gc.id = gm."clubId"
         WHERE gc."schemeId" IS NOT NULL
           AND gm."isActive" = true
         GROUP BY gc."schemeId", gm."userId"
       ) src
ON CONFLICT ("schemeId", "userId") DO NOTHING;

-- ============================================================
-- VERIFICATION — read this before committing
-- ============================================================

-- A. Clubs still unlinked. Expect zero rows.
SELECT 'A_UNLINKED_CLUBS' AS check, gc.id, gc.name, gc."groupId"
  FROM "GroceryClub" gc
 WHERE gc."schemeId" IS NULL;

-- B. Grocery schemes that hold a club but are not contributory. Expect zero.
SELECT 'B_NOT_CONTRIBUTORY' AS check, ws.id, ws."groupId"
  FROM "WindfallScheme" ws
 WHERE ws."schemeType" = 'GROCERY_CLUB'::"WindfallSchemeType"
   AND ws."isContributory" = false
   AND EXISTS (SELECT 1 FROM "GroceryClub" gc WHERE gc."schemeId" = ws.id);

-- C. Grocery members with no matching SchemeMember row. Expect zero rows.
SELECT 'C_MISSING_SCHEMEMEMBER' AS check,
       gm."userId", gc."schemeId", gc.name AS "clubName"
  FROM "GroceryMember" gm
  JOIN "GroceryClub"   gc ON gc.id = gm."clubId"
 WHERE gm."isActive" = true
   AND gc."schemeId" IS NOT NULL
   AND NOT EXISTS (
         SELECT 1 FROM "SchemeMember" sm
          WHERE sm."schemeId" = gc."schemeId"
            AND sm."userId"   = gm."userId"
       );

-- D. Summary per group — what the hub will now show on the Grocery card.
SELECT 'D_SUMMARY' AS check,
       g.name                                   AS "group",
       ws."isContributory",
       count(DISTINCT gc.id)                    AS clubs,
       count(DISTINCT sm."userId")              AS "schemeMembers"
  FROM "WindfallScheme" ws
  JOIN "Group" g          ON g.id  = ws."groupId"
  LEFT JOIN "GroceryClub" gc ON gc."schemeId" = ws.id
  LEFT JOIN "SchemeMember" sm ON sm."schemeId" = ws.id
                             AND sm.status <> 'EXITED'::"MemberStatus"
 WHERE ws."schemeType" = 'GROCERY_CLUB'::"WindfallSchemeType"
 GROUP BY g.name, ws."isContributory"
 ORDER BY g.name;

-- ============================================================
-- Checks A, B and C must all return zero rows. Then change this to COMMIT.
-- ============================================================
ROLLBACK;
