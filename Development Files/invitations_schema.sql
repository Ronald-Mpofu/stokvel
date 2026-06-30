-- ============================================================
-- INVITATIONS SCHEMA — Run in Supabase SQL Editor
-- ============================================================

-- Enums
DO $$ BEGIN CREATE TYPE "InvitationStatus" AS ENUM ('PENDING','ACCEPTED','EXPIRED','CANCELLED','RESENT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE "InvitationChannel" AS ENUM ('EMAIL','SMS','BOTH');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- MemberInvitation table
CREATE TABLE IF NOT EXISTS "MemberInvitation" (
  "id"              TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "groupId"         TEXT NOT NULL,
  "invitedById"     TEXT NOT NULL,
  "email"           TEXT,
  "phone"           TEXT,
  "fullName"        TEXT,
  "role"            TEXT NOT NULL DEFAULT 'MEMBER',
  "token"           TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "status"          "InvitationStatus" NOT NULL DEFAULT 'PENDING',
  "channel"         "InvitationChannel" NOT NULL DEFAULT 'BOTH',
  "expiresAt"       TIMESTAMP(3) NOT NULL,
  "acceptedAt"      TIMESTAMP(3),
  "cancelledAt"     TIMESTAMP(3),
  "acceptedUserId"  TEXT,
  "personalMessage" TEXT,
  "emailSentAt"     TIMESTAMP(3),
  "smsSentAt"       TIMESTAMP(3),
  "reminderSentAt"  TIMESTAMP(3),
  "resendCount"     INTEGER NOT NULL DEFAULT 0,
  "ipAddress"       TEXT,
  "userAgent"       TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MemberInvitation_pkey"  PRIMARY KEY ("id"),
  CONSTRAINT "MemberInvitation_token_key" UNIQUE ("token")
);

CREATE INDEX IF NOT EXISTS "MemberInvitation_groupId_idx" ON "MemberInvitation"("groupId");
CREATE INDEX IF NOT EXISTS "MemberInvitation_token_idx"   ON "MemberInvitation"("token");
CREATE INDEX IF NOT EXISTS "MemberInvitation_status_idx"  ON "MemberInvitation"("status");
CREATE INDEX IF NOT EXISTS "MemberInvitation_email_idx"   ON "MemberInvitation"("email");

SELECT 'Invitations schema created' AS status;
