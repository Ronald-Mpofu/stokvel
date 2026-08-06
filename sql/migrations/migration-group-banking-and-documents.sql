-- ============================================================
-- Windfall Community Deals
-- Migration: Group bank accounts, mandate signatories, documents
--
-- Run in the Supabase SQL Editor BEFORE deploying the code.
-- Safe to re-run: every object uses IF NOT EXISTS.
--
-- DESIGN NOTES
--   1. These tables are NOT in schema.prisma. They are accessed only
--      via $queryRawUnsafe / $executeRawUnsafe.
--   2. Status and type columns are TEXT + CHECK, not Postgres enums.
--      New enum types would need explicit $n::"Type" casts in every
--      raw query and cannot be extended inside a transaction. CHECK
--      constraints give the same integrity with none of that friction.
--   3. currency is TEXT, matching the convention on every other
--      raw-SQL table on this platform.
--   4. deletedAt exists from day one. Financial records are never
--      hard-deleted; this avoids a soft-delete retrofit later.
--   5. No RLS policies. All access runs through API routes that hold
--      the session and role checks, keeping authorisation in one place.
-- ============================================================


-- ── 1. GroupBankAccount ──────────────────────────────────────
-- Where a group's own money lives. Windfall never holds these funds;
-- this records the destination so contributions and payouts can be
-- instructed and reconciled.
--
-- Column vocabulary deliberately mirrors RefPaymentDestination
-- (bankName / accountName / accountNumber / branchName / branchCode /
-- swiftCode / walletNumber / walletName) so both tables read the same.

CREATE TABLE IF NOT EXISTS "GroupBankAccount" (
  id                   TEXT PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  "groupId"            TEXT NOT NULL,
  "accountType"        TEXT NOT NULL DEFAULT 'BANK',
  -- Bank fields
  "bankName"           TEXT,
  "accountName"        TEXT NOT NULL,
  "accountNumber"      TEXT,
  "branchName"         TEXT,
  "branchCode"         TEXT,
  "swiftCode"          TEXT,
  -- Mobile wallet fields
  "walletProvider"     TEXT,
  "walletNumber"       TEXT,
  "walletName"         TEXT,
  -- Common
  currency             TEXT NOT NULL DEFAULT 'USD',
  country              TEXT,
  "signatoriesRequired" INTEGER NOT NULL DEFAULT 2,
  "isPrimary"          BOOLEAN NOT NULL DEFAULT false,
  status               TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
  "verifiedAt"         TIMESTAMP,
  "verifiedById"       TEXT,
  notes                TEXT,
  "createdById"        TEXT,
  "createdAt"          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"          TIMESTAMP,

  CONSTRAINT "GroupBankAccount_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "Group"(id) ON DELETE RESTRICT,

  CONSTRAINT "GroupBankAccount_accountType_check"
    CHECK ("accountType" IN ('BANK','MOBILE_WALLET')),

  CONSTRAINT "GroupBankAccount_status_check"
    CHECK (status IN ('PENDING_VERIFICATION','ACTIVE','SUSPENDED','CLOSED')),

  CONSTRAINT "GroupBankAccount_signatoriesRequired_check"
    CHECK ("signatoriesRequired" >= 1 AND "signatoriesRequired" <= 10),

  -- A bank account needs a number; a wallet needs a wallet number.
  -- Without this, a half-filled record can reach ACTIVE and be used
  -- as a payout destination with nothing to pay to.
  CONSTRAINT "GroupBankAccount_identifier_check"
    CHECK (
      ("accountType" = 'BANK'          AND "accountNumber" IS NOT NULL AND length(trim("accountNumber")) > 0)
      OR
      ("accountType" = 'MOBILE_WALLET' AND "walletNumber"  IS NOT NULL AND length(trim("walletNumber"))  > 0)
    )
);

CREATE INDEX IF NOT EXISTS "idx_groupbankaccount_groupid"
  ON "GroupBankAccount" ("groupId") WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_groupbankaccount_groupid_status"
  ON "GroupBankAccount" ("groupId", status) WHERE "deletedAt" IS NULL;

-- One primary account per group per currency. Partial, so soft-deleted
-- and non-primary rows never collide.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_groupbankaccount_one_primary"
  ON "GroupBankAccount" ("groupId", currency)
  WHERE "isPrimary" = true AND "deletedAt" IS NULL;


-- ── 2. GroupSignatory ────────────────────────────────────────
-- Who is mandated to move money on a given account. Mandate is per
-- ACCOUNT, not per group: a group may run a current account and a
-- fixed deposit with different mandates.
--
-- userId is NOT NULL. Signatories are drawn from existing group
-- members only, so every row resolves to a real User.

