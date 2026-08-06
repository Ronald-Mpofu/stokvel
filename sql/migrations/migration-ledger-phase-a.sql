-- ============================================================
-- Windfall Community Deals
-- Migration: Ledger — invoicing and payment attestation (Phase A)
--
-- Run in the Supabase SQL Editor BEFORE deploying Phase A code.
-- Safe to re-run: every object uses IF NOT EXISTS.
--
-- WHAT THIS IS
--   A shared invoicing and settlement layer for every group and every
--   Windfall Scheme. It sits on top of the existing double-entry GL
--   (LedgerAccount / LedgerEntry / Transaction, already in schema.prisma)
--   rather than replacing it.
--
-- THE CENTRAL CONSTRAINT
--   Windfall never receives the money. In a rotating pool, member A pays
--   member B directly. So a payment is not a system fact the platform can
--   verify — it is an ATTESTATION by the payer, CONFIRMED by the payee.
--   Every status name in LedgerPayment reflects that honestly. Nothing in
--   this schema claims the platform observed a transfer.
--
-- DESIGN NOTES
--   1. Raw SQL only. None of these tables are in schema.prisma; access is
--      exclusively via $queryRawUnsafe / $executeRawUnsafe.
--   2. Status and type columns are TEXT + CHECK, not Postgres enums, so
--      they need no ::"Type" casts and can be extended without a
--      transaction-blocking ALTER TYPE.
--   3. currency is TEXT, matching every other raw-SQL table here.
--   4. Money is NUMERIC(18,4), matching Decimal(18,4) in schema.prisma.
--   5. Invoices are immutable once ISSUED. Corrections are made by
--      cancelling and reissuing, or by a credit note — never by editing
--      an issued obligation.
-- ============================================================


-- ── 1. Invoice number counter ────────────────────────────────
-- Sequential per group, as agreed.
--
-- WHY A COUNTER TABLE AND NOT MAX(seq)+1
--   SELECT MAX(...)+1 races. Two members activating or paying at the same
--   moment both read the same maximum and both write the same number. The
--   UPDATE ... RETURNING below takes a row lock and is atomic in one
--   statement, so concurrent callers serialise correctly.

CREATE TABLE IF NOT EXISTS "LedgerCounter" (
  "groupId"     TEXT NOT NULL,
  kind          TEXT NOT NULL,              -- INVOICE | PAYMENT
  "nextNumber"  INTEGER NOT NULL DEFAULT 1,
  prefix        TEXT NOT NULL DEFAULT 'INV',
  "updatedAt"   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY ("groupId", kind),

  CONSTRAINT "LedgerCounter_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "Group"(id) ON DELETE RESTRICT,

  CONSTRAINT "LedgerCounter_kind_check"
    CHECK (kind IN ('INVOICE','PAYMENT')),

  CONSTRAINT "LedgerCounter_nextNumber_check"
    CHECK ("nextNumber" >= 1)
);

-- Allocate the next number atomically. Creates the counter row on first
-- use, so no seeding step is needed when a group is created.
CREATE OR REPLACE FUNCTION next_ledger_number(p_group_id TEXT, p_kind TEXT, p_prefix TEXT)
RETURNS TABLE(seq INTEGER, formatted TEXT) AS $$
DECLARE
  v_seq INTEGER;
BEGIN
  INSERT INTO "LedgerCounter" ("groupId", kind, "nextNumber", prefix)
  VALUES (p_group_id, p_kind, 1, p_prefix)
  ON CONFLICT ("groupId", kind) DO NOTHING;

  UPDATE "LedgerCounter"
     SET "nextNumber" = "nextNumber" + 1,
         "updatedAt"  = CURRENT_TIMESTAMP
   WHERE "groupId" = p_group_id AND kind = p_kind
  RETURNING "nextNumber" - 1 INTO v_seq;

  RETURN QUERY SELECT v_seq, p_prefix || '-' || lpad(v_seq::text, 6, '0');
END;
$$ LANGUAGE plpgsql;


-- ── 2. LedgerInvoice ─────────────────────────────────────────
-- The obligation: who owes what, to whom, by when.
--
-- PAYEE MAY BE A MEMBER. This is what makes the table fit a rotating
-- pool. A normal invoicing system assumes the business is always the
-- payee; here member A genuinely owes member B and the group is not a
-- party to it.

