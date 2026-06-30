-- ============================================================
-- SCHEMA UPDATE v2 — Income, Insurance, Maintenance, Suppliers
-- Run in Supabase SQL Editor if db:push hangs
-- ============================================================

-- AssetIncome
CREATE TABLE IF NOT EXISTS "AssetIncome" (
  "id"            TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "assetId"       TEXT NOT NULL,
  "groupId"       TEXT NOT NULL,
  "type"          TEXT NOT NULL,
  "amount"        DECIMAL(18,4) NOT NULL,
  "currency"      TEXT NOT NULL DEFAULT 'USD',
  "description"   TEXT NOT NULL,
  "incomeDate"    TIMESTAMP(3) NOT NULL,
  "collectedById" TEXT,
  "reference"     TEXT,
  "expenses"      DECIMAL(18,4) NOT NULL DEFAULT 0,
  "netAmount"     DECIMAL(18,4) NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'PENDING',
  "distributedAt" TIMESTAMP(3),
  "notes"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssetIncome_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AssetIncome_assetId_idx"    ON "AssetIncome"("assetId");
CREATE INDEX IF NOT EXISTS "AssetIncome_groupId_idx"    ON "AssetIncome"("groupId");
CREATE INDEX IF NOT EXISTS "AssetIncome_incomeDate_idx" ON "AssetIncome"("incomeDate");

-- AssetIncomeShare
CREATE TABLE IF NOT EXISTS "AssetIncomeShare" (
  "id"           TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "incomeId"     TEXT NOT NULL,
  "assetId"      TEXT NOT NULL,
  "userId"       TEXT,
  "backerId"     TEXT,
  "ownershipPct" DECIMAL(10,4) NOT NULL,
  "shareAmount"  DECIMAL(18,4) NOT NULL,
  "currency"     TEXT NOT NULL DEFAULT 'USD',
  "status"       TEXT NOT NULL DEFAULT 'PENDING',
  "paidAt"       TIMESTAMP(3),
  "paymentRef"   TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssetIncomeShare_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AssetIncomeShare_incomeId_idx" ON "AssetIncomeShare"("incomeId");
CREATE INDEX IF NOT EXISTS "AssetIncomeShare_userId_idx"   ON "AssetIncomeShare"("userId");
CREATE INDEX IF NOT EXISTS "AssetIncomeShare_backerId_idx" ON "AssetIncomeShare"("backerId");

-- AssetInsurance
CREATE TABLE IF NOT EXISTS "AssetInsurance" (
  "id"               TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "assetId"          TEXT NOT NULL,
  "insurer"          TEXT NOT NULL,
  "policyNumber"     TEXT NOT NULL,
  "policyType"       TEXT NOT NULL,
  "coverAmount"      DECIMAL(18,4) NOT NULL,
  "currency"         TEXT NOT NULL DEFAULT 'USD',
  "premiumAmount"    DECIMAL(18,4) NOT NULL,
  "premiumFrequency" TEXT NOT NULL DEFAULT 'ANNUAL',
  "startDate"        TIMESTAMP(3) NOT NULL,
  "expiryDate"       TIMESTAMP(3) NOT NULL,
  "nextRenewalDate"  TIMESTAMP(3),
  "status"           TEXT NOT NULL DEFAULT 'ACTIVE',
  "documentUrl"      TEXT,
  "contactName"      TEXT,
  "contactPhone"     TEXT,
  "contactEmail"     TEXT,
  "notes"            TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssetInsurance_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AssetInsurance_assetId_idx"    ON "AssetInsurance"("assetId");
CREATE INDEX IF NOT EXISTS "AssetInsurance_expiryDate_idx" ON "AssetInsurance"("expiryDate");

-- AssetInsuranceClaim
CREATE TABLE IF NOT EXISTS "AssetInsuranceClaim" (
  "id"            TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "insuranceId"   TEXT NOT NULL,
  "assetId"       TEXT NOT NULL,
  "claimDate"     TIMESTAMP(3) NOT NULL,
  "description"   TEXT NOT NULL,
  "claimAmount"   DECIMAL(18,4) NOT NULL,
  "currency"      TEXT NOT NULL DEFAULT 'USD',
  "status"        TEXT NOT NULL DEFAULT 'SUBMITTED',
  "settledAmount" DECIMAL(18,4),
  "settledAt"     TIMESTAMP(3),
  "referenceNo"   TEXT,
  "documentUrl"   TEXT,
  "notes"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssetInsuranceClaim_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AssetInsuranceClaim_insuranceId_idx" ON "AssetInsuranceClaim"("insuranceId");
CREATE INDEX IF NOT EXISTS "AssetInsuranceClaim_assetId_idx"     ON "AssetInsuranceClaim"("assetId");

-- AssetMaintenance
CREATE TABLE IF NOT EXISTS "AssetMaintenance" (
  "id"               TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "assetId"          TEXT NOT NULL,
  "type"             TEXT NOT NULL,
  "description"      TEXT NOT NULL,
  "performedBy"      TEXT,
  "vendor"           TEXT,
  "cost"             DECIMAL(18,4) NOT NULL,
  "currency"         TEXT NOT NULL DEFAULT 'USD',
  "scheduledDate"    TIMESTAMP(3),
  "completedDate"    TIMESTAMP(3),
  "nextDueDate"      TIMESTAMP(3),
  "nextDueMileage"   INTEGER,
  "mileageAtService" INTEGER,
  "status"           TEXT NOT NULL DEFAULT 'SCHEDULED',
  "invoiceUrl"       TEXT,
  "notes"            TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssetMaintenance_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AssetMaintenance_assetId_idx"       ON "AssetMaintenance"("assetId");
CREATE INDEX IF NOT EXISTS "AssetMaintenance_scheduledDate_idx" ON "AssetMaintenance"("scheduledDate");
CREATE INDEX IF NOT EXISTS "AssetMaintenance_status_idx"        ON "AssetMaintenance"("status");

-- AssetDepreciation
CREATE TABLE IF NOT EXISTS "AssetDepreciation" (
  "id"               TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "assetId"          TEXT NOT NULL UNIQUE,
  "method"           TEXT NOT NULL DEFAULT 'STRAIGHT_LINE',
  "usefulLifeYears"  INTEGER NOT NULL DEFAULT 5,
  "residualValue"    DECIMAL(18,4) NOT NULL DEFAULT 0,
  "acquisitionCost"  DECIMAL(18,4) NOT NULL,
  "currentValue"     DECIMAL(18,4) NOT NULL,
  "depreciationRate" DECIMAL(8,4) NOT NULL,
  "lastCalculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssetDepreciation_pkey" PRIMARY KEY ("id")
);

-- Supplier
CREATE TABLE IF NOT EXISTS "Supplier" (
  "id"            TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "name"          TEXT NOT NULL,
  "tradingName"   TEXT,
  "country"       TEXT NOT NULL,
  "city"          TEXT,
  "address"       TEXT,
  "phone"         TEXT,
  "email"         TEXT,
  "website"       TEXT,
  "contactPerson" TEXT,
  "contactPhone"  TEXT,
  "contactEmail"  TEXT,
  "category"      TEXT NOT NULL,
  "currencies"    JSONB,
  "paymentTerms"  TEXT,
  "leadTimeDays"  INTEGER,
  "rating"        INTEGER,
  "isVerified"    BOOLEAN NOT NULL DEFAULT false,
  "verifiedAt"    TIMESTAMP(3),
  "taxNumber"     TEXT,
  "bankDetails"   JSONB,
  "notes"         TEXT,
  "tags"          JSONB,
  "status"        TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Supplier_category_idx" ON "Supplier"("category");
CREATE INDEX IF NOT EXISTS "Supplier_country_idx"  ON "Supplier"("country");
CREATE INDEX IF NOT EXISTS "Supplier_status_idx"   ON "Supplier"("status");

-- SupplierQuote
CREATE TABLE IF NOT EXISTS "SupplierQuote" (
  "id"              TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "supplierId"      TEXT NOT NULL,
  "assetId"         TEXT,
  "title"           TEXT NOT NULL,
  "description"     TEXT,
  "currency"        TEXT NOT NULL DEFAULT 'USD',
  "unitPrice"       DECIMAL(18,4) NOT NULL,
  "quantity"        INTEGER NOT NULL DEFAULT 1,
  "totalPrice"      DECIMAL(18,4) NOT NULL,
  "incoterms"       TEXT,
  "validUntil"      TIMESTAMP(3),
  "leadTimeDays"    INTEGER,
  "paymentTerms"    TEXT,
  "includesFreight" BOOLEAN NOT NULL DEFAULT false,
  "includesInstall" BOOLEAN NOT NULL DEFAULT false,
  "documentUrl"     TEXT,
  "status"          TEXT NOT NULL DEFAULT 'RECEIVED',
  "notes"           TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierQuote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SupplierQuote_supplierId_idx" ON "SupplierQuote"("supplierId");
CREATE INDEX IF NOT EXISTS "SupplierQuote_assetId_idx"   ON "SupplierQuote"("assetId");
CREATE INDEX IF NOT EXISTS "SupplierQuote_status_idx"    ON "SupplierQuote"("status");

SELECT 'Schema update v2 complete' AS status;
