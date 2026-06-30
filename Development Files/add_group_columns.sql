-- Add missing columns to Group table
-- Safe to run multiple times (IF NOT EXISTS)

ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS "branding"      TEXT;
ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS "treasurerId"   TEXT;
ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS "secretaryId"   TEXT;
ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS "city"          TEXT;
ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS "zipCode"       TEXT;

-- Confirm
SELECT 
  column_name, data_type
FROM information_schema.columns
WHERE table_name = 'Group'
  AND column_name IN ('branding','treasurerId','secretaryId','city','zipCode')
ORDER BY column_name;
