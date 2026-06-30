-- ============================================================
-- Windfall Community Deals — Membership Enhancement Migration
-- Run this in Supabase SQL Editor
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
-- NOTE: Align this enum with the existing app/API values.
-- Your database already has PaymentMethod, so using CREDIT_CARD caused:
-- invalid input value for enum "PaymentMethod": "CREDIT_CARD".
DO $$ BEGIN
  CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'ECOCASH', 'BANK_TRANSFER');
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
  "paymentMethod"     "PaymentMethod" NOT NULL DEFAULT 'CARD'::"PaymentMethod",
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

-- 9. Seed default payment methods
-- Uses PaymentMethod enum values expected by the current app: CARD, ECOCASH, BANK_TRANSFER.
INSERT INTO "CountryPaymentMethod" ("country", "method", "isDefault", "displayName")
VALUES
  ('ZA', 'CARD',          TRUE,  'Card'),
  ('ZA', 'BANK_TRANSFER', FALSE, 'EFT / Bank Transfer'),
  ('ZW', 'ECOCASH',       TRUE,  'EcoCash'),
  ('ZW', 'BANK_TRANSFER', FALSE, 'Bank Transfer'),
  ('ZW', 'CARD',          FALSE, 'Card'),
  ('KE', 'ECOCASH',       TRUE,  'M-Pesa'),
  ('KE', 'BANK_TRANSFER', FALSE, 'Bank Transfer'),
  ('KE', 'CARD',          FALSE, 'Card'),
  ('TZ', 'ECOCASH',       TRUE,  'M-Pesa / Airtel Money'),
  ('TZ', 'BANK_TRANSFER', FALSE, 'Bank Transfer'),
  ('UG', 'ECOCASH',       TRUE,  'MTN Mobile Money'),
  ('UG', 'BANK_TRANSFER', FALSE, 'Bank Transfer'),
  ('ZM', 'ECOCASH',       TRUE,  'MTN Mobile Money'),
  ('ZM', 'BANK_TRANSFER', FALSE, 'Bank Transfer'),
  ('MW', 'ECOCASH',       TRUE,  'Airtel Money'),
  ('MW', 'BANK_TRANSFER', FALSE, 'Bank Transfer'),
  ('BW', 'CARD',          TRUE,  'Card'),
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
