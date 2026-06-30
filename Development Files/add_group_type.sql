-- Migration: add groupType column to Group table
-- Run once against your Supabase/PostgreSQL database

-- 1. Add the column (TEXT, default PRIVATE so existing rows are safe)
ALTER TABLE "Group"
  ADD COLUMN IF NOT EXISTS "groupType" TEXT NOT NULL DEFAULT 'PRIVATE';

-- 2. Add a check constraint so only valid values are accepted
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Group_groupType_check'
      AND table_name = 'Group'
  ) THEN
    ALTER TABLE "Group"
      ADD CONSTRAINT "Group_groupType_check"
        CHECK ("groupType" IN ('PRIVATE', 'PUBLIC'));
  END IF;
END$$;

-- 3. Confirmation
SELECT
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'Group'
  AND column_name = 'groupType';