CREATE TABLE IF NOT EXISTS "LedgerInvoice" (
  id                TEXT PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  "groupId"         TEXT NOT NULL,
  "schemeId"        TEXT,
  "invoiceNumber"   TEXT NOT NULL,
  "invoiceSeq"      INTEGER NOT NULL,

  -- Idempotency: what generated this invoice.
  "sourceType"      TEXT NOT NULL,
  "sourceId"        TEXT NOT NULL,

  -- Parties
  "payerType"       TEXT NOT NULL DEFAULT 'MEMBER',
  "payerId"         TEXT NOT NULL,
  "payeeType"       TEXT NOT NULL DEFAULT 'GROUP',
  "payeeId"         TEXT,

  currency          TEXT NOT NULL DEFAULT 'USD',
  subtotal          NUMERIC(18,4) NOT NULL DEFAULT 0,
  total             NUMERIC(18,4) NOT NULL DEFAULT 0,
  "amountAllocated" NUMERIC(18,4) NOT NULL DEFAULT 0,

  status            TEXT NOT NULL DEFAULT 'ISSUED',
  "issueDate"       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueDate"         TIMESTAMP NOT NULL,
  "periodLabel"     TEXT,
  "periodNumber"    INTEGER,
  description       TEXT,
  notes             TEXT,

  "settledAt"       TIMESTAMP,
  "cancelledAt"     TIMESTAMP,
  "cancelReason"    TEXT,
  "createdById"     TEXT,
  "createdAt"       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LedgerInvoice_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "Group"(id) ON DELETE RESTRICT,

  CONSTRAINT "LedgerInvoice_payerId_fkey"
    FOREIGN KEY ("payerId") REFERENCES "User"(id) ON DELETE RESTRICT,

  CONSTRAINT "LedgerInvoice_sourceType_check"
    CHECK ("sourceType" IN (
      'SAVINGS_CONTRIBUTION','SAVINGS_LOAN_REPAYMENT','GROCERY_ORDER',
      'ASSET_CONTRIBUTION','PROPERTY_CONTRIBUTION','INVESTMENT_CONTRIBUTION',
      'JOINING_FEE','SUBSCRIPTION','PENALTY','MANUAL'
    )),

  CONSTRAINT "LedgerInvoice_payerType_check"
    CHECK ("payerType" IN ('MEMBER','GROUP')),

  CONSTRAINT "LedgerInvoice_payeeType_check"
    CHECK ("payeeType" IN ('MEMBER','GROUP','SUPPLIER','PLATFORM')),

  CONSTRAINT "LedgerInvoice_status_check"
    CHECK (status IN ('DRAFT','ISSUED','PART_PAID','PAID','OVERDUE','CANCELLED','WRITTEN_OFF')),

  CONSTRAINT "LedgerInvoice_amounts_check"
    CHECK (total >= 0 AND "amountAllocated" >= 0),

  -- A member payee must be identified. Without this, a rotating-pool
  -- invoice could be issued with nobody to pay.
  CONSTRAINT "LedgerInvoice_payee_identified_check"
    CHECK ("payeeType" <> 'MEMBER' OR "payeeId" IS NOT NULL)
);

-- Idempotency: one invoice per source record. Generation can be re-run
-- safely — a retried activation will not double-bill a member.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_ledgerinvoice_source"
  ON "LedgerInvoice" ("sourceType", "sourceId")
  WHERE status <> 'CANCELLED';

CREATE UNIQUE INDEX IF NOT EXISTS "idx_ledgerinvoice_number"
  ON "LedgerInvoice" ("groupId", "invoiceSeq");

CREATE INDEX IF NOT EXISTS "idx_ledgerinvoice_group_status"
  ON "LedgerInvoice" ("groupId", status);

CREATE INDEX IF NOT EXISTS "idx_ledgerinvoice_payer"
  ON "LedgerInvoice" ("payerId", status);

