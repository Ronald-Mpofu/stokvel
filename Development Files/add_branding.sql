-- Add branding field to Group table
ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS "branding" TEXT;
SELECT 'branding column added' AS status;
