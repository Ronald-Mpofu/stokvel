
-- ============================================================
-- STOKVEL PLATFORM — Schema Update SQL
-- Run this directly in Supabase SQL Editor if db:push hangs
-- ============================================================

-- 1. New enums
DO $$ BEGIN
  CREATE TYPE "AssetCampaignType" AS ENUM ('SHARED_OWNERSHIP', 'ROUND_ROBIN');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "AssetQueueStatus" AS ENUM ('WAITING', 'FUNDING', 'SOURCING', 'ORDERED', 'DELIVERED', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "BackerStatus" AS ENUM ('PENDING_KYC', 'PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'WITHDRAWN', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "BackerKycStatus" AS ENUM ('NOT_SUBMITTED', 'SUBMITTED', 'VERIFIED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 2. New columns on Asset table
ALTER TABLE "Asset"
  ADD COLUMN IF NOT EXISTS "campaignType"          "AssetCampaignType" NOT NULL DEFAULT 'SHARED_OWNERSHIP',
  ADD COLUMN IF NOT EXISTS "unitsTotal"             INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "unitCost"               DECIMAL(18,4),
  ADD COLUMN IF NOT EXISTS "contributionPerMember"  DECIMAL(18,4),
  ADD COLUMN IF NOT EXISTS "positionStrategy"       TEXT NOT NULL DEFAULT 'SENIORITY',
  ADD COLUMN IF NOT EXISTS "allowOutsiders"         BOOLEAN NOT NULL DEFAULT false;

-- 3. AssetQueueEntry table
CREATE TABLE IF NOT EXISTS "AssetQueueEntry" (
  "id"                  TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "assetId"             TEXT NOT NULL,
  "userId"              TEXT NOT NULL,
  "position"            INTEGER NOT NULL,
  "status"              "AssetQueueStatus" NOT NULL DEFAULT 'WAITING',
  "targetAmount"        DECIMAL(18,4) NOT NULL,
  "raisedAmount"        DECIMAL(18,4) NOT NULL DEFAULT 0,
  "fundingStarted"      TIMESTAMP(3),
  "orderedAt"           TIMESTAMP(3),
  "deliveredAt"         TIMESTAMP(3),
  "deliveryNotes"       TEXT,
  "deliveryPhotoUrls"   JSONB,
  "skippedAt"           TIMESTAMP(3),
  "skipReason"          TEXT,
  "serialNumber"        TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssetQueueEntry_pkey"                    PRIMARY KEY ("id"),
  CONSTRAINT "AssetQueueEntry_assetId_userId_key"      UNIQUE ("assetId", "userId"),
  CONSTRAINT "AssetQueueEntry_assetId_position_key"    UNIQUE ("assetId", "position")
);

CREATE INDEX IF NOT EXISTS "AssetQueueEntry_assetId_idx" ON "AssetQueueEntry"("assetId");
CREATE INDEX IF NOT EXISTS "AssetQueueEntry_userId_idx"  ON "AssetQueueEntry"("userId");
CREATE INDEX IF NOT EXISTS "AssetQueueEntry_status_idx"  ON "AssetQueueEntry"("status");
CREATE INDEX IF NOT EXISTS "Asset_campaignType_idx"      ON "Asset"("campaignType");

-- 4. AssetCostingSheet table
CREATE TABLE IF NOT EXISTS "AssetCostingSheet" (
  "id"              TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "assetId"         TEXT NOT NULL,
  "title"           TEXT NOT NULL DEFAULT 'Asset Cost Breakdown',
  "currency"        TEXT NOT NULL DEFAULT 'USD',
  "units"           INTEGER NOT NULL DEFAULT 1,
  "membersSharing"  INTEGER NOT NULL DEFAULT 1,
  "contingencyPct"  DECIMAL(5,2) NOT NULL DEFAULT 5,
  "notes"           TEXT,
  "status"          TEXT NOT NULL DEFAULT 'DRAFT',
  "approvedById"    TEXT,
  "approvedAt"      TIMESTAMP(3),
  "createdById"     TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssetCostingSheet_pkey"          PRIMARY KEY ("id"),
  CONSTRAINT "AssetCostingSheet_assetId_key"   UNIQUE ("assetId")
);

CREATE INDEX IF NOT EXISTS "AssetCostingSheet_assetId_idx" ON "AssetCostingSheet"("assetId");

-- 5. AssetCostingItem table
CREATE TABLE IF NOT EXISTS "AssetCostingItem" (
  "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "sheetId"     TEXT NOT NULL,
  "category"    TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "amount"      DECIMAL(18,4) NOT NULL,
  "currency"    TEXT NOT NULL DEFAULT 'USD',
  "isPerUnit"   BOOLEAN NOT NULL DEFAULT true,
  "isOptional"  BOOLEAN NOT NULL DEFAULT false,
  "included"    BOOLEAN NOT NULL DEFAULT true,
  "notes"       TEXT,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssetCostingItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AssetCostingItem_sheetId_idx" ON "AssetCostingItem"("sheetId");

-- 6. AssetBacker table
CREATE TABLE IF NOT EXISTS "AssetBacker" (
  "id"               TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "assetId"          TEXT NOT NULL,
  "fullName"         TEXT NOT NULL,
  "email"            TEXT NOT NULL,
  "phone"            TEXT NOT NULL,
  "nationalId"       TEXT,
  "country"          TEXT,
  "city"             TEXT,
  "occupation"       TEXT,
  "kycStatus"        "BackerKycStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
  "kycDocumentUrl"   TEXT,
  "kycVerifiedAt"    TIMESTAMP(3),
  "kycVerifiedBy"    TEXT,
  "kycRejectedAt"    TIMESTAMP(3),
  "kycRejectionNote" TEXT,
  "status"           "BackerStatus" NOT NULL DEFAULT 'PENDING_KYC',
  "approvedById"     TEXT,
  "approvedAt"       TIMESTAMP(3),
  "rejectedAt"       TIMESTAMP(3),
  "rejectionReason"  TEXT,
  "totalContributed" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "ownershipPct"     DECIMAL(10,4) NOT NULL DEFAULT 0,
  "currency"         TEXT NOT NULL DEFAULT 'USD',
  "linkedUserId"     TEXT,
  "referredById"     TEXT,
  "referralCode"     TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "agreedToTermsAt"  TIMESTAMP(3),
  "agreedToTermsIp"  TEXT,
  "notes"            TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssetBacker_pkey"                PRIMARY KEY ("id"),
  CONSTRAINT "AssetBacker_assetId_email_key"   UNIQUE ("assetId", "email"),
  CONSTRAINT "AssetBacker_referralCode_key"    UNIQUE ("referralCode")
);

CREATE INDEX IF NOT EXISTS "AssetBacker_assetId_idx" ON "AssetBacker"("assetId");

-- 7. BackerContribution table
CREATE TABLE IF NOT EXISTS "BackerContribution" (
  "id"            TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "backerId"      TEXT NOT NULL,
  "assetId"       TEXT NOT NULL,
  "amount"        DECIMAL(18,4) NOT NULL,
  "currency"      TEXT NOT NULL DEFAULT 'USD',
  "paymentMethod" TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
  "paymentRef"    TEXT,
  "notes"         TEXT,
  "recordedById"  TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BackerContribution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BackerContribution_backerId_idx" ON "BackerContribution"("backerId");
CREATE INDEX IF NOT EXISTS "BackerContribution_assetId_idx"  ON "BackerContribution"("assetId");
CREATE INDEX IF NOT EXISTS "BackerContribution_createdAt_idx" ON "BackerContribution"("createdAt");

-- Done
SELECT 'Schema update complete' AS status;
