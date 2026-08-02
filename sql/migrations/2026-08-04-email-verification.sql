-- ============================================================
-- 2026-08-04-email-verification.sql
-- Phase 6a — email verification tokens
--
-- Idempotent. Safe to re-run.
--
-- ── DESIGN ───────────────────────────────────────────────────
-- Mirrors PasswordResetToken: only the SHA-256 HASH of the token is
-- stored. A database leak then yields nothing usable — the raw token
-- exists only in the email that was sent.
--
-- Single-use via usedAt, and expiring via expiresAt. Both are checked
-- at verification time; neither is trusted on its own.
--
-- ── GRANDFATHERING ───────────────────────────────────────────
-- Existing users are marked verified. They registered before this
-- feature existed and have in some cases already paid — retroactively
-- marking them unverified would flood the entitlement shadow log with
-- people who did nothing wrong, and would block them at phase 5.
--
-- Only accounts created from here on need to verify.
-- ============================================================

BEGIN;

-- ── 1. Token table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "EmailVerificationToken" (
  "id"        TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId"    TEXT        NOT NULL,
  "email"     TEXT        NOT NULL,   -- the address verified, in case it changes later
  "tokenHash" TEXT        NOT NULL,   -- SHA-256 of the raw token. NEVER the raw token.
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "usedAt"    TIMESTAMPTZ,
  "ipAddress" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_emailverificationtoken_hash"
  ON "EmailVerificationToken" ("tokenHash");

-- Supports both the resend rate limit and the per-user lookup.
CREATE INDEX IF NOT EXISTS "idx_emailverificationtoken_user"
  ON "EmailVerificationToken" ("userId", "createdAt" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_emailverificationtoken_user'
  ) THEN
    ALTER TABLE "EmailVerificationToken"
      ADD CONSTRAINT "fk_emailverificationtoken_user"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- ── 2. Grandfather existing accounts ─────────────────────────
-- See the note above. createdAt rather than now(), so the timestamp
-- reads honestly as "verified as of registration" rather than
-- suggesting they clicked a link today.
UPDATE "User"
SET "emailVerifiedAt" = COALESCE("emailVerifiedAt", "createdAt")
WHERE "emailVerifiedAt" IS NULL
  AND "deletedAt" IS NULL;

-- ── 3. Confirmation ──────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM "EmailVerificationToken")                       AS tokens_total,
  (SELECT COUNT(*) FROM "User"
    WHERE "emailVerifiedAt" IS NOT NULL AND "deletedAt" IS NULL)        AS users_verified,
  (SELECT COUNT(*) FROM "User"
    WHERE "emailVerifiedAt" IS NULL AND "deletedAt" IS NULL)            AS users_unverified;

COMMIT;
