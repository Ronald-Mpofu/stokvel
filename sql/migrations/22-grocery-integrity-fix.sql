-- ============================================================
-- sql/22-grocery-integrity-fix.sql
--
-- Fixes three faults confirmed by sql/21-grocery-integrity-check.sql
-- and by a pg_trigger scan that returned no rows.
--
-- 1. "GroceryContribution"."amountPayable" is a column DEFAULT, not a
--    generated column, and no trigger maintains it. Defaults evaluate
--    once at INSERT. The route reads this column in preference to
--    recomputing — for the roll-call pot, the settlement solve and
--    MARK_PERIOD_PAID — so once SET_PERIOD_BUDGET writes an "amountDue"
--    that differs from the insert-time value, every one of those reads
--    is wrong. Drift is 0.00 across all 173 rows today, so the column
--    can be replaced without losing anything.
--
-- 2. "GroceryAssignment" is UNIQUE ("itemId","userId") with no
--    "periodNumber". ASSIGN_ITEM upserts on that key and the DO UPDATE
--    branch sets "periodNumber" = EXCLUDED."periodNumber" and clears
--    "actualSpent"/"acquittedAt". Assigning the same item to the same
--    member in a later period therefore drags the earlier row forward
--    and erases its acquittal, leaving the GroceryCarryForward row it
--    produced pointing at a purchase record that no longer says it
--    happened. The next acquittal then violates
--    "GroceryCarryForward_assignment_origin_key" with a raw 23505.
--    A grocery club repeats items every period, so this is the normal
--    path, not an edge case.
--
-- 3. Three column sets are indexed twice under different names.
--    Every duplicate is paid for on every INSERT and UPDATE.
--
-- ORDER OF PLAY — READ THIS
--   Step 2 drops the unique index that route.ts v1.12's ASSIGN_ITEM
--   names in its ON CONFLICT clause. Between this migration and the
--   deploy of route.ts v1.13, ASSIGN_ITEM will fail with "no unique or
--   exclusion constraint matching the ON CONFLICT specification".
--   That is a loud failure, not a silent one, and nothing is corrupted
--   by it — but keep the window short:
--       1. run this migration
--       2. deploy route.ts v1.13 immediately
--       3. re-run sql/21-grocery-integrity-check.sql
--
--   Run sql/13-grocery-scheme-link.sql with COMMIT first if E2 is still
--   reporting unlinked clubs. That one is independent of this file.
--
-- HOW TO RUN
--   Supabase SQL Editor. Opens a transaction and ends with ROLLBACK, so
--   the first run is a dry run — read the verification output, then
--   change the last line to COMMIT and run it again.
--
-- IDEMPOTENT
--   Guarded throughout. Running it twice changes nothing the second time.
-- ============================================================

BEGIN;

-- ── 0. Refuse to run if anyone hand-set amountPayable ─────────────────────
-- The column is about to be replaced by a computed one. If any row holds a
-- value that is NOT amountDue + carryAdjustment, that value was put there
-- deliberately and would be destroyed. Stop rather than lose it.
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
    FROM "GroceryContribution"
   WHERE "amountPayable" IS NOT NULL
     AND "amountPayable" <> ("amountDue" + "carryAdjustment");
  IF bad > 0 THEN
    RAISE EXCEPTION
      'ABORTED: % contribution row(s) hold a hand-set amountPayable. Reconcile them before running this migration; nothing has been changed.', bad;
  END IF;
END $$;

-- ── 1. amountPayable becomes a real generated column ──────────────────────
-- Postgres cannot convert an existing column to GENERATED in place, so the
-- column is dropped and re-added. Safe only because step 0 proved the value
-- is fully derivable. Both columns in the expression are NOT NULL, so the
-- result is NOT NULL for every row.
--
-- Generated columns reject explicit INSERT/UPDATE of their value. Neither
-- INSERT in route.ts names this column, so nothing breaks.
ALTER TABLE "GroceryContribution" DROP COLUMN IF EXISTS "amountPayable";

ALTER TABLE "GroceryContribution"
  ADD COLUMN "amountPayable" numeric(18,4)
  GENERATED ALWAYS AS ("amountDue" + "carryAdjustment") STORED;

-- ── 2. Assignment uniqueness gains periodNumber ───────────────────────────
-- Create the replacement before dropping the original so the table is never
-- without a uniqueness rule on this shape.
CREATE UNIQUE INDEX IF NOT EXISTS "GroceryAssignment_item_user_period_key"
  ON "GroceryAssignment" ("itemId", "userId", "periodNumber");

DROP INDEX IF EXISTS "GroceryAssignment_itemId_userId_key";

-- ── 3. Duplicate indexes ──────────────────────────────────────────────────
-- Each pair below indexes an identical column set. The retained name is the
-- one shared across GroceryAssignment, GroceryContribution and GroceryCycle,
-- so the surviving convention is consistent.
DROP INDEX IF EXISTS "GroceryAssignment_clubId_period_idx";   -- = club_period_idx
DROP INDEX IF EXISTS "GroceryAssignment_clubId_status_idx";   -- = club_status_idx
DROP INDEX IF EXISTS "GroceryContribution_clubId_period_idx"; -- = club_period_idx

-- "GroceryCycle_club_period_idx" duplicates the UNIQUE constraint
-- "GroceryCycle_clubId_period_key", which serves the same lookups.
DROP INDEX IF EXISTS "GroceryCycle_club_period_idx";

-- ============================================================
-- VERIFICATION — read this before committing
-- ============================================================

-- A. amountPayable is now generated, and still agrees with every row.
SELECT 'A_GENERATED' AS check,
       a.attgenerated = 's'                       AS is_stored_generated,
       (SELECT count(*) FROM "GroceryContribution"
         WHERE "amountPayable" <> ("amountDue" + "carryAdjustment"))::text
                                                  AS rows_disagreeing
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
 WHERE c.relname = 'GroceryContribution'
   AND a.attname = 'amountPayable';

-- B. Assignment uniqueness. Expect exactly one row, three columns.
SELECT 'B_ASSIGN_UNIQUE' AS check, i.relname AS index_name,
       pg_get_indexdef(i.oid) AS definition
  FROM pg_class i
  JOIN pg_index x  ON x.indexrelid = i.oid
  JOIN pg_class t  ON t.oid = x.indrelid
 WHERE t.relname = 'GroceryAssignment'
   AND x.indisunique;

-- C. Duplicate column sets remaining. Expect zero rows.
SELECT 'C_DUPLICATE_INDEXES' AS check, t.relname AS table_name,
       count(*) AS index_count
  FROM pg_index i
  JOIN pg_class t  ON t.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
 WHERE n.nspname = 'public'
   AND t.relname LIKE 'Grocery%'
   AND NOT i.indisprimary
   AND NOT i.indisunique
 GROUP BY t.relname, i.indkey::text
HAVING count(*) > 1;

-- D. Nothing was lost. Expect 173 (or whatever 21 last reported).
SELECT 'D_ROWCOUNT' AS check, count(*) AS contributions
  FROM "GroceryContribution";

-- ============================================================
-- A must show is_stored_generated = true and rows_disagreeing = 0.
-- B must name "GroceryAssignment_item_user_period_key" and nothing else.
-- C must return zero rows.
-- Then change this to COMMIT and run again.
-- ============================================================
ROLLBACK;
