-- ============================================================
-- Windfall — Add currency column to PoolMember table
-- ============================================================

ALTER TABLE "PoolMember"
  ADD COLUMN IF NOT EXISTS "currency" TEXT;

-- Confirm
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'PoolMember'
  AND column_name IN ('currency', 'paymentMethod')
ORDER BY column_name;
