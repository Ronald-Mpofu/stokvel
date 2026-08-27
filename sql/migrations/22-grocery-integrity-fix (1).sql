-- ============================================================
-- sql/22-grocery-integrity-fix.sql   (v2 — supersedes the first draft)
--
-- WHAT CHANGED SINCE v1
--   v1 tried to convert "GroceryContribution"."amountPayable" from a
--   column DEFAULT into a generated column. That was WRONG. The column is
--   ALREADY GENERATED ALWAYS AS ("amountDue" + "carryAdjustment") STORED.
--
--   The mistake came from sql/20-introspect-grocery.sql, which rendered
--   columns using pg_get_expr(pg_attrdef...) without also reading
--   pg_attribute.attgenerated. Postgres stores a generated column's
--   expression in pg_attrdef, the same place as a DEFAULT, so a generated
--   column printed as "DEFAULT (expr)" and looked like an unmaintained
--   default. Postgres does not permit column references in a real DEFAULT
--   at all, which is the tell. "GroceryPeriodPurchase"."lineTotal" is
--   generated for the same reason.
--
--   Nothing was wrong with amountPayable. That half of v1 is deleted.
--
-- WHAT THIS MIGRATION ACTUALLY FIXES
--
-- 1. "GroceryAssignment" is UNIQUE ("itemId","userId") with no
--    "periodNumber". ASSIGN_ITEM upserts on that key, and the DO UPDATE
--    branch sets "periodNumber" = EXCLUDED."periodNumber" and clears
--    "actualSpent"/"acquittedAt".
--
--    Reproduced against PostgreSQL 16 on a copy of this schema: assigning
--    an item to a member who already held it in an earlier period does not
--    insert a second row. It rewrites the FIRST one — same id, now claiming
--    the later period, acquittal erased — while the GroceryCarryForward row
--    that acquittal produced stays behind still referencing it. The next
--    acquittal then fails with
--        ERROR: duplicate key value violates unique constraint
--               "GroceryCarryForward_assignment_origin_key"
--    A grocery club repeats items every period, so this is the normal path
--    from period 2 onward.
--
-- 2. Three column sets are indexed twice under different names, and
--    "GroceryCycle_club_period_idx" duplicates a unique index. Each is paid
--    for on every INSERT and UPDATE.
--
-- ORDER OF PLAY
--   Step 1 drops the index that route.ts v1.12 names in its ON CONFLICT
--   clause. Between this migration and the deploy of route.ts v1.14,
--   ASSIGN_ITEM fails with "no unique or exclusion constraint matching the
--   ON CONFLICT specification" — loud, and nothing is corrupted by it, but
--   keep the window short:
--       1. run this migration
--       2. deploy route.ts v1.14 immediately
--       3. re-run sql/21-grocery-integrity-check.sql
--
--   Run sql/13-grocery-scheme-link.sql with COMMIT first if E2 still
--   reports unlinked clubs. That is independent of this file.
--
-- HOW TO RUN
--   Supabase SQL Editor. Opens a transaction and ends with ROLLBACK, so the
--   first run is a dry run. Read the verification grid, then change the
--   last line to COMMIT and run again.
--
-- IDEMPOTENT
--   Every statement is guarded. Running it twice is a no-op.
-- ============================================================

BEGIN;

-- ── 0. Assert the schema is the one this migration was written against ────
-- If amountPayable is NOT generated, the introspection was wrong a second
-- time and this migration should not be trusted. Stop rather than guess.
DO $$
DECLARE gen char;
BEGIN
  SELECT a.attgenerated INTO gen
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
   WHERE c.relname = 'GroceryContribution' AND a.attname = 'amountPayable';

  IF gen IS NULL THEN
    RAISE EXCEPTION 'ABORTED: GroceryContribution.amountPayable not found.';
  ELSIF gen <> 's' THEN
    RAISE EXCEPTION
      'ABORTED: amountPayable is not a STORED generated column (attgenerated=%). Re-check the schema before running this. Nothing has been changed.', gen;
  END IF;
END $$;

