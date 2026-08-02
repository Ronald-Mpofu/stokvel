-- ============================================================
-- 2026-08-02-community-membership-stripe.sql
-- Phase 2 addendum — Stripe subscription columns
--
-- RUN AFTER both 2026-08-01 migrations.
-- Idempotent. Safe to re-run.
--
-- WHY
--   /api/joining-fee creates a Stripe Checkout session in SUBSCRIPTION
--   mode (scope MEMBER_ANNUAL), so the annual fee auto-renews and
--   Stripe — not this database — owns the renewal date.
--
--   Three consequences:
--     1. expiresAt must be written from the subscription's
--        current_period_end, never computed locally. Two clocks drift.
--     2. Opting out must cancel the subscription. Without the
--        subscription id stored here, there is nothing to cancel and
--        the member keeps being charged after they leave.
--     3. cancelAtPeriodEnd records that a cancellation is pending, so
--        the UI can say "active until 3 March, will not renew" rather
--        than showing a plain ACTIVE badge.
-- ============================================================

BEGIN;

ALTER TABLE "CommunityMembership"
  ADD COLUMN IF NOT EXISTS "stripeSubscriptionId" TEXT;

ALTER TABLE "CommunityMembership"
  ADD COLUMN IF NOT EXISTS "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;

-- Links a membership back to the JoiningFeeInvoice that paid for it.
-- Traceability from a membership row to the invoice, attempt and
-- provider reference that produced it.
ALTER TABLE "CommunityMembership"
  ADD COLUMN IF NOT EXISTS "lastInvoiceId" TEXT;

-- The webhook arrives holding a Stripe subscription id and must find
-- the membership from it.
CREATE INDEX IF NOT EXISTS "idx_communitymembership_stripesubscriptionid"
  ON "CommunityMembership" ("stripeSubscriptionId")
  WHERE "stripeSubscriptionId" IS NOT NULL;

-- Two new lifecycle events.
--   CANCELLATION_REQUESTED  member opted out; runs to period end
--   CANCELLATION_REVOKED    member resumed before period end
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_communitymembershipevent_event'
  ) THEN
    ALTER TABLE "CommunityMembershipEvent"
      DROP CONSTRAINT "chk_communitymembershipevent_event";
  END IF;

  ALTER TABLE "CommunityMembershipEvent"
    ADD CONSTRAINT "chk_communitymembershipevent_event"
    CHECK ("event" IN (
      'ENROLLED', 'RENEWED', 'OPTED_OUT', 'RESUMED',
      'EXPIRED', 'PAYMENT_FAILED', 'BACKFILLED', 'ADMIN_ADJUSTED',
      'CANCELLATION_REQUESTED', 'CANCELLATION_REVOKED'
    ));
END $$;


-- ── Confirmation ─────────────────────────────────────────────
SELECT
  COUNT(*)                                                        AS memberships_total,
  COUNT(*) FILTER (WHERE "stripeSubscriptionId" IS NOT NULL)      AS with_subscription,
  COUNT(*) FILTER (WHERE "cancelAtPeriodEnd")                     AS pending_cancellation,
  COUNT(*) FILTER (WHERE "autoRenew")                             AS auto_renewing
FROM "CommunityMembership";

COMMIT;

-- ============================================================
-- NOTE ON THE 4 BACKFILLED ROWS
-- They carry no stripeSubscriptionId, because they predate this
-- column. If any of those users holds a live Stripe subscription, it
-- cannot be cancelled through the opt-out flow until the id is
-- attached. The webhook will attach it on their next renewal. Until
-- then, treat opt-out for those four as a manual Stripe dashboard
-- action.
-- ============================================================
