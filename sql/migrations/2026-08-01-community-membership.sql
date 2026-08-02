-- ============================================================
-- 2026-08-01-community-membership.sql
-- Phase 1a — Community Membership entity + audit + shadow log
--
-- RUN THIS FIRST, before 2026-08-01-group-entitlement-columns.sql
-- and before deploying src/lib/entitlement/index.ts.
--
-- Idempotent. Safe to re-run.
--
-- WHAT THIS CREATES
--   "CommunityMembership"       one row per user; the ONLY clock for
--                               annual individual membership
--   "CommunityMembershipEvent"  append-only opt-in / opt-out / payment
--                               history — evidence for the
--                               non-refundable clause (rule 3f)
--   "EntitlementShadowLog"      phase-1 observation only; records who
--                               WOULD have been blocked. Deduped to one
--                               row per user per day.
--
-- NOTE ON TYPES
--   Currency is TEXT, not the CurrencyCode enum. Raw-SQL tables on this
--   platform deliberately avoid enum coupling so the reference data can
--   change without a Prisma migration.
--   status is TEXT with a CHECK, same reasoning.
-- ============================================================

BEGIN;

-- ── 1. CommunityMembership ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "CommunityMembership" (
  "id"                    TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId"                TEXT        NOT NULL,
  "status"                TEXT        NOT NULL DEFAULT 'ACTIVE',
  "startedAt"             TIMESTAMPTZ NOT NULL DEFAULT now(),
  "expiresAt"             TIMESTAMPTZ NOT NULL,
  "optedOutAt"            TIMESTAMPTZ,
  "remainingDaysAtOptOut" INTEGER,
  "autoRenew"             BOOLEAN     NOT NULL DEFAULT true,
  "currency"              TEXT        NOT NULL DEFAULT 'USD',
  "amountPaid"            NUMERIC(18,4),
  "stripeCustomerId"      TEXT,
  "lastPaymentIntentId"   TEXT,
  "source"                TEXT        NOT NULL DEFAULT 'DIRECT_REGISTRATION',
  "notes"                 TEXT,
  "createdAt"             TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One membership per user. The resolver relies on this being unique.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_communitymembership_userid"
  ON "CommunityMembership" ("userId");

-- Covers the resolver's lookup and the future renewal-reminder sweep.
CREATE INDEX IF NOT EXISTS "idx_communitymembership_status_expiresat"
  ON "CommunityMembership" ("status", "expiresAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_communitymembership_status'
  ) THEN
    ALTER TABLE "CommunityMembership"
      ADD CONSTRAINT "chk_communitymembership_status"
      CHECK ("status" IN ('ACTIVE', 'SUSPENDED', 'EXPIRED'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_communitymembership_source'
  ) THEN
    ALTER TABLE "CommunityMembership"
      ADD CONSTRAINT "chk_communitymembership_source"
      CHECK ("source" IN ('DIRECT_REGISTRATION', 'OPT_IN_FROM_INVITE', 'BACKFILL', 'ADMIN_GRANT'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_communitymembership_user'
  ) THEN
    ALTER TABLE "CommunityMembership"
      ADD CONSTRAINT "fk_communitymembership_user"
      FOREIGN KEY ("userId") REFERENCES "User"("id");
  END IF;
END $$;

-- SUSPENDED is the opt-out state (decision 5): remaining paid time is
-- preserved in remainingDaysAtOptOut and reused on re-entry. It is NOT
-- a termination. EXPIRED means the paid window elapsed without renewal.


-- ── 2. CommunityMembershipEvent (append-only) ────────────────
CREATE TABLE IF NOT EXISTS "CommunityMembershipEvent" (
  "id"           TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId"       TEXT        NOT NULL,
  "event"        TEXT        NOT NULL,
  "occurredAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "expiresAtBefore" TIMESTAMPTZ,
  "expiresAtAfter"  TIMESTAMPTZ,
  "amount"       NUMERIC(18,4),
  "currency"     TEXT,
  "paymentRef"   TEXT,
  "actorUserId"  TEXT,
  "ipAddress"    TEXT,
  "metadata"     JSONB,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now()
  -- NO updatedAt. This table is append-only, like Transaction and AuditLog.
);

CREATE INDEX IF NOT EXISTS "idx_communitymembershipevent_userid"
  ON "CommunityMembershipEvent" ("userId", "occurredAt" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_communitymembershipevent_event'
  ) THEN
    ALTER TABLE "CommunityMembershipEvent"
      ADD CONSTRAINT "chk_communitymembershipevent_event"
      CHECK ("event" IN (
        'ENROLLED', 'RENEWED', 'OPTED_OUT', 'RESUMED',
        'EXPIRED', 'PAYMENT_FAILED', 'BACKFILLED', 'ADMIN_ADJUSTED'
      ));
  END IF;
END $$;


-- ── 3. EntitlementShadowLog (phase 1 only) ───────────────────
-- Records users the resolver WOULD have blocked, had enforcement been
-- on. Deduped to one row per user per UTC day so the write cost stays
-- negligible — this is written on request paths.
--
-- DROP THIS TABLE once phase 5 enforcement is live and the log has been
-- reviewed. It is scaffolding, not permanent infrastructure.
CREATE TABLE IF NOT EXISTS "EntitlementShadowLog" (
  "id"          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId"      TEXT        NOT NULL,
  "day"         DATE        NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  "role"        TEXT,
  "reasons"     TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  "path"        TEXT,
  "hitCount"    INTEGER     NOT NULL DEFAULT 1,
  "firstSeenAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "lastSeenAt"  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_entitlementshadowlog_user_day"
  ON "EntitlementShadowLog" ("userId", "day");


-- ── 4. Backfill from the legacy joining-fee clock ────────────
-- User.joiningFeeExpiresAt is a raw-SQL column and may not exist on
-- every environment, so this is guarded by information_schema rather
-- than assumed. After this runs, joiningFeeExpiresAt is LEGACY: read it
-- if you like, never write it again.
DO $$
DECLARE
  v_has_col   BOOLEAN;
  v_inserted  INTEGER := 0;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'User' AND column_name = 'joiningFeeExpiresAt'
  ) INTO v_has_col;

  IF NOT v_has_col THEN
    RAISE NOTICE 'joiningFeeExpiresAt not present — skipping backfill (nothing to migrate).';
    RETURN;
  END IF;

  EXECUTE $sql$
    INSERT INTO "CommunityMembership"
      ("userId", "status", "startedAt", "expiresAt", "currency", "source", "notes")
    SELECT
      u."id",
      CASE WHEN u."joiningFeeExpiresAt" > now() THEN 'ACTIVE' ELSE 'EXPIRED' END,
      COALESCE(u."createdAt", now()),
      u."joiningFeeExpiresAt",
      COALESCE(u."preferredCurrency"::text, 'USD'),
      'BACKFILL',
      'Migrated from User.joiningFeeExpiresAt on 2026-08-01'
    FROM "User" u
    WHERE u."joiningFeeExpiresAt" IS NOT NULL
      AND u."deletedAt" IS NULL
    ON CONFLICT ("userId") DO NOTHING
  $sql$;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  EXECUTE $sql$
    INSERT INTO "CommunityMembershipEvent"
      ("userId", "event", "expiresAtAfter", "metadata")
    SELECT cm."userId", 'BACKFILLED', cm."expiresAt",
           jsonb_build_object('migration', '2026-08-01-community-membership')
    FROM "CommunityMembership" cm
    WHERE cm."source" = 'BACKFILL'
      AND NOT EXISTS (
        SELECT 1 FROM "CommunityMembershipEvent" e
        WHERE e."userId" = cm."userId" AND e."event" = 'BACKFILLED'
      )
  $sql$;

  RAISE NOTICE 'Backfilled % community membership row(s).', v_inserted;
END $$;


-- ── 5. Confirmation ──────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM "CommunityMembership")                              AS memberships_total,
  (SELECT COUNT(*) FROM "CommunityMembership" WHERE "status" = 'ACTIVE')    AS memberships_active,
  (SELECT COUNT(*) FROM "CommunityMembership" WHERE "status" = 'EXPIRED')   AS memberships_expired,
  (SELECT COUNT(*) FROM "CommunityMembershipEvent")                         AS events_total,
  (SELECT COUNT(*) FROM "EntitlementShadowLog")                             AS shadow_rows;

COMMIT;