-- ── 1. Assignment uniqueness gains periodNumber ───────────────────────────
-- Created before the old one is dropped, so the table is never without a
-- uniqueness rule on this shape.
CREATE UNIQUE INDEX IF NOT EXISTS "GroceryAssignment_item_user_period_key"
  ON "GroceryAssignment" ("itemId", "userId", "periodNumber");

DROP INDEX IF EXISTS "GroceryAssignment_itemId_userId_key";

-- ── 2. Duplicate indexes ──────────────────────────────────────────────────
-- Each pair indexes an identical column set. The retained name is the one
-- shared across the grocery tables, so the surviving convention is uniform.
DROP INDEX IF EXISTS "GroceryAssignment_clubId_period_idx";   -- = club_period_idx
DROP INDEX IF EXISTS "GroceryAssignment_clubId_status_idx";   -- = club_status_idx
DROP INDEX IF EXISTS "GroceryContribution_clubId_period_idx"; -- = club_period_idx

-- Duplicates the UNIQUE index "GroceryCycle_clubId_period_key", which serves
-- the same lookups.
DROP INDEX IF EXISTS "GroceryCycle_club_period_idx";

-- ============================================================
-- VERIFICATION — one grid, because the SQL Editor shows only the
-- last statement's result. Every row must read PASS.
-- ============================================================
WITH checks AS (

  -- A. The period-scoped unique index exists and covers three columns.
  SELECT 'A' AS id, 'Assignment unique index is period-scoped' AS check_name,
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_index x
             JOIN pg_class i ON i.oid = x.indexrelid
             JOIN pg_class t ON t.oid = x.indrelid
            WHERE t.relname = 'GroceryAssignment'
              AND i.relname = 'GroceryAssignment_item_user_period_key'
              AND x.indnatts = 3
         ) THEN 'PASS' ELSE 'FAIL' END AS result,
         COALESCE((SELECT string_agg(i.relname, ', ')
                     FROM pg_index x
                     JOIN pg_class i ON i.oid = x.indexrelid
                     JOIN pg_class t ON t.oid = x.indrelid
                    WHERE t.relname = 'GroceryAssignment' AND x.indisunique),
                  '(none)') AS detail

  -- B. The old two-column index is gone.
  UNION ALL
  SELECT 'B', 'Old (itemId,userId) index removed',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM pg_class
            WHERE relname = 'GroceryAssignment_itemId_userId_key'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'must not exist'

  -- C. No duplicate non-unique column sets remain on Grocery tables.
  UNION ALL
  SELECT 'C', 'Duplicate indexes removed',
         CASE WHEN (SELECT count(*) FROM (
                      SELECT i.indrelid, i.indkey::text
                        FROM pg_index i
                        JOIN pg_class t ON t.oid = i.indrelid
                        JOIN pg_namespace n ON n.oid = t.relnamespace
                       WHERE n.nspname = 'public'
                         AND t.relname LIKE 'Grocery%'
                         AND NOT i.indisprimary AND NOT i.indisunique
                       GROUP BY i.indrelid, i.indkey::text
                      HAVING count(*) > 1) d) = 0
              THEN 'PASS' ELSE 'FAIL' END,
         'expect zero duplicated column sets'

  -- D. amountPayable untouched by this migration and still generated.
  UNION ALL
  SELECT 'D', 'amountPayable still GENERATED STORED',
         CASE WHEN (SELECT a.attgenerated FROM pg_attribute a
                      JOIN pg_class c ON c.oid = a.attrelid
                     WHERE c.relname = 'GroceryContribution'
                       AND a.attname = 'amountPayable') = 's'
              THEN 'PASS' ELSE 'FAIL' END,
         'not modified by this migration'

  -- E. No rows lost. Nothing here writes to a table, so this must hold.
  UNION ALL
  SELECT 'E', 'Contribution rows intact',
         CASE WHEN (SELECT count(*) FROM "GroceryContribution") > 0
              THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*)::text || ' rows' FROM "GroceryContribution")
)
SELECT id, check_name, result, detail FROM checks ORDER BY id;

-- ============================================================
-- All five rows must read PASS. Then change this to COMMIT and run again.
-- ============================================================
ROLLBACK;
