-- ============================================================
-- Windfall Community Deals — Membership Enhancement Migration
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. MemberType enum (GROUP_MEMBER vs POOL_MEMBER)
DO $$ BEGIN
  CREATE TYPE "MemberType" AS ENUM ('GROUP_MEMBER', 'POOL_MEMBER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. JoiningFeeStatus enum
DO $$ BEGIN
  CREATE TYPE "JoiningFeeStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'WAIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. PaymentMethod enum
DO $$ BEGIN
  CREATE TYPE "PaymentMethod" AS ENUM ('CREDIT_CARD', 'DEBIT_CARD', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CASH');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4. PoolMemberStatus enum
DO $$ BEGIN
  CREATE TYPE "PoolMemberStatus" AS ENUM ('ACTIVE', 'PENDING', 'SUSPENDED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 5. Pool Members table — members who joined via website/open invite (no group)
CREATE TABLE IF NOT EXISTS "PoolMember" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "firstName"         TEXT NOT NULL,
  "lastName"          TEXT NOT NULL,
  "email"             TEXT NOT NULL UNIQUE,
  "phone"             TEXT,
  "country"           TEXT NOT NULL DEFAULT 'ZA',
  "status"            "PoolMemberStatus" NOT NULL DEFAULT 'PENDING'::"PoolMemberStatus",
  "joiningFeeStatus"  "JoiningFeeStatus" NOT NULL DEFAULT 'PENDING'::"JoiningFeeStatus",
  "joiningFeePaid"    BOOLEAN NOT NULL DEFAULT FALSE,
  "joiningFeeAmount"  DECIMAL(10,2),
  "joiningFeeExpiry"  TIMESTAMPTZ,           -- 12 months from payment date
  "joiningFeePaidAt"  TIMESTAMPTZ,
  "paymentMethod"     "PaymentMethod" NOT NULL DEFAULT 'CREDIT_CARD'::"PaymentMethod",
  "profileImageUrl"   TEXT,
  "notes"             TEXT,
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Add memberType to existing GroupMember table (raw SQL — not in Prisma schema)
ALTER TABLE "GroupMember"
  ADD COLUMN IF NOT EXISTS "memberType" "MemberType" NOT NULL DEFAULT 'GROUP_MEMBER'::"MemberType";

-- 7. Pool-to-Group invitation tracking
CREATE TABLE IF NOT EXISTS "PoolMemberGroupInvite" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "poolMemberId"  UUID NOT NULL REFERENCES "PoolMember"("id") ON DELETE CASCADE,
  "groupId"       TEXT NOT NULL,             -- references Group.id (TEXT in schema)
  "invitedBy"     TEXT NOT NULL,             -- userId of admin who sent invite
  "status"        TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | ACCEPTED | DECLINED | EXPIRED
  "message"       TEXT,
  "expiresAt"     TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
  "respondedAt"   TIMESTAMPTZ,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Payment options per country
CREATE TABLE IF NOT EXISTS "CountryPaymentMethod" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "country"       TEXT NOT NULL,
  "method"        "PaymentMethod" NOT NULL,
  "isDefault"     BOOLEAN NOT NULL DEFAULT FALSE,
  "isActive"      BOOLEAN NOT NULL DEFAULT TRUE,
  "displayName"   TEXT NOT NULL,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("country", "method")
);

-- 9. Seed default payment methods (Credit Card default in all countries)
INSERT INTO "CountryPaymentMethod" ("country", "method", "isDefault", "displayName")
VALUES
  ('ZA', 'CREDIT_CARD',   TRUE,  'Credit Card'),
  ('ZA', 'DEBIT_CARD',    FALSE, 'Debit Card'),
  ('ZA', 'BANK_TRANSFER', FALSE, 'EFT / Bank Transfer'),
  ('ZW', 'CREDIT_CARD',   TRUE,  'Credit Card'),
  ('ZW', 'MOBILE_MONEY',  FALSE, 'EcoCash'),
  ('ZW', 'BANK_TRANSFER', FALSE, 'Bank Transfer'),
  ('KE', 'CREDIT_CARD',   TRUE,  'Credit Card'),
  ('KE', 'MOBILE_MONEY',  FALSE, 'M-Pesa'),
  ('KE', 'BANK_TRANSFER', FALSE, 'Bank Transfer'),
  ('TZ', 'CREDIT_CARD',   TRUE,  'Credit Card'),
  ('TZ', 'MOBILE_MONEY',  FALSE, 'M-Pesa / Airtel Money'),
  ('UG', 'CREDIT_CARD',   TRUE,  'Credit Card'),
  ('UG', 'MOBILE_MONEY',  FALSE, 'MTN Mobile Money'),
  ('ZM', 'CREDIT_CARD',   TRUE,  'Credit Card'),
  ('ZM', 'MOBILE_MONEY',  FALSE, 'MTN Mobile Money'),
  ('MW', 'CREDIT_CARD',   TRUE,  'Credit Card'),
  ('MW', 'MOBILE_MONEY',  FALSE, 'Airtel Money'),
  ('BW', 'CREDIT_CARD',   TRUE,  'Credit Card'),
  ('BW', 'BANK_TRANSFER', FALSE, 'Bank Transfer')
ON CONFLICT ("country", "method") DO NOTHING;

-- 10. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_poolmember_status ON "PoolMember"("status");
CREATE INDEX IF NOT EXISTS idx_poolmember_email ON "PoolMember"("email");
CREATE INDEX IF NOT EXISTS idx_poolmember_country ON "PoolMember"("country");
CREATE INDEX IF NOT EXISTS idx_pool_invite_poolmember ON "PoolMemberGroupInvite"("poolMemberId");
CREATE INDEX IF NOT EXISTS idx_pool_invite_group ON "PoolMemberGroupInvite"("groupId");
CREATE INDEX IF NOT EXISTS idx_pool_invite_status ON "PoolMemberGroupInvite"("status");

-- 11. Confirmation
SELECT
  (SELECT COUNT(*) FROM "PoolMember")              AS pool_members,
  (SELECT COUNT(*) FROM "PoolMemberGroupInvite")   AS pool_invites,
  (SELECT COUNT(*) FROM "CountryPaymentMethod")    AS payment_methods;
