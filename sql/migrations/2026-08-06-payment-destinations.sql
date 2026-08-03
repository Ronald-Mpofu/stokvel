-- ============================================================
-- 2026-08-06-payment-destinations.sql
-- Phase 6b step 1 — where members actually send money, and the
-- fields needed to reconcile it.
--
-- Idempotent. Safe to re-run.
--
-- ── THE BLOCKER THIS SOLVES ──────────────────────────────────
-- The BANK_TRANSFER adapter tells the member:
--
--   "Transfer USD 25 using reference JF-2026-A1B2C3D4"
--
-- and gives them NO account number, NO bank name, NO EcoCash number.
-- There is nowhere to send the money. Every downstream feature —
-- "Submitted" status, manual verification, receipts — is meaningless
-- until a destination exists.
--
-- ── EXPIRY ───────────────────────────────────────────────────
-- Invoices were created with a 48-hour expiry. A cross-border bank
-- transfer takes three to five working days, so a member paying on
-- Friday found the invoice dead before the money landed. Manual rails
-- now have NO expiry: the invoice stays open until it is reconciled.
--
-- Card invoices keep a short window — Stripe Checkout sessions expire
-- on their own, and a stale card invoice serves no purpose.
-- ============================================================

BEGIN;

-- ── 1. Where to send money ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "RefPaymentDestination" (
  "id"             TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "countryCode"    TEXT        NOT NULL,
  "currency"       TEXT        NOT NULL,
  "method"         TEXT        NOT NULL,   -- BANK_TRANSFER | ECOCASH | MPESA | MTN_MOMO
  "displayName"    TEXT        NOT NULL,   -- what the member sees, e.g. "CBZ Bank — USD"

  -- Bank fields
  "bankName"       TEXT,
  "accountName"    TEXT,
  "accountNumber"  TEXT,
  "branchName"     TEXT,
  "branchCode"     TEXT,
  "swiftCode"      TEXT,

  -- Mobile wallet fields
  "walletNumber"   TEXT,
  "walletName"     TEXT,

  -- Free text shown beneath the details — cut-off times, fee warnings,
  -- "use your reference as the narration", and so on.
  "instructions"   TEXT,

  "isActive"       BOOLEAN     NOT NULL DEFAULT true,
  "sortOrder"      INTEGER     NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One live destination per country + method + currency. Partial on
-- isActive so a retired account can be kept for historical reference
-- without blocking its replacement.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_refpaymentdestination_live"
  ON "RefPaymentDestination" ("countryCode", "method", "currency")
  WHERE "isActive";

CREATE INDEX IF NOT EXISTS "idx_refpaymentdestination_lookup"
  ON "RefPaymentDestination" ("countryCode", "isActive", "sortOrder");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_refpaymentdestination_method'
  ) THEN
    ALTER TABLE "RefPaymentDestination"
      ADD CONSTRAINT "chk_refpaymentdestination_method"
      CHECK ("method" IN ('BANK_TRANSFER', 'ECOCASH', 'MPESA', 'MTN_MOMO', 'USSD'));
  END IF;
END $$;


-- ── 2. Member-side confirmation ──────────────────────────────
-- The invoice reference is one WE generate. To reconcile against a bank
-- statement the admin also needs THEIR reference and the date they
-- sent it — otherwise matching falls back to amount alone, which breaks
-- the moment two members pay the same fee on the same day.
ALTER TABLE "PaymentAttempt" ADD COLUMN IF NOT EXISTS "memberReference" TEXT;
ALTER TABLE "PaymentAttempt" ADD COLUMN IF NOT EXISTS "memberPaidAt"    TIMESTAMPTZ;
ALTER TABLE "PaymentAttempt" ADD COLUMN IF NOT EXISTS "memberNote"      TEXT;
ALTER TABLE "PaymentAttempt" ADD COLUMN IF NOT EXISTS "destinationId"   TEXT;

-- ── 3. Admin-side verification ───────────────────────────────
-- receivedAmount is separate from amount on purpose: a ZWG or KES
-- transfer can arrive short after bank charges or FX. The admin records
-- what ACTUALLY landed, and the difference is visible rather than
-- silently absorbed.
ALTER TABLE "PaymentAttempt" ADD COLUMN IF NOT EXISTS "verifiedById"      TEXT;
ALTER TABLE "PaymentAttempt" ADD COLUMN IF NOT EXISTS "verifiedAt"        TIMESTAMPTZ;
ALTER TABLE "PaymentAttempt" ADD COLUMN IF NOT EXISTS "verifiedReference" TEXT;
ALTER TABLE "PaymentAttempt" ADD COLUMN IF NOT EXISTS "receivedAmount"    NUMERIC(18,4);
ALTER TABLE "PaymentAttempt" ADD COLUMN IF NOT EXISTS "verificationNote"  TEXT;

-- Drives the admin's "awaiting verification" queue.
CREATE INDEX IF NOT EXISTS "idx_paymentattempt_pending_manual"
  ON "PaymentAttempt" ("status", "createdAt" DESC)
  WHERE "verifiedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_paymentattempt_user"
  ON "PaymentAttempt" ("userId", "createdAt" DESC);


-- ── 4. Receipts ──────────────────────────────────────────────
ALTER TABLE "JoiningFeeInvoice" ADD COLUMN IF NOT EXISTS "receiptSentAt" TIMESTAMPTZ;
ALTER TABLE "JoiningFeeInvoice" ADD COLUMN IF NOT EXISTS "receiptNo"     TEXT;


-- ── 5. Clear the 48-hour expiry on open invoices ─────────────
-- Any PENDING invoice currently carrying an expiry is one a member may
-- still be paying into. Clearing it now stops today's in-flight
-- transfers being orphaned.
UPDATE "JoiningFeeInvoice"
SET "expiresAt" = NULL
WHERE "status" = 'PENDING';


-- ── 6. Confirmation ──────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM "RefPaymentDestination")                          AS destinations,
  (SELECT COUNT(*) FROM "RefPaymentDestination" WHERE "isActive")         AS destinations_active,
  (SELECT COUNT(*) FROM "JoiningFeeInvoice" WHERE "status" = 'PENDING')   AS open_invoices,
  (SELECT COUNT(*) FROM "JoiningFeeInvoice"
    WHERE "status" = 'PENDING' AND "expiresAt" IS NOT NULL)               AS still_expiring;

COMMIT;

-- ============================================================
-- NEXT: ADD YOUR DESTINATIONS
--
-- Nothing can be paid manually until at least one row exists. Template
-- below — edit and run separately. countryCode and currency must match
-- the values in RefJoiningFee, or the lookup will not find them.
--
-- INSERT INTO "RefPaymentDestination"
--   ("countryCode","currency","method","displayName",
--    "bankName","accountName","accountNumber","branchName","branchCode","swiftCode",
--    "instructions","sortOrder")
-- VALUES
--   ('ZW','USD','BANK_TRANSFER','CBZ Bank — USD',
--    'CBZ Bank Limited','Windfall Community Deals','0123456789','Harare Main','1234','CBZWZWHX',
--    'Use your invoice reference as the payment narration. Allow 1-2 working days.',1);
--
-- INSERT INTO "RefPaymentDestination"
--   ("countryCode","currency","method","displayName","walletNumber","walletName",
--    "instructions","sortOrder")
-- VALUES
--   ('ZW','USD','ECOCASH','EcoCash — USD','0771234567','Windfall Community Deals',
--    'Send to the number above, then enter the EcoCash confirmation code below.',2);
-- ============================================================
