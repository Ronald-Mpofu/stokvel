-- ============================================================
-- purge-users.sql   (v2)
--
-- ⚠ TEST DATA ONLY. This hard-deletes accounts and everything
--   attached to them, including immutable ledger rows. Never run it
--   against an account that has taken real money.
--
-- ── HOW TO USE ───────────────────────────────────────────────
-- 1. Edit the ONE line in the CONFIG block below.
-- 2. Run the whole file. Part 1 reports; Part 2 rolls back.
-- 3. Read the NOTICE output (Supabase: the "Messages" tab).
-- 4. If it looks right, change the final ROLLBACK to COMMIT and re-run.
--
-- Run the file in ONE go. The settings below live for the session, so
-- executing statements individually loses them.
--
-- ── WHY DYNAMIC ──────────────────────────────────────────────
-- Hardcoding a table list guarantees a missed one. This walks
-- information_schema for every column referencing a user, so it picks
-- up the raw-SQL tables that carry no foreign key at all —
-- CommunityMembership, JoiningFeeInvoice, PaymentAttempt,
-- PlatformSubscription, EmailVerificationToken, EntitlementShadowLog,
-- PoolMemberGroupInvite — which is exactly where orphans hide.
--
-- ── NULLABLE vs NOT NULL ─────────────────────────────────────
-- Nullable references (approvedById, invitedById, referredById...) are
-- SET NULL: the row belongs to someone else and must survive. NOT NULL
-- references are DELETEd: the row cannot exist without its user.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- CONFIG — the only lines you edit
-- ════════════════════════════════════════════════════════════

-- One email, or several separated by commas. Whitespace is ignored.
--   'luke@zimtransit.com.au'
--   'a@test.com, b@test.com, c@test.com'
SET app.purge_emails = 'luke@zimtransit.com.au';

-- 'false' → refuse to touch anyone who belongs to or owns a group.
-- 'true'  → remove their group memberships too. Use only on test data;
--           a real member's group history is not disposable.
SET app.purge_force = 'false';


-- ════════════════════════════════════════════════════════════
-- PART 1 — WHAT IS THERE   (read only)
-- ════════════════════════════════════════════════════════════

-- ── 1a. The accounts ─────────────────────────────────────────
SELECT u.id, u.email, u."fullName", u.role::text, u.status::text,
       u."emailVerifiedAt", u."createdAt", u."deletedAt"
FROM "User" u
WHERE lower(u.email) = ANY (
  SELECT lower(btrim(e))
  FROM unnest(string_to_array(current_setting('app.purge_emails', true), ',')) AS e
)
ORDER BY u."createdAt";


-- ── 1b. Money attached to them ───────────────────────────────
-- A settled joining fee produces type='FEE', status='COMPLETED'. If
-- anything here is real, stop and anonymise instead of purging.
SELECT u.email, t."type"::text, t."status"::text, t."amount",
       t."currency"::text, t."externalRef", t."createdAt"
FROM "Transaction" t
JOIN "User" u ON u.id = t."userId"
WHERE lower(u.email) = ANY (
  SELECT lower(btrim(e))
  FROM unnest(string_to_array(current_setting('app.purge_emails', true), ',')) AS e
)
ORDER BY u.email, t."createdAt" DESC;


-- ── 1c. Every reference, per user ────────────────────────────
DO $$
DECLARE
  v_emails TEXT[];
  v_email  TEXT;
  v_uid    TEXT;
  r        RECORD;
  n        BIGINT;
BEGIN
  v_emails := string_to_array(coalesce(current_setting('app.purge_emails', true), ''), ',');
  IF array_length(v_emails, 1) IS NULL THEN
    RAISE NOTICE 'app.purge_emails is not set. Edit the CONFIG block and run the whole file.';
    RETURN;
  END IF;

  FOREACH v_email IN ARRAY v_emails LOOP
    v_email := lower(btrim(v_email));
    CONTINUE WHEN v_email = '';

    SELECT id INTO v_uid FROM "User" WHERE lower(email) = v_email;
    IF v_uid IS NULL THEN
      RAISE NOTICE '% → no such user', v_email;
      CONTINUE;
    END IF;

    RAISE NOTICE '';
    RAISE NOTICE '=== %  (%)', v_email, v_uid;

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
            'invitedBy','approvedById','recordedById','createdById',
            'referredById','treasurerId','secretaryId','managerId',
            'adminUserId','authorisedById','resolvedById','submittedBy',
            'borrowerId','recipientId','raisedById','againstUserId',
            'verifiedBy','verifiedById','kycReviewedBy','rejectedBy',
            'linkedUserId','acceptedUserId','actorUserId'
          )
        )
        AND NOT (c.table_name = 'User' AND c.column_name = 'id')
      ORDER BY c.table_name, c.column_name
    LOOP
      BEGIN
        EXECUTE format('SELECT COUNT(*) FROM %I WHERE %I = $1', r.table_name, r.column_name)
          INTO n USING v_uid;
        IF n > 0 THEN
          RAISE NOTICE '  % . %  →  %  [%]',
            rpad(r.table_name, 28), rpad(r.column_name, 20), n,
            CASE WHEN r.is_nullable = 'YES' THEN 'SET NULL' ELSE 'DELETE' END;
        END IF;
      EXCEPTION WHEN others THEN
        RAISE NOTICE '  % . %  →  skipped (%)', r.table_name, r.column_name, SQLERRM;
      END;
    END LOOP;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '--- end of report ---';