CREATE INDEX IF NOT EXISTS "idx_ledgerinvoice_payee"
  ON "LedgerInvoice" ("payeeId", status)
  WHERE "payeeId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_ledgerinvoice_scheme"
  ON "LedgerInvoice" ("schemeId") WHERE "schemeId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_ledgerinvoice_due"
  ON "LedgerInvoice" ("dueDate") WHERE status IN ('ISSUED','PART_PAID','OVERDUE');


-- ── 3. LedgerInvoiceLine ─────────────────────────────────────
-- Line items. A savings contribution is one line; a grocery order is
-- many. Modelling lines now avoids a schema change when Grocery Club
-- and Assets start generating invoices in Phase C.

CREATE TABLE IF NOT EXISTS "LedgerInvoiceLine" (
  id            TEXT PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  "invoiceId"   TEXT NOT NULL,
  description   TEXT NOT NULL,
  quantity      NUMERIC(18,4) NOT NULL DEFAULT 1,
  "unitAmount"  NUMERIC(18,4) NOT NULL DEFAULT 0,
  "lineTotal"   NUMERIC(18,4) NOT NULL DEFAULT 0,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LedgerInvoiceLine_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "LedgerInvoice"(id) ON DELETE CASCADE,

  CONSTRAINT "LedgerInvoiceLine_quantity_check"
    CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS "idx_ledgerinvoiceline_invoice"
  ON "LedgerInvoiceLine" ("invoiceId", "sortOrder");


-- ── 4. LedgerPayment ─────────────────────────────────────────
-- An ATTESTATION that a payment was made, and its confirmation state.
--
-- THE CONFLICT OF INTEREST THIS TABLE HAS TO SURVIVE
--   In a rotating pool the confirming party is the beneficiary of the
--   pot. If they falsely deny receipt, the payer is told to pay twice.
--   Three controls, all recorded here:
--     - the payer attaches a reference and optional proof of transfer
--     - confirmedBy distinguishes RECIPIENT from TREASURER, so a
--       statement shows which payments the beneficiary actually
--       acknowledged and which the treasurer pushed through
--     - escalatesAt drives handover to the treasurer after 3 days,
--       so one unresponsive member cannot stall a whole rotation

CREATE TABLE IF NOT EXISTS "LedgerPayment" (
  id                 TEXT PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  "groupId"          TEXT NOT NULL,
  "paymentNumber"    TEXT NOT NULL,
  "paymentSeq"       INTEGER NOT NULL,

  "payerId"          TEXT NOT NULL,
  "payeeType"        TEXT NOT NULL DEFAULT 'GROUP',
  "payeeId"          TEXT,

  currency           TEXT NOT NULL DEFAULT 'USD',
  amount             NUMERIC(18,4) NOT NULL,
  "amountAllocated"  NUMERIC(18,4) NOT NULL DEFAULT 0,

  method             TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
  reference          TEXT,
  "proofPath"        TEXT,                    -- object key in group-documents
  "payerNote"        TEXT,

  status             TEXT NOT NULL DEFAULT 'SENT_UNCONFIRMED',
  "paidAt"           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "escalatesAt"      TIMESTAMP,
  "confirmedAt"      TIMESTAMP,
  "confirmedById"    TEXT,
  "confirmedBy"      TEXT,                    -- RECIPIENT | TREASURER
  "confirmNote"      TEXT,
  "disputedAt"       TIMESTAMP,
  "disputeReason"    TEXT,
  "cancelledAt"      TIMESTAMP,

  "createdById"      TEXT,
  "createdAt"        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LedgerPayment_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "Group"(id) ON DELETE RESTRICT,

  CONSTRAINT "LedgerPayment_payerId_fkey"
    FOREIGN KEY ("payerId") REFERENCES "User"(id) ON DELETE RESTRICT,

  CONSTRAINT "LedgerPayment_payeeType_check"
    CHECK ("payeeType" IN ('MEMBER','GROUP','SUPPLIER','PLATFORM')),

  CONSTRAINT "LedgerPayment_status_check"
    CHECK (status IN ('SENT_UNCONFIRMED','CONFIRMED','DISPUTED','CANCELLED')),

  CONSTRAINT "LedgerPayment_confirmedBy_check"
    CHECK ("confirmedBy" IS NULL OR "confirmedBy" IN ('RECIPIENT','TREASURER')),

  CONSTRAINT "LedgerPayment_method_check"
    CHECK (method IN ('BANK_TRANSFER','ECOCASH','MPESA','MTN_MOMO','CARD','USSD','CASH','INTERNAL_TRANSFER')),

  CONSTRAINT "LedgerPayment_amount_check"
    CHECK (amount > 0 AND "amountAllocated" >= 0),

  -- A confirmed payment must record who confirmed it and how. Without
  -- this, a CONFIRMED row with no attribution is unauditable.
  CONSTRAINT "LedgerPayment_confirmation_complete_check"
    CHECK (status <> 'CONFIRMED' OR ("confirmedAt" IS NOT NULL AND "confirmedBy" IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_ledgerpayment_number"
  ON "LedgerPayment" ("groupId", "paymentSeq");

CREATE INDEX IF NOT EXISTS "idx_ledgerpayment_payer"
  ON "LedgerPayment" ("payerId", status);

CREATE INDEX IF NOT EXISTS "idx_ledgerpayment_payee"
  ON "LedgerPayment" ("payeeId", status)
  WHERE "payeeId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_ledgerpayment_group_status"
  ON "LedgerPayment" ("groupId", status);

-- Drives the escalation sweep: unconfirmed payments past their window.
CREATE INDEX IF NOT EXISTS "idx_ledgerpayment_escalation"
  ON "LedgerPayment" ("escalatesAt")
  WHERE status = 'SENT_UNCONFIRMED';


-- ── 5. LedgerAllocation ──────────────────────────────────────
-- Which payment settles which invoice, and by how much.
--
-- A separate table because the relationship is genuinely many-to-many:
-- one payment can clear three months of arrears, and one invoice can be
-- settled by two part-payments. Storing an invoiceId on the payment
-- would make both cases impossible.

CREATE TABLE IF NOT EXISTS "LedgerAllocation" (
  id            TEXT PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  "paymentId"   TEXT NOT NULL,
  "invoiceId"   TEXT NOT NULL,
  amount        NUMERIC(18,4) NOT NULL,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LedgerAllocation_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "LedgerPayment"(id) ON DELETE CASCADE,

  CONSTRAINT "LedgerAllocation_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "LedgerInvoice"(id) ON DELETE RESTRICT,

  CONSTRAINT "LedgerAllocation_amount_check"
    CHECK (amount > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_ledgerallocation_pair"
  ON "LedgerAllocation" ("paymentId", "invoiceId");

CREATE INDEX IF NOT EXISTS "idx_ledgerallocation_invoice"
  ON "LedgerAllocation" ("invoiceId");


-- ── 6. Settings ──────────────────────────────────────────────
-- The confirmation window, so it is configurable per group without a
-- code change. Defaults to the agreed 3 days.

CREATE TABLE IF NOT EXISTS "LedgerSettings" (
  "groupId"                  TEXT PRIMARY KEY,
  "confirmationWindowDays"   INTEGER NOT NULL DEFAULT 3,
  "invoicePrefix"            TEXT NOT NULL DEFAULT 'INV',
  "paymentPrefix"            TEXT NOT NULL DEFAULT 'PAY',
  "allowTreasurerConfirm"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LedgerSettings_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "Group"(id) ON DELETE RESTRICT,

  CONSTRAINT "LedgerSettings_window_check"
    CHECK ("confirmationWindowDays" BETWEEN 1 AND 30)
);


-- ── Confirmation ─────────────────────────────────────────────
SELECT
  t.table_name,
  (SELECT count(*) FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = t.table_name)::text AS columns,
  (SELECT count(*) FROM pg_indexes i
    WHERE i.schemaname = 'public' AND i.tablename = t.table_name)::text AS indexes,
  (SELECT count(*) FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    WHERE cl.relname = t.table_name AND con.contype = 'c')::text AS check_constraints
FROM information_schema.tables t
WHERE t.table_schema = 'public'
  AND t.table_name IN (
    'LedgerCounter','LedgerInvoice','LedgerInvoiceLine',
    'LedgerPayment','LedgerAllocation','LedgerSettings'
  )
ORDER BY t.table_name;
