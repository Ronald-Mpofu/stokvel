-- ============================================================
-- sql/23-grocery-comments.sql   (v2 — no transaction wrapper)
--
-- The comment / receipt-acknowledgement thread for one grocery club period.
--
-- WHY NO BEGIN/ROLLBACK THIS TIME
--   v1 used the dry-run-then-COMMIT pattern. That pattern earns its place
--   when a migration CHANGES existing data and you want to read the outcome
--   before keeping it. This one only ADDS a table that does not exist yet:
--   there is nothing to inspect and nothing to undo, and the extra step was
--   pure friction.
--
--   Every statement is IF NOT EXISTS. Run it as many times as you like.
--
-- IF YOU JUST GOT 42P01 "relation GroceryPeriodComment does not exist"
--   That error can only come from the CREATE INDEX lines, and only if the
--   CREATE TABLE above them did not run. The usual cause is that the SQL
--   Editor had text selected — it runs the SELECTION rather than the whole
--   script when one exists. Click once in the editor to clear any
--   highlight, or press Ctrl+A, before hitting Run.
--
-- WHY A TABLE RATHER THAN A COLUMN
--   "GroceryAssignment".notes already holds the buyer's own remark about one
--   purchase, and that is the right home for it — it belongs to that row and
--   dies with it. A thread is different: several people, several messages,
--   about the PERIOD rather than one item, and readable by a member who was
--   not assigned anything at all.
--
-- NOT A CHAT
--   No edit, no delete, no read receipts. Append-only, ordered by createdAt,
--   which is all the member screen renders.
--
-- OPTIONAL
--   /api/grocery/member checks for this table at cold start and omits the
--   thread until it exists. The route works either way; the member screen
--   simply hides the Messages section.
--
-- HOW TO RUN
--   Supabase SQL Editor. Paste the WHOLE file. Run once. Read the grid.
-- ============================================================

CREATE TABLE IF NOT EXISTS "GroceryPeriodComment" (
  id             text        PRIMARY KEY,
  "clubId"       text        NOT NULL,
  "periodNumber" integer     NOT NULL,
  "userId"       text        NOT NULL,
  kind           text        NOT NULL DEFAULT 'COMMENT',
  body           text        NOT NULL,
  "createdAt"    timestamp   NOT NULL DEFAULT now(),

  -- Foreign keys, unlike the older grocery tables which have none. A comment
  -- referring to a club that no longer exists is not recoverable data, and
  -- RESTRICT means a club cannot be hard-deleted out from under its thread.
  CONSTRAINT "GroceryPeriodComment_clubId_fkey"
    FOREIGN KEY ("clubId") REFERENCES "GroceryClub"(id) ON DELETE RESTRICT,
  CONSTRAINT "GroceryPeriodComment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE RESTRICT,

  CONSTRAINT "GroceryPeriodComment_kind_chk"
    CHECK (kind = ANY (ARRAY['COMMENT'::text, 'RECEIPT_ACK'::text])),
  CONSTRAINT "GroceryPeriodComment_period_chk"
    CHECK ("periodNumber" > 0),
  -- Enforced here as well as in the route. A route is one caller; the
  -- constraint holds for every caller there will ever be.
  CONSTRAINT "GroceryPeriodComment_body_chk"
    CHECK (length(btrim(body)) BETWEEN 2 AND 2000)
);

-- The only read the screen performs: one club, one period, oldest first.
CREATE INDEX IF NOT EXISTS "GroceryPeriodComment_club_period_idx"
  ON "GroceryPeriodComment" ("clubId", "periodNumber", "createdAt");

-- Supports "everything this member has said", for a future officer view.
CREATE INDEX IF NOT EXISTS "GroceryPeriodComment_user_idx"
  ON "GroceryPeriodComment" ("userId");

-- ============================================================
-- VERIFICATION — one grid, because the SQL Editor shows only the
-- last statement's result. All four rows must read PASS.
-- ============================================================
WITH checks AS (
  SELECT 'A' AS id, 'Table exists' AS check_name,
         CASE WHEN to_regclass('public."GroceryPeriodComment"') IS NOT NULL
              THEN 'PASS' ELSE 'FAIL' END AS result,
         'GroceryPeriodComment' AS detail

  UNION ALL
  SELECT 'B', 'Column set',
         CASE WHEN (
           SELECT count(*) FROM information_schema.columns
            WHERE table_schema='public' AND table_name='GroceryPeriodComment'
              AND column_name IN ('id','clubId','periodNumber','userId','kind','body','createdAt')
         ) = 7 THEN 'PASS' ELSE 'FAIL' END,
         '7 columns expected'

  UNION ALL
  SELECT 'C', 'Foreign keys present',
         CASE WHEN (
           SELECT count(*) FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
            WHERE t.relname='GroceryPeriodComment' AND c.contype='f'
         ) = 2 THEN 'PASS' ELSE 'FAIL' END,
         'club and user'

  UNION ALL
  SELECT 'D', 'Read index present',
         CASE WHEN to_regclass('public."GroceryPeriodComment_club_period_idx"') IS NOT NULL
              THEN 'PASS' ELSE 'FAIL' END,
         'clubId, periodNumber, createdAt'
)
SELECT id, check_name, result, detail FROM checks ORDER BY id;
