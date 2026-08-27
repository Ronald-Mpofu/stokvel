-- ============================================================
-- sql/21-grocery-integrity-check.sql
--
-- PURPOSE
--   Quantifies three faults found by reading the live schema against
--   src/app/api/grocery/route.ts v1.12. Read-only: no writes, no locks,
--   no transaction. Safe on production.
--
--   Returns one table. Read the "severity" column first.
--
--     BLOCKER  fix before the member portal is built
--     WARN     fix soon, not load-bearing today
--     INFO     context, no action
--
-- HOW TO RUN
--   Supabase SQL Editor -> paste -> Run.
-- ============================================================

WITH

-- ── A. Exact row counts. reltuples is a planner estimate and lies on
--       tables that have not been ANALYZEd since their last write.
counts AS (
  SELECT 'A1' AS id, 'INFO' AS severity, 'GroceryClub rows' AS finding,
         count(*)::text AS detail FROM "GroceryClub"
  UNION ALL SELECT 'A2','INFO','GroceryMember rows', count(*)::text FROM "GroceryMember"
  UNION ALL SELECT 'A3','INFO','GroceryContribution rows', count(*)::text FROM "GroceryContribution"
  UNION ALL SELECT 'A4','INFO','GroceryAssignment rows', count(*)::text FROM "GroceryAssignment"
  UNION ALL SELECT 'A5','INFO','GrocerySettlementTransfer rows', count(*)::text FROM "GrocerySettlementTransfer"
  UNION ALL SELECT 'A6','INFO','GroceryCarryForward rows', count(*)::text FROM "GroceryCarryForward"
),

-- ── B. BUG 1. amountPayable is a column DEFAULT, not GENERATED, so it
--       is computed once at INSERT and never again. Any row where it
--       disagrees with amountDue + carryAdjustment is stale, and the
--       roll-call pot, the settlement solve and MARK_PERIOD_PAID all
--       read it in preference to recomputing.
stale AS (
  SELECT count(*) AS n,
         COALESCE(SUM(ABS(COALESCE("amountPayable",0)
                          - ("amountDue" + "carryAdjustment"))), 0) AS drift
    FROM "GroceryContribution"
   WHERE "amountPayable" IS NULL
      OR "amountPayable" <> ("amountDue" + "carryAdjustment")
),
b AS (
  SELECT 'B1' AS id,
         CASE WHEN n > 0 THEN 'BLOCKER' ELSE 'INFO' END AS severity,
         'Contributions with stale amountPayable' AS finding,
         n::text || ' of ' || (SELECT count(*) FROM "GroceryContribution")::text
           || ' rows, total drift ' || round(drift, 2)::text AS detail
    FROM stale
),

-- ── C. BUG 2, retrospective. An acquittal writes a GroceryCarryForward
--       row and stamps acquittedAt. A carry row whose assignment has no
--       acquittedAt means the ASSIGN_ITEM upsert cleared the stamp — the
--       period-1 purchase record was overwritten by a period-2 assignment.
wiped AS (
  SELECT count(*) AS n
    FROM "GroceryCarryForward" cf
    JOIN "GroceryAssignment"   a ON a.id = cf."assignmentId"
   WHERE cf."assignmentId" IS NOT NULL
     AND cf.reason IN ('CHANGE_HELD','OUT_OF_POCKET')
     AND a."acquittedAt" IS NULL
),
c1 AS (
  SELECT 'C1' AS id,
         CASE WHEN n > 0 THEN 'BLOCKER' ELSE 'INFO' END AS severity,
         'Acquittals erased by a later assignment' AS finding,
         n::text || ' carry-forward rows orphaned from their purchase' AS detail
    FROM wiped
),

-- ── D. BUG 2, prospective. An item planned in more than one period and
--       already assigned to a member will collide on the next assignment:
--       UNIQUE (itemId,userId) has no periodNumber, so the upsert moves
--       the existing row forward instead of creating a new one.
atrisk AS (
  SELECT count(*) AS n
    FROM "GroceryAssignment" a
   WHERE (SELECT count(DISTINCT pp."periodNumber")
            FROM "GroceryPeriodPurchase" pp
           WHERE pp."itemId" = a."itemId") > 1
),
d1 AS (
  SELECT 'D1' AS id,
         CASE WHEN n > 0 THEN 'BLOCKER' ELSE 'WARN' END AS severity,
         'Assignments that will collide on reassignment' AS finding,
         n::text || ' rows whose item is planned in 2+ periods' AS detail
    FROM atrisk
),

-- ── E. BUG 3. The mobile hub reads enrolment from SchemeMember. If
--       migration 13 was never committed (it ends in ROLLBACK), active
--       grocery members have no SchemeMember row and every card reads
--       "Not enrolled".
missing AS (
  SELECT count(*) AS n
    FROM "GroceryMember" gm
    JOIN "GroceryClub"   gc ON gc.id = gm."clubId"
   WHERE gm."isActive" = true
     AND gc."schemeId" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "SchemeMember" sm
                      WHERE sm."schemeId" = gc."schemeId"
                        AND sm."userId"   = gm."userId")
),
unlinked AS (
  SELECT count(*) AS n FROM "GroceryClub" WHERE "schemeId" IS NULL
),
e AS (
  SELECT 'E1' AS id,
         CASE WHEN n > 0 THEN 'BLOCKER' ELSE 'INFO' END AS severity,
         'Active grocery members with no SchemeMember row' AS finding,
         n::text || ' members would read "Not enrolled"' AS detail
    FROM missing
  UNION ALL
  SELECT 'E2',
         CASE WHEN n > 0 THEN 'BLOCKER' ELSE 'INFO' END,
         'Grocery clubs not linked to a WindfallScheme',
         n::text || ' clubs with schemeId IS NULL'
    FROM unlinked
),

-- ── F. Redundant indexes. Migration 19 re-created composites that
--       earlier migrations had already built under a different name.
--       Every duplicate is paid for on every INSERT and UPDATE.
dupes AS (
  SELECT count(*) AS n
    FROM (
      SELECT i.indrelid, i.indkey::text, count(*) AS c
        FROM pg_index i
        JOIN pg_class t ON t.oid = i.indrelid
        JOIN pg_namespace ns ON ns.oid = t.relnamespace
       WHERE ns.nspname = 'public'
         AND t.relname LIKE 'Grocery%'
         AND NOT i.indisprimary
         AND NOT i.indisunique
       GROUP BY i.indrelid, i.indkey::text
      HAVING count(*) > 1
    ) x
),
f AS (
  SELECT 'F1' AS id,
         CASE WHEN n > 0 THEN 'WARN' ELSE 'INFO' END AS severity,
         'Duplicate index definitions on Grocery tables' AS finding,
         n::text || ' column sets indexed more than once' AS detail
    FROM dupes
)

SELECT id, severity, finding, detail
  FROM (
    SELECT * FROM b
    UNION ALL SELECT * FROM c1
    UNION ALL SELECT * FROM d1
    UNION ALL SELECT * FROM e
    UNION ALL SELECT * FROM f
    UNION ALL SELECT * FROM counts
  ) all_checks
 ORDER BY CASE severity WHEN 'BLOCKER' THEN 1 WHEN 'WARN' THEN 2 ELSE 3 END, id;
