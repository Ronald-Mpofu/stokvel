-- ============================================================
-- INVESTMENT WINDFALL SCHEME — Schema
-- Run in Supabase SQL Editor
-- ============================================================

-- ── Enums ────────────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE "InvestmentClubStatus" AS ENUM ('SETUP','ACTIVE','CLOSED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE "InvestmentContribStatus" AS ENUM ('PENDING','PAID','PARTIAL','LATE','WAIVED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE "InvestmentLoanStatus" AS ENUM ('PENDING_APPROVAL','APPROVED','ACTIVE','SETTLED','REJECTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE "DisbursementStatus" AS ENUM ('PENDING','APPROVED','PAID','REJECTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── InvestmentClub ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "InvestmentClub" (
  "id"                    TEXT          NOT NULL DEFAULT gen_random_uuid()::text,
  "groupId"               TEXT          NOT NULL,
  "name"                  TEXT          NOT NULL,
  "description"           TEXT,
  "status"                "InvestmentClubStatus" NOT NULL DEFAULT 'SETUP',
  "currency"              "CurrencyCode" NOT NULL DEFAULT 'USD',
  "contributionAmount"    DECIMAL(18,4) NOT NULL DEFAULT 0,
  "contributionFrequency" TEXT          NOT NULL DEFAULT 'MONTHLY',
  "loanLimitPct"          DECIMAL(5,4)  NOT NULL DEFAULT 0.5000,
  "loanInterestRatePa"    DECIMAL(5,4)  NOT NULL DEFAULT 0.1800,
  "lateContribPenaltyPct" DECIMAL(5,4)  NOT NULL DEFAULT 0.0500,
  "adminId"               TEXT,
  "treasurerId"           TEXT,
  "secretaryId"           TEXT,
  "totalFundValue"        DECIMAL(18,4) NOT NULL DEFAULT 0,
  "totalContributed"      DECIMAL(18,4) NOT NULL DEFAULT 0,
  "totalLoaned"           DECIMAL(18,4) NOT NULL DEFAULT 0,
  "totalDisbursed"        DECIMAL(18,4) NOT NULL DEFAULT 0,
  "notes"                 TEXT,
  "createdAt"             TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvestmentClub_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "InvestmentClub_groupId_idx" ON "InvestmentClub"("groupId");

-- ── InvestmentMember ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "InvestmentMember" (
  "id"                TEXT          NOT NULL DEFAULT gen_random_uuid()::text,
  "clubId"            TEXT          NOT NULL,
  "userId"            TEXT          NOT NULL,
  "totalContributed"  DECIMAL(18,4) NOT NULL DEFAULT 0,
  "loanBalance"       DECIMAL(18,4) NOT NULL DEFAULT 0,
  "isActive"          BOOLEAN       NOT NULL DEFAULT true,
  "joinedAt"          TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvestmentMember_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvestmentMember_clubId_userId_key" UNIQUE ("clubId","userId")
);
CREATE INDEX IF NOT EXISTS "InvestmentMember_clubId_idx" ON "InvestmentMember"("clubId");
CREATE INDEX IF NOT EXISTS "InvestmentMember_userId_idx" ON "InvestmentMember"("userId");

-- ── InvestmentContribution ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "InvestmentContribution" (
  "id"                 TEXT          NOT NULL DEFAULT gen_random_uuid()::text,
  "clubId"             TEXT          NOT NULL,
  "userId"             TEXT          NOT NULL,
  "periodNumber"       INTEGER       NOT NULL,
  "dueDate"            TIMESTAMP(3)  NOT NULL,
  "amountDue"          DECIMAL(18,4) NOT NULL DEFAULT 0,
  "loanRepaymentDue"   DECIMAL(18,4) NOT NULL DEFAULT 0,
  "penaltyDue"         DECIMAL(18,4) NOT NULL DEFAULT 0,
  "totalDue"           DECIMAL(18,4) NOT NULL DEFAULT 0,
  "amountPaid"         DECIMAL(18,4) NOT NULL DEFAULT 0,
  "status"             "InvestmentContribStatus" NOT NULL DEFAULT 'PENDING',
  "paidAt"             TIMESTAMP(3),
  "paymentMethod"      TEXT,
  "paymentRef"         TEXT,
  "penaltyApplied"     DECIMAL(18,4) NOT NULL DEFAULT 0,
  "notes"              TEXT,
  "createdAt"          TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvestmentContribution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvestmentContribution_unique" UNIQUE ("clubId","userId","periodNumber")
);
CREATE INDEX IF NOT EXISTS "InvestmentContrib_clubId_idx" ON "InvestmentContribution"("clubId");
CREATE INDEX IF NOT EXISTS "InvestmentContrib_userId_idx" ON "InvestmentContribution"("userId");
CREATE INDEX IF NOT EXISTS "InvestmentContrib_status_idx" ON "InvestmentContribution"("status");

-- ── InvestmentLoan ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "InvestmentLoan" (
  "id"                  TEXT          NOT NULL DEFAULT gen_random_uuid()::text,
  "clubId"              TEXT          NOT NULL,
  "borrowerId"          TEXT          NOT NULL,
  "amount"              DECIMAL(18,4) NOT NULL,
  "outstandingBalance"  DECIMAL(18,4) NOT NULL DEFAULT 0,
  "interestRatePa"      DECIMAL(5,4)  NOT NULL DEFAULT 0.18,
  "termMonths"          INTEGER       NOT NULL DEFAULT 6,
  "monthlyRepayment"    DECIMAL(18,4) NOT NULL DEFAULT 0,
  "totalInterestDue"    DECIMAL(18,4) NOT NULL DEFAULT 0,
  "totalInterestPaid"   DECIMAL(18,4) NOT NULL DEFAULT 0,
  "purpose"             TEXT,
  "status"              "InvestmentLoanStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "approvedById"        TEXT,
  "approvedAt"          TIMESTAMP(3),
  "disbursedAt"         TIMESTAMP(3),
  "settledAt"           TIMESTAMP(3),
  "rejectionReason"     TEXT,
  "notes"               TEXT,
  "createdAt"           TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvestmentLoan_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "InvestmentLoan_clubId_idx"    ON "InvestmentLoan"("clubId");
CREATE INDEX IF NOT EXISTS "InvestmentLoan_borrowerId_idx" ON "InvestmentLoan"("borrowerId");
CREATE INDEX IF NOT EXISTS "InvestmentLoan_status_idx"    ON "InvestmentLoan"("status");

-- ── InvestmentDisbursement ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "InvestmentDisbursement" (
  "id"           TEXT          NOT NULL DEFAULT gen_random_uuid()::text,
  "clubId"       TEXT          NOT NULL,
  "userId"       TEXT          NOT NULL,
  "amount"       DECIMAL(18,4) NOT NULL,
  "balanceBefore" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "balanceAfter"  DECIMAL(18,4) NOT NULL DEFAULT 0,
  "reason"       TEXT,
  "status"       "DisbursementStatus" NOT NULL DEFAULT 'PENDING',
  "approvedById" TEXT,
  "approvedAt"   TIMESTAMP(3),
  "paidAt"       TIMESTAMP(3),
  "paymentRef"   TEXT,
  "notes"        TEXT,
  "createdAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvestmentDisbursement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "InvestmentDisb_clubId_idx" ON "InvestmentDisbursement"("clubId");
CREATE INDEX IF NOT EXISTS "InvestmentDisb_userId_idx" ON "InvestmentDisbursement"("userId");

SELECT 'Investment schema created ✓' AS status;