CREATE TABLE IF NOT EXISTS "GroupSignatory" (
  id               TEXT PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  "groupId"        TEXT NOT NULL,
  "bankAccountId"  TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "mandateRole"    TEXT NOT NULL DEFAULT 'MEMBER',
  status           TEXT NOT NULL DEFAULT 'ACTIVE',
  "appointedAt"    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appointedById"  TEXT,
  "resignedAt"     TIMESTAMP,
  "resignedReason" TEXT,
  "createdAt"      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GroupSignatory_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "Group"(id) ON DELETE RESTRICT,

  -- Cascade: a signatory row has no meaning without its account.
  CONSTRAINT "GroupSignatory_bankAccountId_fkey"
    FOREIGN KEY ("bankAccountId") REFERENCES "GroupBankAccount"(id) ON DELETE CASCADE,

  CONSTRAINT "GroupSignatory_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE RESTRICT,

  CONSTRAINT "GroupSignatory_mandateRole_check"
    CHECK ("mandateRole" IN ('CHAIRPERSON','SECRETARY','TREASURER','MEMBER')),

  CONSTRAINT "GroupSignatory_status_check"
    CHECK (status IN ('ACTIVE','RESIGNED','REMOVED'))
);

CREATE INDEX IF NOT EXISTS "idx_groupsignatory_account"
  ON "GroupSignatory" ("bankAccountId", status);

CREATE INDEX IF NOT EXISTS "idx_groupsignatory_group"
  ON "GroupSignatory" ("groupId", status);

CREATE INDEX IF NOT EXISTS "idx_groupsignatory_user"
  ON "GroupSignatory" ("userId", status);

-- One ACTIVE mandate per person per account. Partial, so a resigned
-- signatory can later be re-appointed without a constraint violation
-- and the resignation history is preserved.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_groupsignatory_one_active"
  ON "GroupSignatory" ("bankAccountId", "userId")
  WHERE status = 'ACTIVE';


-- ── 3. GroupDocument ─────────────────────────────────────────
-- Versioned group documents held in the private 'group-documents'
-- Supabase Storage bucket. Rows hold metadata and the object key;
-- bytes never enter Postgres.
--
-- Versioning is not decoration. A constitution gets amended, and the
-- bank may still be acting on the version it holds, so a superseded
-- document must stay retrievable.

CREATE TABLE IF NOT EXISTS "GroupDocument" (
  id               TEXT PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  "groupId"        TEXT NOT NULL,
  "docType"        TEXT NOT NULL,
  title            TEXT NOT NULL,
  "storagePath"    TEXT NOT NULL,
  "fileName"       TEXT NOT NULL,
  "mimeType"       TEXT NOT NULL,
  "sizeBytes"      INTEGER NOT NULL DEFAULT 0,
  version          INTEGER NOT NULL DEFAULT 1,
  "isCurrent"      BOOLEAN NOT NULL DEFAULT true,
  "uploadedById"   TEXT,
  "uploadedAt"     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "supersededAt"   TIMESTAMP,
  notes            TEXT,
  "createdAt"      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"      TIMESTAMP,

  CONSTRAINT "GroupDocument_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "Group"(id) ON DELETE RESTRICT,

  CONSTRAINT "GroupDocument_docType_check"
    CHECK ("docType" IN ('CONSTITUTION','WELCOME_LETTER','DISMISSAL_LETTER','RESOLUTION','OTHER')),

  CONSTRAINT "GroupDocument_version_check"
    CHECK (version >= 1),

  CONSTRAINT "GroupDocument_sizeBytes_check"
    CHECK ("sizeBytes" >= 0)
);

CREATE INDEX IF NOT EXISTS "idx_groupdocument_group"
  ON "GroupDocument" ("groupId") WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_groupdocument_group_type"
  ON "GroupDocument" ("groupId", "docType") WHERE "deletedAt" IS NULL;

-- Exactly one current document per type per group.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_groupdocument_one_current"
  ON "GroupDocument" ("groupId", "docType")
  WHERE "isCurrent" = true AND "deletedAt" IS NULL;

-- Version numbers never repeat within a group + type.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_groupdocument_version"
  ON "GroupDocument" ("groupId", "docType", version)
  WHERE "deletedAt" IS NULL;


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
  AND t.table_name IN ('GroupBankAccount','GroupSignatory','GroupDocument')
ORDER BY t.table_name;
