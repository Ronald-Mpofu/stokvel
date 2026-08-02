-- ============================================================
-- purge-single-user.sql
--
-- PART 1 is READ ONLY — run it first and read the output.
-- PART 2 deletes, and defaults to ROLLBACK. It does NOT commit
-- until you deliberately change the last line.
--
-- Set the email once, here:
--   \set target_email 'ronald.mpofu@gmail.com'
-- Supabase SQL Editor does not support \set, so the address is
-- inlined below. Change it in BOTH parts if you reuse this.
--
-- ── WHY DYNAMIC ──────────────────────────────────────────────
-- Hardcoding a table list guarantees a missed one. This walks
-- information_schema for every column that references a user, so it
-- picks up the raw-SQL tables (CommunityMembership, JoiningFeeInvoice,
-- PaymentAttempt, PlatformSubscription, PoolMemberGroupInvite,
-- EntitlementShadowLog) that carry no foreign key at all — which is
-- exactly where orphans hide.
--
-- ── NULLABLE vs NOT NULL ─────────────────────────────────────
-- Nullable references (approvedById, invitedById, referredById,
-- treasurerId...) are SET NULL: the row belongs to someone else and
-- must survive. NOT NULL references are DELETEd: the row cannot exist
-- without its user.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- PART 1 — WHAT IS THERE  (read only)
-- ════════════════════════════════════════════════════════════

-- ── 1a. The user ─────────────────────────────────────────────
SELECT id, email, "fullName", role::text, status::text, "createdAt", "deletedAt"
FROM "User"
WHERE lower(email) = lower('ronald.mpofu@gmail.com');


-- ── 1b. The blocking transactions ────────────────────────────
-- A joining fee paid by card produces type='FEE', status='COMPLETED',
-- inserted by settleAttempt in the Stripe webhook.
SELECT
  t."id", t."type"::text, t."status"::text, t."amount", t."currency"::text,
  t."description", t."externalRef", t."createdAt"
FROM "Transaction" t
JOIN "User" u ON u.id = t."userId"
WHERE lower(u.email) = lower('ronald.mpofu@gmail.com')
ORDER BY t."createdAt" DESC;


-- ── 1c. Every table holding a reference, with row counts ─────
-- Anything with count > 0 is what a hard delete would orphan.
DO $$
DECLARE
  v_uid  TEXT;
  r      RECORD;
  n      BIGINT;
BEGIN
  SELECT id INTO v_uid FROM "User"
   WHERE lower(email) = lower('ronald.mpofu@gmail.com');

  IF v_uid IS NULL THEN
    RAISE NOTICE 'No user with that email.';
    RETURN;
  END IF;

  RAISE NOTICE 'User id: %', v_uid;
  RAISE NOTICE '--- references ---';

  FOR r IN
    SELECT c.table_name, c.column_name, c.is_nullable
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.data_type IN ('text', 'character varying', 'uuid')
      AND (
        c.column_name ILIKE '%userid%'
        OR c.column_name IN (
          'invitedBy', 'approvedById', 'recordedById', 'createdById',
          'referredById', 'treasurerId', 'secretaryId', 'managerId',
          'adminUserId', 'authorisedById', 'resolvedById', 'submittedBy',
          'borrowerId', 'recipientId', 'raisedById', 'againstUserId',
          'verifiedBy', 'kycReviewedBy', 'approvedById', 'rejectedBy',
          'linkedUserId', 'acceptedUserId', 'actorUserId'
        )
      )
      AND NOT (c.table_name = 'User' AND c.column_name = 'id')
    ORDER BY c.table_name, c.column_name
  LOOP
    BEGIN
      EXECUTE format('SELECT COUNT(*) FROM %I WHERE %I = $1', r.table_name, r.column_name)
        INTO n USING v_uid;
      IF n > 0 THEN
        RAISE NOTICE '  % . %  →  % row(s)   [%]',
          rpad(r.table_name, 28), rpad(r.column_name, 20), n,
          CASE WHEN r.is_nullable = 'YES' THEN 'SET NULL' ELSE 'DELETE' END;
      END IF;
    EXCEPTION WHEN others THEN
      RAISE NOTICE '  % . %  →  skipped (%)', r.table_name, r.column_name, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE '--- end ---';
END $$;


-- ════════════════════════════════════════════════════════════
-- PART 2 — PURGE
--
-- Defaults to ROLLBACK. Read the NOTICE output, and only then
-- change the final ROLLBACK to COMMIT and re-run.
-- ════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_uid    TEXT;
  r        RECORD;
  n        BIGINT;
  v_total  BIGINT := 0;
