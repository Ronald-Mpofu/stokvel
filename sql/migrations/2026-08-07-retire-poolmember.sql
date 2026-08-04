-- ============================================================
-- 2026-08-07-retire-poolmember.sql
--
-- PART 1 is READ ONLY. Run it and read the output BEFORE part 2.
-- PART 2 ends in ROLLBACK.
--
-- ── WHY ──────────────────────────────────────────────────────
-- "Pool membership" exists twice, in two incompatible forms:
--
--   PoolMember            own record keyed by email, no link to User.
--                         Marking one PAID grants NOTHING — the
--                         entitlement resolver has never heard of it.
--
--   CommunityMembership   keyed by userId. Drives everything: advert
--                         visibility, renewal reminders, opt-out,
--                         receipts, and the transaction gate.
--
-- The business rules are already implemented — on CommunityMembership:
--
--   · pay the annual fee  → membership ACTIVE → canSeeAdverts true
--   · invited into a group → exempt (rule 3b), no adverts
--   · invited member opts in → pays → gains adverts (rule 3f)
--
-- PoolMember is the pre-rename artefact that never got migrated. It is
-- why marking someone paid there appears to do nothing.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- PART 1 — WHAT IS IN THERE   (read only)
-- ════════════════════════════════════════════════════════════

SELECT
  (SELECT COUNT(*) FROM "PoolMember")                                        AS pool_members,
  (SELECT COUNT(*) FROM "PoolMember" WHERE "joiningFeeStatus" = 'PAID')      AS marked_paid,
  (SELECT COUNT(*) FROM "PoolMemberGroupInvite")                             AS invites;

-- Anyone marked PAID here who has a real account is owed a
-- CommunityMembership. matching_user null means they never registered,
-- so there is no account to attach anything to.
SELECT pm.email, pm."firstName", pm."lastName", pm.status,
       pm."joiningFeeStatus", pm."joiningFeeAmount", pm.currency,
       pm."joiningFeeExpiry", pm."createdAt",
       u.id                                    AS matching_user,
       (cm."userId" IS NOT NULL)               AS already_has_membership
FROM "PoolMember" pm
LEFT JOIN "User" u
  ON lower(u.email) = lower(pm.email) AND u."deletedAt" IS NULL
LEFT JOIN "CommunityMembership" cm ON cm."userId" = u.id
ORDER BY pm."createdAt" DESC;


-- ════════════════════════════════════════════════════════════
-- PART 2 — MIGRATE, THEN DROP
--
-- Ends in ROLLBACK. Change to COMMIT once part 1 looks right.
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ── 2a. Carry PAID records across ────────────────────────────
-- Only where a real User exists and has no membership already. A paid
-- record without an account cannot be migrated — there is nothing to
-- attach it to, and part 1 lists those so they can be handled by hand.
INSERT INTO "CommunityMembership"
  ("userId", "status", "startedAt", "expiresAt", "currency", "source", "notes", "autoRenew")
SELECT
  u.id,
  CASE WHEN COALESCE(pm."joiningFeeExpiry", now() + interval '12 months') > now()
       THEN 'ACTIVE' ELSE 'EXPIRED' END,
  COALESCE(pm."createdAt", now()),
  COALESCE(pm."joiningFeeExpiry", pm."createdAt" + interval '12 months', now() + interval '12 months'),
  COALESCE(pm.currency, 'USD'),
  'ADMIN_GRANT',
  'Migrated from PoolMember on 2026-08-07',
  false
FROM "PoolMember" pm
JOIN "User" u ON lower(u.email) = lower(pm.email) AND u."deletedAt" IS NULL
WHERE pm."joiningFeeStatus" = 'PAID'
ON CONFLICT ("userId") DO NOTHING;

INSERT INTO "CommunityMembershipEvent" ("userId", "event", "expiresAtAfter", "metadata")
SELECT cm."userId", 'ADMIN_ADJUSTED', cm."expiresAt",
       jsonb_build_object('migration', 'PoolMember retirement')
FROM "CommunityMembership" cm
WHERE cm."notes" = 'Migrated from PoolMember on 2026-08-07';

-- Keep the legacy fee columns in step, exactly as the webhook and the
-- manual verification route do. Middleware no longer reads them, but
-- login and refresh still mint the claim from them.
UPDATE "User" u
SET "joiningFeePaid" = true,
    "joiningFeePaidAt" = COALESCE(u."joiningFeePaidAt", now()),
    "joiningFeeExpiresAt" = cm."expiresAt",
    "updatedAt" = now()
FROM "CommunityMembership" cm
WHERE cm."userId" = u.id
  AND cm."notes" = 'Migrated from PoolMember on 2026-08-07'
  AND cm."status" = 'ACTIVE';

-- ── 2b. Drop the parallel model ──────────────────────────────
-- Invites first: PoolMemberGroupInvite references PoolMember.
DROP TABLE IF EXISTS "PoolMemberGroupInvite";
DROP TABLE IF EXISTS "PoolMember";

-- ── 2c. Confirmation ─────────────────────────────────────────
SELECT
  to_regclass('public."PoolMember"')                                       AS poolmember_table,
  to_regclass('public."PoolMemberGroupInvite"')                            AS invite_table,
  (SELECT COUNT(*) FROM "CommunityMembership")                             AS memberships_total,
  (SELECT COUNT(*) FROM "CommunityMembership"
     WHERE "notes" = 'Migrated from PoolMember on 2026-08-07')             AS migrated;

-- Change to COMMIT only after reading the output above.
ROLLBACK;

-- ============================================================
-- AFTER COMMITTING, delete the routes that read these tables:
--   git rm src/app/api/pool-members/route.ts
--   git rm src/app/api/pool-member-invites/route.ts
--   git rm src/app/api/auth/route.ts        (stale duplicate of refresh)
--
-- Then check nothing in the UI still calls them:
--   grep -rn "api/pool-member" src --include=*.tsx
-- ============================================================
