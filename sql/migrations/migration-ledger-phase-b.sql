-- ============================================================
-- Windfall Community Deals
-- Migration: Ledger Phase B — DUE status, reminders, escalation
--
-- Run in the Supabase SQL Editor BEFORE deploying Phase B code.
-- Safe to re-run.
--
-- WHAT CHANGES AND WHY
--   1. LedgerInvoice gains a DUE status. Phase A went straight from
--      ISSUED to OVERDUE, so an invoice due TODAY was indistinguishable
--      from one three weeks late. "Due" and "late" mean very different
--      things to a member, and to the treasurer chasing them.
--   2. Reminder tracking, so the notification sweep cannot send the
--      same reminder twice.
--   3. LedgerSettings gains the reminder window (default 3 days, to
--      BOTH parties as agreed) and the arrears grace period.
--   4. LedgerPayment gains escalation tracking for the treasurer queue.
-- ============================================================


-- ── 1. Add DUE to the invoice status vocabulary ──────────────
-- Status flow becomes:
--   ISSUED  → raised, not yet due
--   DUE     → due today or later, not yet late
--   OVERDUE → past the due date plus any grace period
--   PART_PAID / PAID / CANCELLED / WRITTEN_OFF as before

ALTER TABLE "LedgerInvoice"
  DROP CONSTRAINT IF EXISTS "LedgerInvoice_status_check";

ALTER TABLE "LedgerInvoice"
  ADD CONSTRAINT "LedgerInvoice_status_check"
  CHECK (status IN ('DRAFT','ISSUED','DUE','PART_PAID','PAID','OVERDUE','CANCELLED','WRITTEN_OFF'));


-- ── 2. Reminder tracking on the invoice ──────────────────────
-- reminderSentAt makes the sweep idempotent: it runs daily and must
-- never send a member the same reminder twice.

ALTER TABLE "LedgerInvoice" ADD COLUMN IF NOT EXISTS "reminderSentAt"  TIMESTAMP;
ALTER TABLE "LedgerInvoice" ADD COLUMN IF NOT EXISTS "dueNoticeSentAt" TIMESTAMP;
ALTER TABLE "LedgerInvoice" ADD COLUMN IF NOT EXISTS "overdueNoticeSentAt" TIMESTAMP;

-- Drives the reminder sweep. Partial, so it only indexes invoices that
-- can still receive one.
CREATE INDEX IF NOT EXISTS "idx_ledgerinvoice_reminder_due"
  ON "LedgerInvoice" ("dueDate")
  WHERE "reminderSentAt" IS NULL
    AND status IN ('ISSUED','DUE','PART_PAID');


-- ── 3. Settings: reminder window and grace period ────────────

ALTER TABLE "LedgerSettings"
  ADD COLUMN IF NOT EXISTS "reminderDaysBefore" INTEGER NOT NULL DEFAULT 3;

ALTER TABLE "LedgerSettings"
  ADD COLUMN IF NOT EXISTS "remindBothParties" BOOLEAN NOT NULL DEFAULT true;

-- Days after the due date before an invoice is called OVERDUE. Zero
-- means overdue the moment the date passes. A small grace period stops
-- a member being marked delinquent over a weekend bank delay.
ALTER TABLE "LedgerSettings"
  ADD COLUMN IF NOT EXISTS "arrearsGraceDays" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "LedgerSettings"
  DROP CONSTRAINT IF EXISTS "LedgerSettings_reminder_check";

ALTER TABLE "LedgerSettings"
  ADD CONSTRAINT "LedgerSettings_reminder_check"
  CHECK ("reminderDaysBefore" BETWEEN 0 AND 30 AND "arrearsGraceDays" BETWEEN 0 AND 30);


-- ── 4. Escalation tracking on payments ───────────────────────
-- When a payer lodges an attestation and the recipient does not respond
-- within the confirmation window, the payment escalates to the
-- treasurer. escalatedAt records that handover so the treasurer queue
-- is a simple indexed read rather than a date calculation per row.

ALTER TABLE "LedgerPayment" ADD COLUMN IF NOT EXISTS "escalatedAt"       TIMESTAMP;
ALTER TABLE "LedgerPayment" ADD COLUMN IF NOT EXISTS "escalationNotified" BOOLEAN NOT NULL DEFAULT false;

-- Who recorded the payment: the recipient confirming receipt directly
-- (the happy path), or the payer lodging an attestation awaiting
-- confirmation. The distinction matters in a dispute.
ALTER TABLE "LedgerPayment" ADD COLUMN IF NOT EXISTS "recordedBy" TEXT NOT NULL DEFAULT 'RECIPIENT';

ALTER TABLE "LedgerPayment"
  DROP CONSTRAINT IF EXISTS "LedgerPayment_recordedBy_check";

ALTER TABLE "LedgerPayment"
  ADD CONSTRAINT "LedgerPayment_recordedBy_check"
  CHECK ("recordedBy" IN ('RECIPIENT','PAYER','TREASURER'));

CREATE INDEX IF NOT EXISTS "idx_ledgerpayment_escalated"
  ON "LedgerPayment" ("groupId", "escalatedAt")
  WHERE status = 'SENT_UNCONFIRMED' AND "escalatedAt" IS NOT NULL;


-- ── 5. Link payments to the posted GL transaction ────────────
-- Set when a confirmed payment is posted to the general ledger, so a
-- payment can be traced to its double-entry pair and the posting step
-- is idempotent.

ALTER TABLE "LedgerPayment" ADD COLUMN IF NOT EXISTS "transactionId" TEXT;
ALTER TABLE "LedgerPayment" ADD COLUMN IF NOT EXISTS "postedAt"      TIMESTAMP;

CREATE INDEX IF NOT EXISTS "idx_ledgerpayment_unposted"
  ON "LedgerPayment" (id)
  WHERE status = 'CONFIRMED' AND "postedAt" IS NULL;


-- ── 6. Backfill existing invoices into the new statuses ──────
-- Phase A invoices are all ISSUED. Place them correctly so the first
-- sweep does not have to reason about a mixed population.

UPDATE "LedgerInvoice"
   SET status = 'DUE', "updatedAt" = CURRENT_TIMESTAMP
 WHERE status = 'ISSUED'
   AND "dueDate"::date <= CURRENT_DATE
   AND "dueDate"::date >= CURRENT_DATE - INTERVAL '0 day';

UPDATE "LedgerInvoice"
   SET status = 'OVERDUE', "updatedAt" = CURRENT_TIMESTAMP
 WHERE status IN ('ISSUED','DUE')
   AND "dueDate"::date < CURRENT_DATE;


-- ── Confirmation ─────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM "LedgerInvoice" WHERE status = 'ISSUED')::text  AS issued,
  (SELECT count(*) FROM "LedgerInvoice" WHERE status = 'DUE')::text     AS due,
  (SELECT count(*) FROM "LedgerInvoice" WHERE status = 'OVERDUE')::text AS overdue,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='LedgerSettings')::text   AS settings_columns,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='LedgerPayment')::text    AS payment_columns,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='LedgerInvoice')::text    AS invoice_columns;
