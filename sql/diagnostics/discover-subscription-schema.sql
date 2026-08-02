-- ============================================================
-- discover-subscription-schema.sql
-- READ ONLY. Locates whatever table currently holds group
-- subscription state, so GROUP_SUBSCRIPTION_PREDICATE in
-- src/lib/entitlement/index.ts can be wired against real column
-- names rather than guessed ones.
--
-- Run all three. Paste the output back and I will wire row 4.
-- ============================================================


-- ── 1. Candidate tables ──────────────────────────────────────
-- Anything whose name suggests subscription, billing, plan, tier
-- or Stripe involvement.
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND (
       table_name ILIKE '%subscription%'
    OR table_name ILIKE '%billing%'
    OR table_name ILIKE '%plan%'
    OR table_name ILIKE '%stripe%'
    OR table_name ILIKE '%charge%'
    OR table_name ILIKE '%tier%'
    OR table_name ILIKE '%invoice%'
  )
ORDER BY table_name;


-- ── 2. Columns on those tables ───────────────────────────────
-- I need: the groupId foreign key, the status column, and whichever
-- column marks the end of the paid period.
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND (
           table_name ILIKE '%subscription%'
        OR table_name ILIKE '%billing%'
        OR table_name ILIKE '%plan%'
        OR table_name ILIKE '%stripe%'
        OR table_name ILIKE '%charge%'
        OR table_name ILIKE '%tier%'
        OR table_name ILIKE '%invoice%'
      )
  )
ORDER BY table_name, ordinal_position;


-- ── 3. Fallback — subscription columns living on "Group" ─────
-- If subscription state was added directly to Group via raw SQL
-- rather than a separate table, it will show up here.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'Group'
  AND (
       column_name ILIKE '%subscription%'
    OR column_name ILIKE '%stripe%'
    OR column_name ILIKE '%billing%'
    OR column_name ILIKE '%period%'
    OR column_name ILIKE '%paid%'
    OR column_name ILIKE '%plan%'
  )
ORDER BY column_name;
