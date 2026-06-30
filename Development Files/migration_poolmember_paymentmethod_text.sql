-- ============================================================
-- Windfall — Fix PoolMember.paymentMethod: enum → TEXT
-- The PaymentMethod enum only has 5 values but RefPaymentMethod
-- has 100+ (ECOCASH, MPESA, AFTERPAY, etc.).
-- Convert the column to TEXT so any code from RefPaymentMethod works.
-- ============================================================

-- 1. Drop the enum constraint by converting the column to TEXT
ALTER TABLE "PoolMember"
  ALTER COLUMN "paymentMethod" TYPE TEXT
  USING "paymentMethod"::TEXT;

-- 2. Keep a sensible default (plain text now)
ALTER TABLE "PoolMember"
  ALTER COLUMN "paymentMethod" SET DEFAULT 'CASH';

-- 3. Confirm
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'PoolMember'
  AND column_name = 'paymentMethod';
