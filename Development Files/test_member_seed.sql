-- ============================================================
-- TEST MEMBER SEED DATA
-- Run in Supabase SQL Editor
-- Creates: Tendai Moyo — full test member with all portal data
-- Login: tendai.moyo@test.com / Member@12345
-- Portal: http://localhost:3000/portal
-- ============================================================

-- ── 1. Get the first existing group and admin IDs ────────────
DO $$
DECLARE
  v_group_id     TEXT;
  v_admin_id     TEXT;
  v_member_id    TEXT;
  v_cycle_id     TEXT;
  v_asset1_id    TEXT;
  v_asset2_id    TEXT;
  v_ownership_id TEXT;
  v_queue_id     TEXT;
  v_income_id    TEXT;
  v_insurance_id TEXT;
BEGIN

  -- Get first active group
  SELECT id INTO v_group_id FROM "Group" WHERE status = 'ACTIVE' LIMIT 1;
  IF v_group_id IS NULL THEN
    SELECT id INTO v_group_id FROM "Group" LIMIT 1;
  END IF;

  -- Get admin user
  SELECT id INTO v_admin_id FROM "User"
    WHERE role IN ('SYSTEM_ADMIN','GROUP_ADMIN') LIMIT 1;

  IF v_group_id IS NULL OR v_admin_id IS NULL THEN
    RAISE EXCEPTION 'No group or admin found. Make sure you have at least one group created first.';
  END IF;

  RAISE NOTICE 'Using group_id: %, admin_id: %', v_group_id, v_admin_id;

  -- ── 2. Create test member user ─────────────────────────────
  -- Password hash for "Member@12345" (bcrypt, cost 12)
  v_member_id := gen_random_uuid()::text;

  INSERT INTO "User" (
    id, email, phone, "passwordHash", "fullName", role, status,
    "kycStatus", tier, "reputationScore", country, city,
    "referralCode", "emailVerifiedAt", "createdAt", "updatedAt"
  ) VALUES (
    v_member_id,
    'tendai.moyo@test.com',
    '+263771234567',
    '$2b$12$LQv3c1yqBWVHxkd0LQ4YCOiMcBqgFj8zUWKPFnXqZ9AHqVpx8rGC2',
    'Tendai Moyo',
    'MEMBER',
    'ACTIVE',
    'VERIFIED',
    'GOLD',
    78,
    'Zimbabwe',
    'Harare',
    gen_random_uuid()::text,
    NOW(),
    NOW() - INTERVAL '8 months',
    NOW()
  ) ON CONFLICT (email) DO UPDATE SET
    "fullName" = 'Tendai Moyo',
    "kycStatus" = 'VERIFIED',
    tier = 'GOLD',
    "reputationScore" = 78
  RETURNING id INTO v_member_id;

  -- Re-fetch if conflict updated
  SELECT id INTO v_member_id FROM "User" WHERE email = 'tendai.moyo@test.com';

  RAISE NOTICE 'Member user id: %', v_member_id;

  -- ── 3. Add to group ────────────────────────────────────────
  INSERT INTO "GroupMember" (
    id, "groupId", "userId", role, status,
    "joinedAt", "approvedAt", "approvedById",
    "cyclesCompleted", "createdAt", "updatedAt"
  ) VALUES (
    gen_random_uuid()::text,
    v_group_id, v_member_id, 'MEMBER', 'ACTIVE',
    NOW() - INTERVAL '8 months',
    NOW() - INTERVAL '8 months',
    v_admin_id,
    2,
    NOW() - INTERVAL '8 months',
    NOW()
  ) ON CONFLICT ("groupId","userId") DO NOTHING;

  -- ── 4. Contribution history (8 months) ────────────────────
  -- Completed contributions
  FOR i IN 1..7 LOOP
    INSERT INTO "Contribution" (
      id, "groupId", "userId", amount, currency, status,
      "paymentMethod", reference, "dueDate", "createdAt", "updatedAt"
    ) VALUES (
      gen_random_uuid()::text,
      v_group_id, v_member_id,
      (SELECT "contributionAmount" FROM "Group" WHERE id = v_group_id),
      (SELECT currency FROM "Group" WHERE id = v_group_id),
      'COMPLETED',
      'ECOCASH',
      'ECO-' || LPAD(i::text, 6, '0'),
      DATE_TRUNC('month', NOW()) - (i || ' months')::INTERVAL + INTERVAL '1 day',
      DATE_TRUNC('month', NOW()) - (i || ' months')::INTERVAL + INTERVAL '3 days',
      NOW()
    );
  END LOOP;

  -- Upcoming/pending contribution
  INSERT INTO "Contribution" (
    id, "groupId", "userId", amount, currency, status,
    "paymentMethod", "dueDate", "createdAt", "updatedAt"
  ) VALUES (
    gen_random_uuid()::text,
    v_group_id, v_member_id,
    (SELECT "contributionAmount" FROM "Group" WHERE id = v_group_id),
    (SELECT currency FROM "Group" WHERE id = v_group_id),
    'PENDING',
    'ECOCASH',
    DATE_TRUNC('month', NOW()) + INTERVAL '1 month' +
      ((SELECT "contributionDay" FROM "Group" WHERE id = v_group_id) - 1 || ' days')::INTERVAL,
    NOW(),
    NOW()
  );

  -- Late contribution (2 months ago — simulates one missed payment)
  INSERT INTO "Contribution" (
    id, "groupId", "userId", amount, currency, status,
    "paymentMethod", "dueDate", "createdAt", "updatedAt"
  ) VALUES (
    gen_random_uuid()::text,
    v_group_id, v_member_id,
    (SELECT "contributionAmount" FROM "Group" WHERE id = v_group_id),
    (SELECT currency FROM "Group" WHERE id = v_group_id),
    'LATE',
    'CASH',
    DATE_TRUNC('month', NOW()) - INTERVAL '2 months' + INTERVAL '1 day',
    DATE_TRUNC('month', NOW()) - INTERVAL '2 months' + INTERVAL '15 days',
    NOW()
  );

  -- ── 5. Payout schedule (position 3) ───────────────────────
  -- Find or create an active cycle
  SELECT id INTO v_cycle_id FROM "Cycle"
    WHERE "groupId" = v_group_id AND status = 'ACTIVE' LIMIT 1;

  IF v_cycle_id IS NOT NULL THEN
    INSERT INTO "PayoutSchedule" (
      id, "cycleId", "groupId", "userId",
      position, "payoutAmount", status,
      "scheduledDate", "createdAt", "updatedAt"
    )
    SELECT
      gen_random_uuid()::text,
      v_cycle_id, v_group_id, v_member_id,
      3,
      (SELECT "contributionAmount" * "maxMembers" FROM "Group" WHERE id = v_group_id),
      'PENDING',
      DATE_TRUNC('month', NOW()) + INTERVAL '2 months',
      NOW(), NOW()
    WHERE NOT EXISTS (
      SELECT 1 FROM "PayoutSchedule"
      WHERE "cycleId" = v_cycle_id AND "userId" = v_member_id
    );
  END IF;

  -- ── 6. Asset — shared ownership (ACQUIRED) ────────────────
  v_asset1_id := gen_random_uuid()::text;

  INSERT INTO "Asset" (
    id, "groupId", name, type, status,
    "campaignType", "targetAmount", "raisedAmount",
    "acquisitionCost", "currentValue", "incomeGenerated",
    make, model, year, "serialNumber",
    "allowOutsiders", "unitsTotal", "positionStrategy",
    "acquiredAt", "createdAt", "updatedAt"
  ) VALUES (
    v_asset1_id,
    v_group_id,
    'Group Delivery Truck',
    'VEHICLE',
    'ACQUIRED',
    'SHARED_OWNERSHIP',
    15000, 15000, 15000, 13500, 2400,
    'Toyota', 'Hilux 2.4GD', 2023, 'TRK-2023-00147',
    false, 1, 'SENIORITY',
    NOW() - INTERVAL '5 months',
    NOW() - INTERVAL '6 months',
    NOW()
  );

  -- Ownership record for Tendai (40%)
  v_ownership_id := gen_random_uuid()::text;
  INSERT INTO "AssetOwnership" (
    id, "assetId", "userId", "ownershipPct", "amountContributed",
    "acquiredAt", "createdAt", "updatedAt"
  ) VALUES (
    v_ownership_id,
    v_asset1_id, v_member_id,
    40.00, 6000,
    NOW() - INTERVAL '5 months',
    NOW() - INTERVAL '5 months',
    NOW()
  ) ON CONFLICT ("assetId","userId") DO NOTHING;

  -- Ownership for admin (60%) — to make the totals make sense
  INSERT INTO "AssetOwnership" (
    id, "assetId", "userId", "ownershipPct", "amountContributed",
    "acquiredAt", "createdAt", "updatedAt"
  ) VALUES (
    gen_random_uuid()::text,
    v_asset1_id, v_admin_id,
    60.00, 9000,
    NOW() - INTERVAL '5 months',
    NOW() - INTERVAL '5 months',
    NOW()
  ) ON CONFLICT ("assetId","userId") DO NOTHING;

  -- ── 7. Asset income (rental distributions) ────────────────
  v_income_id := gen_random_uuid()::text;
  INSERT INTO "AssetIncome" (
    id, "assetId", "groupId", type,
    amount, expenses, "netAmount", currency,
    description, "incomeDate", status,
    "distributedAt", "createdAt", "updatedAt"
  ) VALUES (
    v_income_id,
    v_asset1_id, v_group_id,
    'RENTAL',
    2000, 400, 1600,
    (SELECT currency FROM "Group" WHERE id = v_group_id),
    'Monthly truck rental — Chiedza Logistics',
    NOW() - INTERVAL '1 month',
    'DISTRIBUTED',
    NOW() - INTERVAL '1 month' + INTERVAL '5 days',
    NOW() - INTERVAL '1 month', NOW()
  );

  -- Tendai's share (40% of $1600 = $640)
  INSERT INTO "AssetIncomeShare" (
    id, "incomeId", "assetId", "userId",
    "ownershipPct", "shareAmount", currency,
    status, "paidAt", "createdAt"
  ) VALUES (
    gen_random_uuid()::text,
    v_income_id, v_asset1_id, v_member_id,
    40.00, 640.00,
    (SELECT currency FROM "Group" WHERE id = v_group_id),
    'PAID',
    NOW() - INTERVAL '1 month' + INTERVAL '5 days',
    NOW() - INTERVAL '1 month'
  ) ON CONFLICT DO NOTHING;

  -- Second income event (2 months ago)
  v_income_id := gen_random_uuid()::text;
  INSERT INTO "AssetIncome" (
    id, "assetId", "groupId", type,
    amount, expenses, "netAmount", currency,
    description, "incomeDate", status,
    "distributedAt", "createdAt", "updatedAt"
  ) VALUES (
    v_income_id,
    v_asset1_id, v_group_id,
    'HIRE',
    1500, 150, 1350,
    (SELECT currency FROM "Group" WHERE id = v_group_id),
    'Weekend hire — Chipinge Agricultural Show',
    NOW() - INTERVAL '2 months',
    'DISTRIBUTED',
    NOW() - INTERVAL '2 months' + INTERVAL '3 days',
    NOW() - INTERVAL '2 months', NOW()
  );

  INSERT INTO "AssetIncomeShare" (
    id, "incomeId", "assetId", "userId",
    "ownershipPct", "shareAmount", currency,
    status, "paidAt", "createdAt"
  ) VALUES (
    gen_random_uuid()::text,
    v_income_id, v_asset1_id, v_member_id,
    40.00, 540.00,
    (SELECT currency FROM "Group" WHERE id = v_group_id),
    'PAID',
    NOW() - INTERVAL '2 months' + INTERVAL '3 days',
    NOW() - INTERVAL '2 months'
  ) ON CONFLICT DO NOTHING;

  -- ── 8. Round Robin asset (queue position #2) ──────────────
  v_asset2_id := gen_random_uuid()::text;

  INSERT INTO "Asset" (
    id, "groupId", name, type, status,
    "campaignType", "targetAmount", "raisedAmount",
    "unitCost", "unitsTotal", "contributionPerMember",
    "positionStrategy", "allowOutsiders",
    make, model, year,
    "createdAt", "updatedAt"
  ) VALUES (
    v_asset2_id,
    v_group_id,
    'Tractor Programme 2025',
    'AGRICULTURAL_MACHINERY',
    'FUNDING',
    'ROUND_ROBIN',
    54000, 10800,
    5400, 10, 540,
    'SENIORITY', false,
    'John Deere', '5055E Utility', 2025,
    NOW() - INTERVAL '2 months',
    NOW()
  );

  -- Queue entry for Tendai at position 2 — FUNDING stage
  v_queue_id := gen_random_uuid()::text;
  INSERT INTO "AssetQueueEntry" (
    id, "assetId", "userId",
    position, status,
    "targetAmount", "raisedAmount",
    "fundingStarted",
    "createdAt", "updatedAt"
  ) VALUES (
    v_queue_id,
    v_asset2_id, v_member_id,
    2, 'FUNDING',
    5400, 3240,
    NOW() - INTERVAL '3 weeks',
    NOW() - INTERVAL '2 months', NOW()
  ) ON CONFLICT ("assetId","userId") DO NOTHING;

  -- Queue entry for admin at position 1 — DELIVERED
  INSERT INTO "AssetQueueEntry" (
    id, "assetId", "userId",
    position, status,
    "targetAmount", "raisedAmount",
    "fundingStarted", "orderedAt", "deliveredAt",
    "serialNumber", "deliveryNotes",
    "createdAt", "updatedAt"
  ) VALUES (
    gen_random_uuid()::text,
    v_asset2_id, v_admin_id,
    1, 'DELIVERED',
    5400, 5400,
    NOW() - INTERVAL '3 months',
    NOW() - INTERVAL '2 months',
    NOW() - INTERVAL '6 weeks',
    'JD-5055E-2025-00101',
    'Delivered in excellent condition. Full demonstration completed.',
    NOW() - INTERVAL '3 months', NOW()
  ) ON CONFLICT ("assetId","userId") DO NOTHING;

  -- ── 9. Insurance policy on the truck ──────────────────────
  v_insurance_id := gen_random_uuid()::text;
  INSERT INTO "AssetInsurance" (
    id, "assetId", insurer, "policyNumber",
    "policyType", "coverAmount", currency,
    "premiumAmount", "premiumFrequency",
    "startDate", "expiryDate", status,
    "contactName", "contactPhone",
    "createdAt", "updatedAt"
  ) VALUES (
    v_insurance_id,
    v_asset1_id,
    'First Mutual Insurance',
    'FM-VEH-2024-00892',
    'COMPREHENSIVE',
    15000,
    (SELECT currency FROM "Group" WHERE id = v_group_id),
    1200, 'ANNUAL',
    NOW() - INTERVAL '5 months',
    NOW() + INTERVAL '7 months',
    'ACTIVE',
    'Mr. Chuma Sibanda',
    '+263 77 987 6543',
    NOW() - INTERVAL '5 months', NOW()
  );

  -- ── 10. Maintenance record ─────────────────────────────────
  INSERT INTO "AssetMaintenance" (
    id, "assetId", type, description,
    "performedBy", vendor, cost, currency,
    "scheduledDate", "completedDate",
    "nextDueDate", status,
    notes, "createdAt", "updatedAt"
  ) VALUES (
    gen_random_uuid()::text,
    v_asset1_id,
    'SERVICE',
    '10,000 km routine service — oil, filters, inspection',
    'Joseph Muza',
    'Toyota Zimbabwe Service Centre',
    350,
    (SELECT currency FROM "Group" WHERE id = v_group_id),
    NOW() - INTERVAL '2 months',
    NOW() - INTERVAL '2 months',
    NOW() + INTERVAL '4 months',
    'COMPLETED',
    'All checks passed. Next service at 20,000 km.',
    NOW() - INTERVAL '2 months', NOW()
  );

  -- Upcoming scheduled service
  INSERT INTO "AssetMaintenance" (
    id, "assetId", type, description,
    vendor, cost, currency,
    "scheduledDate", status,
    "createdAt", "updatedAt"
  ) VALUES (
    gen_random_uuid()::text,
    v_asset1_id,
    'INSPECTION',
    'Annual roadworthiness inspection — ZINARA',
    'ZINARA Testing Station',
    80,
    (SELECT currency FROM "Group" WHERE id = v_group_id),
    NOW() + INTERVAL '2 weeks',
    'SCHEDULED',
    NOW(), NOW()
  );

  -- ── 11. Reputation events ──────────────────────────────────
  FOR i IN 1..7 LOOP
    INSERT INTO "ReputationEvent" (
      id, "userId", type, points, description,
      "createdAt"
    ) VALUES (
      gen_random_uuid()::text,
      v_member_id,
      'CONTRIBUTION_ON_TIME',
      2,
      'On-time contribution — Month ' || i,
      NOW() - (i || ' months')::INTERVAL
    );
  END LOOP;

  -- ── 12. Audit log ──────────────────────────────────────────
  INSERT INTO "AuditLog" (
    id, "userId", "groupId", action,
    "entityType", "entityId", description, "createdAt"
  ) VALUES (
    gen_random_uuid()::text,
    v_member_id, v_group_id,
    'CREATE', 'User', v_member_id,
    'Test member Tendai Moyo created via seed script',
    NOW()
  );

  RAISE NOTICE '=== SEED COMPLETE ===';
  RAISE NOTICE 'Member created:';
  RAISE NOTICE '  Name:     Tendai Moyo';
  RAISE NOTICE '  Email:    tendai.moyo@test.com';
  RAISE NOTICE '  Password: Member@12345';
  RAISE NOTICE '  Portal:   http://localhost:3000/portal';
  RAISE NOTICE '  User ID:  %', v_member_id;
  RAISE NOTICE '';
  RAISE NOTICE 'Test data includes:';
  RAISE NOTICE '  - 7 completed + 1 pending + 1 late contribution';
  RAISE NOTICE '  - Payout position #3 (if active cycle exists)';
  RAISE NOTICE '  - 40%% ownership in Group Delivery Truck (Toyota Hilux)';
  RAISE NOTICE '  - 2 rental income distributions totalling $1,180';
  RAISE NOTICE '  - Round Robin queue position #2 (John Deere tractor) - 60%% funded';
  RAISE NOTICE '  - Insurance policy + 2 maintenance records on the truck';

END $$;