BEGIN
  SELECT id INTO v_uid FROM "User"
   WHERE lower(email) = lower('ronald.mpofu@gmail.com');

  IF v_uid IS NULL THEN
    RAISE NOTICE 'No user with that email — nothing to do.';
    RETURN;
  END IF;

  -- Refuse to run against a user who still belongs to a group. A group
  -- member has cycles, contributions and stakes behind them, and this
  -- script is not the right tool for that.
  IF EXISTS (
    SELECT 1 FROM "GroupMember"
    WHERE "userId" = v_uid AND status <> 'EXITED'::"MemberStatus"
  ) THEN
    RAISE EXCEPTION 'User still belongs to a group. Remove them from the group first.';
  END IF;

  -- Refuse if they own a group. Deleting the owner strands the group.
  IF EXISTS (SELECT 1 FROM "Group" WHERE "adminUserId" = v_uid AND "deletedAt" IS NULL) THEN
    RAISE EXCEPTION 'User owns a group. Reassign ownership first.';
  END IF;

  -- Pass 1: null out optional references so other people's rows survive.
  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.is_nullable = 'YES'
      AND c.data_type IN ('text', 'character varying', 'uuid')
      AND (
        c.column_name ILIKE '%userid%'
        OR c.column_name IN (
          'invitedBy', 'approvedById', 'recordedById', 'createdById',
          'referredById', 'treasurerId', 'secretaryId', 'managerId',
          'authorisedById', 'resolvedById', 'submittedBy',
          'verifiedBy', 'kycReviewedBy', 'rejectedBy',
          'linkedUserId', 'acceptedUserId', 'actorUserId'
        )
      )
      AND NOT (c.table_name = 'User' AND c.column_name = 'id')
    ORDER BY c.table_name
  LOOP
    BEGIN
      EXECUTE format('UPDATE %I SET %I = NULL WHERE %I = $1',
                     r.table_name, r.column_name, r.column_name) USING v_uid;
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN
        RAISE NOTICE 'NULLED  %.% → % row(s)', r.table_name, r.column_name, n;
      END IF;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'SKIP    %.% (%)', r.table_name, r.column_name, SQLERRM;
    END;
  END LOOP;

  -- Pass 2: delete rows that cannot exist without this user. Repeated
  -- three times so child-before-parent ordering resolves itself without
  -- a hand-maintained dependency list.
  FOR i IN 1..3 LOOP
    FOR r IN
      SELECT c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_name = c.table_name AND t.table_schema = c.table_schema
      WHERE c.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
        AND c.is_nullable = 'NO'
        AND c.data_type IN ('text', 'character varying', 'uuid')
        AND c.column_name ILIKE '%userid%'
        AND c.table_name <> 'User'
      ORDER BY c.table_name
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM %I WHERE %I = $1', r.table_name, r.column_name)
          USING v_uid;
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n > 0 THEN
          v_total := v_total + n;
          RAISE NOTICE 'DELETED %.% → % row(s)  [pass %]', r.table_name, r.column_name, n, i;
        END IF;
      EXCEPTION WHEN others THEN
        IF i = 3 THEN
          RAISE NOTICE 'FAILED  %.% (%)', r.table_name, r.column_name, SQLERRM;
        END IF;
      END;
    END LOOP;
  END LOOP;

  -- Finally the user.
  DELETE FROM "User" WHERE id = v_uid;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'DELETED User → % row(s). Child rows removed: %', n, v_total;
END $$;


-- ── Verification, inside the same transaction ────────────────
SELECT
  (SELECT COUNT(*) FROM "User"
    WHERE lower(email) = lower('ronald.mpofu@gmail.com'))        AS user_remaining,
  (SELECT COUNT(*) FROM "Transaction" t
    WHERE t."userId" NOT IN (SELECT id FROM "User")
      AND t."userId" IS NOT NULL)                                AS orphaned_transactions,
  (SELECT COUNT(*) FROM "GroupMember" gm
    WHERE gm."userId" IS NOT NULL
      AND gm."userId" NOT IN (SELECT id FROM "User"))            AS orphaned_group_members,
  (SELECT COUNT(*) FROM "CommunityMembership" cm
    WHERE cm."userId" NOT IN (SELECT id FROM "User"))            AS orphaned_memberships;


-- Change to COMMIT only after reading the output above.
ROLLBACK;
