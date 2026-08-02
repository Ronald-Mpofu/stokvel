-- ============================================================
-- 2026-08-03-notifications.sql
-- Phase 4a — notification dedupe, read state, group scoping
--
-- Idempotent. Safe to re-run.
--
-- WHY
--   The Notification model already exists in schema.prisma with
--   channel, status, subject, body, templateId, metadata and the
--   sent/delivered/failed timestamps. Three things are missing before
--   it can back a reminder system:
--
--   dedupeKey   The cron will run daily and Vercel may retry it. A
--               reminder must be sendable EXACTLY once. A unique index
--               on this column is what makes the whole sweep safe to
--               re-run — without it, a retry double-sends and the
--               member gets two "your membership expires" emails.
--
--   readAt      IN_APP notifications need read state. sentAt says the
--               row was created; it says nothing about whether anyone
--               looked at it.
--
--   groupId     Group subscription notices belong to a group, not just
--               a user. Needed to render "your group X" and to scope
--               an admin's notification list.
-- ============================================================

BEGIN;

-- ── 1. Columns ───────────────────────────────────────────────
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "readAt"    TIMESTAMPTZ;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "groupId"   TEXT;

-- ── 2. Dedupe ────────────────────────────────────────────────
-- Partial, so rows written before this migration (dedupeKey NULL) do
-- not collide with each other. Every new send supplies a key.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_notification_dedupekey"
  ON "Notification" ("dedupeKey")
  WHERE "dedupeKey" IS NOT NULL;

-- ── 3. Read the unread list cheaply ──────────────────────────
-- Drives the bell badge: one index scan, no sequential read.
CREATE INDEX IF NOT EXISTS "idx_notification_user_unread"
  ON "Notification" ("userId", "createdAt" DESC)
  WHERE "channel" = 'IN_APP'::"NotificationChannel" AND "readAt" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_notification_user_channel"
  ON "Notification" ("userId", "channel", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "idx_notification_groupid"
  ON "Notification" ("groupId")
  WHERE "groupId" IS NOT NULL;

-- ── 4. Confirmation ──────────────────────────────────────────
SELECT
  COUNT(*)                                            AS notifications_total,
  COUNT(*) FILTER (WHERE "dedupeKey" IS NOT NULL)     AS with_dedupe_key,
  COUNT(*) FILTER (WHERE "channel" = 'IN_APP'::"NotificationChannel") AS in_app,
  COUNT(*) FILTER (WHERE "readAt" IS NOT NULL)        AS read_rows
FROM "Notification";

COMMIT;

-- ============================================================
-- schema.prisma
-- These three columns are raw SQL and NOT in the Prisma model. Access
-- them with $queryRawUnsafe only — never add them to a Prisma select,
-- or add them to the model and regenerate. Given Notification is
-- already a Prisma model, adding them to schema.prisma is the tidier
-- option:
--
--   dedupeKey   String?   @unique
--   readAt      DateTime?
--   groupId     String?
--
-- then `npx prisma generate`. No migration needed — the columns exist
-- after this file runs.
-- ============================================================
