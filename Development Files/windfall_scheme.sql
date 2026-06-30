-- WindfallScheme table
DO $$ BEGIN
  CREATE TYPE "WindfallSchemeType" AS ENUM (
    'GROCERY_CLUB','SAVINGS_POOL','PROPERTY','LOANS','INVESTMENT','ASSETS'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "WindfallSchemeStatus" AS ENUM ('ACTIVE','PAUSED','CLOSED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "WindfallScheme" (
  "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "groupId"     TEXT NOT NULL,
  "schemeType"  "WindfallSchemeType" NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "status"      "WindfallSchemeStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WindfallScheme_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WindfallScheme_groupId_idx" ON "WindfallScheme"("groupId");
CREATE INDEX IF NOT EXISTS "WindfallScheme_status_idx"  ON "WindfallScheme"("status");

SELECT 'WindfallScheme table created' AS status;
