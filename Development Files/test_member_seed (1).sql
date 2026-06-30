-- ============================================================
-- TEST MEMBER SEED DATA v3
-- Run in Supabase SQL Editor
-- Creates: Tendai Moyo — full test member with all portal data
-- Portal URL: http://localhost:3000/portal?as=tendai.moyo@test.com
-- ============================================================

DO $$
DECLARE
  v_group_id     TEXT;
  v_admin_id     TEXT;
  v_member_id    TEXT;
  v_cycle_id     TEXT;
  v_asset1_id    TEXT;
  v_asset2_id    TEXT;
  v_income_id    TEXT;
  v_contrib_amt  NUMERIC;
  v_currency     TEXT;
  v_month        INT;
BEGIN

  -- ── Get existing group & admin ─────────────────────────────
  SELECT id INTO v_group_id FROM "Group" WHERE status = 'ACTIVE' LIMIT 1;
  IF v_group_id IS NULL THEN
    SELECT id INTO v_group_id FROM "Group" LIMIT 1;
  END IF;
  SELECT id INTO v_admin_id FROM "User"
    WHERE role IN ('SYSTEM_ADMIN','GROUP_ADMIN') LIMIT 1;
  IF v_group_id IS NULL OR v_admin_id IS NULL THEN
    RAISE EXCEPTION 'No group or admin found. Create at least one group first.';
  END IF;

  SELECT "contributionAmount", currency
    INTO v_contrib_amt, v_currency
    FROM "Group" WHERE id = v_group_id;

  RAISE NOTICE 'Using group: % | admin: %', v_group_id, v_admin_id;

  -- ── 1. Create member user ──────────────────────────────────
  v_member_id := gen_random_uuid()::text;
  INSERT INTO "User" (
    id, email, phone, "passwordHash", "fullName",
    role, status, "kycStatus", tier, "reputationScore",
    country, city, "referralCode",
    "emailVerifiedAt", "createdAt", "updatedAt"
  ) VALUES (
    v_member_id,
    'tendai.moyo@test.com', '+263771234567',
    '$2b$12$LQv3c1yqBWVHxkd0LQ4YCOiMcBqgFj8zUWKPFnXqZ9AHqVpx8rGC2',
    'Tendai Moyo', 'MEMBER', 'ACTIVE', 'VERIFIED', 'GOLD', 78,
    'Zimbabwe', 'Harare', gen_random_uuid()::text,
    NOW(), NOW() - INTERVAL '8 months', NOW()
  ) ON CONFLICT (email) DO UPDATE SET
    "fullName" = 'Tendai Moyo', "kycStatus" = 'VERIFIED',
    tier = 'GOLD', "reputationScore" = 78;

  SELECT id INTO v_member_id FROM "User" WHERE email = 'tendai.moyo@test.com';
  RAISE NOTICE 'Member ID: %', v_member_id;

  -- ── 2. Group membership ────────────────────────────────────
  INSERT INTO "GroupMember" (
    id, "groupId", "userId", role, status,
    "joinedAt", "approvedAt", "approvedById",
    "cyclesCompleted", "createdAt", "updatedAt"
  ) VALUES (
    gen_random_uuid()::text,
    v_group_id, v_member_id, 'MEMBER', 'ACTIVE',
    NOW() - INTERVAL '8 months', NOW() - INTERVAL '8 months',
    v_admin_id, 2, NOW() - INTERVAL '8 months', NOW()
  ) ON CONFLICT ("groupId","userId") DO NOTHING;

  -- ── 3. Transaction history (contribution records) ──────────
  -- Use Transaction table which has groupId + userId directly
  FOR v_month IN 1..7 LOOP
    INSERT INTO "Transaction" (
      id, type, status, amount, currency,
      description, reference, "paymentMethod",
      "groupId", "userId",
      "createdAt"
    ) VALUES (
      gen_random_uuid()::text,
      'CONTRIBUTION', 'COMPLETED',
      v_contrib_amt, v_currency::text::"CurrencyCode",
      'Monthly contribution — Month ' || v_month,
      'ECO-' || LPAD(floor(random()*999999)::text, 6, '0'),
      'ECOCASH',
      v_group_id, v_member_id,
      DATE_TRUNC('month', NOW()) - (v_month || ' months')::INTERVAL + INTERVAL '3 days'
    );
  END LOOP;

  -- Pending transaction (this month)
  INSERT INTO "Transaction" (
    id, type, status, amount, currency,
    description, reference, "paymentMethod",
    "groupId", "userId", "createdAt"
  ) VALUES (
    gen_random_uuid()::text,
    'CONTRIBUTION', 'PENDING',
    v_contrib_amt, v_currency::text::"CurrencyCode",
    'Monthly contribution — current month',
    'PENDING-' || gen_random_uuid()::text,
    'ECOCASH',
    v_group_id, v_member_id, NOW()
  );

  -- Late payment (2 months ago, paid after due)
  INSERT INTO "Transaction" (
    id, type, status, amount, currency,
    description, reference, "paymentMethod",
    "groupId", "userId", "createdAt"
  ) VALUES (
    gen_random_uuid()::text,
    'CONTRIBUTION', 'COMPLETED',
    v_contrib_amt, v_currency::text::"CurrencyCode",
    'Late contribution — penalty applied',
    'LATE-' || gen_random_uuid()::text,
    'CASH',
    v_group_id, v_member_id,
    DATE_TRUNC('month', NOW()) - INTERVAL '2 months' + INTERVAL '18 days'
  );

  -- ── 4. Cycle + payout schedule ─────────────────────────────
  SELECT id INTO v_cycle_id FROM "Cycle"
    WHERE "groupId" = v_group_id AND status = 'ACTIVE' LIMIT 1;

  IF v_cycle_id IS NOT NULL THEN
    -- Add contribution records for this cycle
    FOR v_month IN 1..7 LOOP
      INSERT INTO "Contribution" (
        id, "cycleId", "userId", "monthNumber",
        "amountDue", "amountPaid", currency,
        status, "paymentMethod", "paymentRef",
        "dueDate", "paidAt", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid()::text,
        v_cycle_id, v_member_id, v_month,
        v_contrib_amt, v_contrib_amt,
        v_currency::text::"CurrencyCode",
        'COMPLETED', 'ECOCASH',
        'ECO-' || LPAD(floor(random()*999999)::text, 6, '0'),
        DATE_TRUNC('month', NOW()) - (v_month || ' months')::INTERVAL + INTERVAL '1 day',
        DATE_TRUNC('month', NOW()) - (v_month || ' months')::INTERVAL + INTERVAL '3 days',
        NOW() - (v_month || ' months')::INTERVAL, NOW()
      ) ON CONFLICT ("cycleId","userId","monthNumber") DO NOTHING;
    END LOOP;

    -- Payout schedule (position 3)
    INSERT INTO "PayoutSchedule" (
      id, "cycleId", "recipientId", "monthNumber",
      "scheduledDate", "payoutAmount", status,
      "lockedAt", "createdAt"
    )
    SELECT
      gen_random_uuid()::text,
      v_cycle_id, v_member_id, 9,
      DATE_TRUNC('month', NOW()) + INTERVAL '2 months',
      v_contrib_amt * (SELECT "maxMembers" FROM "Group" WHERE id = v_group_id),
      'SCHEDULED',
      NOW(), NOW()
    WHERE NOT EXISTS (
      SELECT 1 FROM "PayoutSchedule"
      WHERE "cycleId" = v_cycle_id AND "recipientId" = v_member_id
    );
  ELSE
    RAISE NOTICE 'No active cycle found — skipping Contribution and PayoutSchedule records. Create a cycle first to see those.';
  END IF;

  -- ── 5. Asset 1 — Shared ownership (Toyota Hilux) ──────────
  v_asset1_id := gen_random_uuid()::text;
  INSERT INTO "Asset" (
    id, "groupId", name, type, status,
    "campaignType", "targetAmount", "raisedAmount",
    "acquisitionCost", "currentValue", "incomeGenerated",
    make, model, year, "serialNumber",
    "allowOutsiders", "unitsTotal", "positionStrategy",
    "acquiredAt", "createdAt", "updatedAt"
  ) VALUES (
    v_asset1_id, v_group_id,
    'Group Delivery Truck', 'VEHICLE', 'ACQUIRED',
    'SHARED_OWNERSHIP', 15000, 15000, 15000, 13500, 2400,
    'Toyota', 'Hilux 2.4GD', 2023, 'TRK-2023-00147',
    false, 1, 'SENIORITY',
    NOW() - INTERVAL '5 months',
    NOW() - INTERVAL '6 months', NOW()
  );

  -- Tendai 40% ownership
  INSERT INTO "AssetOwnership" (
    id, "assetId", "userId", "ownershipPct", "amountContributed",
    "acquiredAt", "createdAt", "updatedAt"
  ) VALUES (
    gen_random_uuid()::text, v_asset1_id, v_member_id,
    40.00, 6000,
    NOW() - INTERVAL '5 months',
    NOW() - INTERVAL '5 months', NOW()
  ) ON CONFLICT ("assetId","userId") DO NOTHING;

  -- Admin 60% ownership
  INSERT INTO "AssetOwnership" (
    id, "assetId", "userId", "ownershipPct", "amountContributed",
    "acquiredAt", "createdAt", "updatedAt"
  ) VALUES (
    gen_random_uuid()::text, v_asset1_id, v_admin_id,
    60.00, 9000,
    NOW() - INTERVAL '5 months',
    NOW() - INTERVAL '5 months', NOW()
  ) ON CONFLICT ("assetId","userId") DO NOTHING;

  -- ── 6. Income distributions on the truck ──────────────────
  -- First income event (1 month ago)
  v_income_id := gen_random_uuid()::text;
  INSERT INTO "AssetIncome" (
    id, "assetId", "groupId", type,
    amount, expenses, "netAmount", currency,
    description, "incomeDate", status, "distributedAt",
    "createdAt", "updatedAt"
  ) VALUES (
    v_income_id, v_asset1_id, v_group_id, 'RENTAL',
    2000, 400, 1600, v_currency::text::"CurrencyCode",
    'Monthly truck rental — Chiedza Logistics',
    NOW() - INTERVAL '1 month',
    'DISTRIBUTED', NOW() - INTERVAL '1 month' + INTERVAL '5 days',
    NOW() - INTERVAL '1 month', NOW()
  );

  INSERT INTO "AssetIncomeShare" (
    id, "incomeId", "assetId", "userId",
    "ownershipPct", "shareAmount", currency,
    status, "paidAt", "createdAt"
  ) VALUES (
    gen_random_uuid()::text,
    v_income_id, v_asset1_id, v_member_id,
    40.00, 640.00, v_currency::text::"CurrencyCode",
    'PAID', NOW() - INTERVAL '1 month' + INTERVAL '5 days',
    NOW() - INTERVAL '1 month'
  );

  -- Second income event (2 months ago)
  v_income_id := gen_random_uuid()::text;
  INSERT INTO "AssetIncome" (
    id, "assetId", "groupId", type,
    amount, expenses, "netAmount", currency,
    description, "incomeDate", status, "distributedAt",
    "createdAt", "updatedAt"
  ) VALUES (
    v_income_id, v_asset1_id, v_group_id, 'HIRE',
    1500, 150, 1350, v_currency::text::"CurrencyCode",
    'Weekend hire — Chipinge Agricultural Show',
    NOW() - INTERVAL '2 months',
    'DISTRIBUTED', NOW() - INTERVAL '2 months' + INTERVAL '3 days',
    NOW() - INTERVAL '2 months', NOW()
  );

  INSERT INTO "AssetIncomeShare" (
    id, "incomeId", "assetId", "userId",
    "ownershipPct", "shareAmount", currency,
    status, "paidAt", "createdAt"
  ) VALUES (
    gen_random_uuid()::text,
    v_income_id, v_asset1_id, v_member_id,
    40.00, 540.00, v_currency::text::"CurrencyCode",
    'PAID', NOW() - INTERVAL '2 months' + INTERVAL '3 days',
    NOW() - INTERVAL '2 months'
  );

  -- ── 7. Asset 2 — Round Robin queue (John Deere) ───────────
  v_asset2_id := gen_random_uuid()::text;
  INSERT INTO "Asset" (
    id, "groupId", name, type, status,
    "campaignType", "targetAmount", "raisedAmount",
    "unitCost", "unitsTotal", "contributionPerMember",
    "positionStrategy", "allowOutsiders",
    make, model, year, "createdAt", "updatedAt"
  ) VALUES (
    v_asset2_id, v_group_id,
    'Tractor Programme 2025', 'AGRICULTURAL_MACHINERY', 'FUNDING',
    'ROUND_ROBIN', 54000, 10800,
    5400, 10, 540, 'SENIORITY', false,
    'John Deere', '5055E Utility', 2025,
    NOW() - INTERVAL '2 months', NOW()
  );

  -- Admin at position 1 — DELIVERED
  INSERT INTO "AssetQueueEntry" (
    id, "assetId", "userId", position, status,
    "targetAmount", "raisedAmount",
    "fundingStarted", "orderedAt", "deliveredAt",
    "serialNumber", "deliveryNotes",
    "createdAt", "updatedAt"
  ) VALUES (
    gen_random_uuid()::text,
    v_asset2_id, v_admin_id, 1, 'DELIVERED',
    5400, 5400,
    NOW() - INTERVAL '3 months', NOW() - INTERVAL '2 months',
    NOW() - INTERVAL '6 weeks',
    'JD-5055E-2025-00101',
    'Delivered in excellent condition. Full demonstration completed.',
    NOW() - INTERVAL '3 months', NOW()
  ) ON CONFLICT ("assetId","userId") DO NOTHING;

  -- Tendai at position 2 — FUNDING (60% funded)
  INSERT INTO "AssetQueueEntry" (
    id, "assetId", "userId", position, status,
    "targetAmount", "raisedAmount",
    "fundingStarted", "createdAt", "updatedAt"
  ) VALUES (
    gen_random_uuid()::text,
    v_asset2_id, v_member_id, 2, 'FUNDING',
    5400, 3240,
    NOW() - INTERVAL '3 weeks',
    NOW() - INTERVAL '2 months', NOW()
  ) ON CONFLICT ("assetId","userId") DO NOTHING;

  -- ── 8. Insurance on the truck ──────────────────────────────
  INSERT INTO "AssetInsurance" (
    id, "assetId", insurer, "policyNumber",
    "policyType", "coverAmount", currency,
    "premiumAmount", "premiumFrequency",
    "startDate", "expiryDate", status,
    "contactName", "contactPhone",
    "createdAt", "updatedAt"
  ) VALUES (
    gen_random_uuid()::text, v_asset1_id,
    'First Mutual Insurance', 'FM-VEH-2024-00892',
    'COMPREHENSIVE', 15000, v_currency::text::"CurrencyCode",
    1200, 'ANNUAL',
    NOW() - INTERVAL '5 months', NOW() + INTERVAL '7 months',
    'ACTIVE', 'Mr. Chuma Sibanda', '+263 77 987 6543',
    NOW() - INTERVAL '5 months', NOW()
  );

  -- ── 9. Maintenance records ─────────────────────────────────
  INSERT INTO "AssetMaintenance" (
    id, "assetId", type, description,
    "performedBy", vendor, cost, currency,
    "scheduledDate", "completedDate", "nextDueDate",
    status, notes, "createdAt", "updatedAt"
  ) VALUES (
    gen_random_uuid()::text, v_asset1_id,
    'SERVICE', '10,000 km routine service — oil, filters, inspection',
    'Joseph Muza', 'Toyota Zimbabwe Service Centre',
    350, v_currency::text::"CurrencyCode",
    NOW() - INTERVAL '2 months', NOW() - INTERVAL '2 months',
    NOW() + INTERVAL '4 months',
    'COMPLETED', 'All checks passed. Next service at 20,000 km.',
    NOW() - INTERVAL '2 months', NOW()
  );

  INSERT INTO "AssetMaintenance" (
    id, "assetId", type, description,
    vendor, cost, currency,
    "scheduledDate", status, "createdAt", "updatedAt"
  ) VALUES (
    gen_random_uuid()::text, v_asset1_id,
    'INSPECTION', 'Annual roadworthiness inspection — ZINARA',
    'ZINARA Testing Station', 80, v_currency::text::"CurrencyCode",
    NOW() + INTERVAL '2 weeks', 'SCHEDULED',
    NOW(), NOW()
  );

  -- ── 10. Reputation events ──────────────────────────────────
  FOR v_month IN 1..7 LOOP
    INSERT INTO "ReputationEvent" (
      id, "userId", type, points, description, "createdAt"
    ) VALUES (
      gen_random_uuid()::text, v_member_id,
      'CONTRIBUTION_ON_TIME', 2,
      'On-time contribution — Month ' || v_month,
      NOW() - (v_month || ' months')::INTERVAL
    );
  END LOOP;

  -- ── Done ───────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'SEED COMPLETE';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Name:     Tendai Moyo';
  RAISE NOTICE 'Email:    tendai.moyo@test.com';
  RAISE NOTICE 'Password: Member@12345';
  RAISE NOTICE 'Portal:   http://localhost:3000/portal?as=tendai.moyo@test.com';
  RAISE NOTICE '';
  RAISE NOTICE 'Data seeded:';
  RAISE NOTICE '  + 9 transaction records (7 completed, 1 pending, 1 late)';
  RAISE NOTICE '  + 40%% ownership in Toyota Hilux truck';
  RAISE NOTICE '  + 2 income distributions ($640 + $540)';
  RAISE NOTICE '  + Round Robin queue position #2 (60%% funded)';
  RAISE NOTICE '  + Insurance policy + 2 maintenance records';
  RAISE NOTICE '  + 7 reputation events';
  IF v_cycle_id IS NOT NULL THEN
    RAISE NOTICE '  + Contribution records + payout schedule (cycle found)';
  ELSE
    RAISE NOTICE '  (No active cycle — create one to see contribution records)';
  END IF;

END $$;