END $$;


-- ════════════════════════════════════════════════════════════
-- PART 2 — PURGE
--
-- Ends in ROLLBACK. It runs fully, reports what it WOULD do, then
-- undoes it. Change the last line to COMMIT only when satisfied.
-- ════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_emails TEXT[];
  v_email  TEXT;
  v_uid    TEXT;
  v_force  BOOLEAN;
  r        RECORD;
  n        BIGINT;
  v_total  BIGINT := 0;
  v_users  INTEGER := 0;
BEGIN
  v_emails := string_to_array(coalesce(current_setting('app.purge_emails', true), ''), ',');
  v_force  := coalesce(current_setting('app.purge_force', true), 'false') = 'true';

  IF array_length(v_emails, 1) IS NULL THEN
    RAISE EXCEPTION 'app.purge_emails is not set. Edit the CONFIG block and run the whole file.';
  END IF;

  FOREACH v_email IN ARRAY v_emails LOOP
    v_email := lower(btrim(v_email));
    CONTINUE WHEN v_email = '';

    SELECT id INTO v_uid FROM "User" WHERE lower(email) = v_email;
    IF v_uid IS NULL THEN
      RAISE NOTICE 'SKIP    % — no such user', v_email;
      CONTINUE;
    END IF;

    -- Owning a group is never forced away: deleting the owner strands
    -- the group and everyone in it. Reassign ownership first.
    IF EXISTS (SELECT 1 FROM "Group" WHERE "adminUserId" = v_uid AND "deletedAt" IS NULL) THEN
      RAISE NOTICE 'SKIP    % — owns a group. Reassign ownership first.', v_email;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM "GroupMember"
      WHERE "userId" = v_uid AND status <> 'EXITED'::"MemberStatus"
    ) THEN
      IF NOT v_force THEN
        RAISE NOTICE 'SKIP    % — belongs to a group. Set app.purge_force = ''true'' to include.', v_email;
        CONTINUE;
      END IF;
      RAISE NOTICE 'FORCE   % — group memberships will be removed', v_email;
    END IF;

    RAISE NOTICE '';
    RAISE NOTICE '=== purging %', v_email;

    -- Pass 1: null optional references so other people's rows survive.
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
            'invitedBy','approvedById','recordedById','createdById',
            'referredById','treasurerId','secretaryId','managerId',
            'authorisedById','resolvedById','submittedBy',
            'verifiedBy','verifiedById','kycReviewedBy','rejectedBy',
            'linkedUserId','acceptedUserId','actorUserId'
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
          RAISE NOTICE '  NULLED  %.% → %', r.table_name, r.column_name, n;
        END IF;
      EXCEPTION WHEN others THEN
        RAISE NOTICE '  SKIP    %.% (%)', r.table_name, r.column_name, SQLERRM;
      END;
    END LOOP;

    -- Pass 2: delete rows that cannot exist without this user. Three
    -- passes so child-before-parent ordering resolves itself without a
    -- hand-maintained dependency list.
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
            RAISE NOTICE '  DELETED %.% → %  [pass %]', r.table_name, r.column_name, n, i;
          END IF;
        EXCEPTION WHEN others THEN
          IF i = 3 THEN
            RAISE NOTICE '  FAILED  %.% (%)', r.table_name, r.column_name, SQLERRM;
          END IF;
        END;
      END LOOP;
    END LOOP;

    DELETE FROM "User" WHERE id = v_uid;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN v_users := v_users + 1; END IF;
    RAISE NOTICE '  DELETED User → %', n;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '=== % user(s) purged, % child row(s) removed ===', v_users, v_total;
END $$;


-- ── Verification, inside the same transaction ────────────────
-- Every count must be 0. A non-zero orphan count means a reference was
-- missed — do NOT commit; send me the output instead.
SELECT
  (SELECT COUNT(*) FROM "User" u
    WHERE lower(u.email) = ANY (
      SELECT lower(btrim(e))
      FROM unnest(string_to_array(current_setting('app.purge_emails', true), ',')) AS e
    ))                                                            AS users_remaining,
  (SELECT COUNT(*) FROM "Transaction" t
    WHERE t."userId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = t."userId"))       AS orphaned_transactions,
  (SELECT COUNT(*) FROM "GroupMember" gm
    WHERE gm."userId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = gm."userId"))      AS orphaned_group_members,
  (SELECT COUNT(*) FROM "CommunityMembership" cm
    WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = cm."userId"))      AS orphaned_memberships,
  (SELECT COUNT(*) FROM "PaymentAttempt" pa
    WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = pa."userId"))      AS orphaned_attempts,
  (SELECT COUNT(*) FROM "EmailVerificationToken" t
    WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = t."userId"))       AS orphaned_tokens;


-- Change to COMMIT only after reading the output above.
ROLLBACK;
