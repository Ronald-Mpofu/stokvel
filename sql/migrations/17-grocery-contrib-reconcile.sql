-- sql/17-grocery-contrib-reconcile.sql
--
-- Finds contributions that the pre-fix handlePayContrib / handleMarkPeriodPaid
-- settled against "amountDue" instead of "amountPayable".
--
-- READ-ONLY BY DEFAULT. Section 3 is commented out — read sections 1 and 2,
-- decide what is true of your club, and only then uncomment anything.
--
-- The two defects being looked for:
--
--   UNDER-COLLECTED  arrears were carried into the row (positive
--                    "carryAdjustment") and the row was marked PAID once the
--                    base was covered. The difference is money the club is
--                    owed and no longer shows anywhere: the GroceryCarryForward
--                    row was already stamped "appliedPeriod", so the debt was
--                    consumed without being collected.
--
--   STUCK-PARTIAL    the member holds club change (negative "carryAdjustment"),
--                    handed over the correct reduced amount, and the row never
--                    reached PAID. They look like a defaulter and their
--                    "sharePercentage" is understated, because recalcTotals
--                    only counts rows with status='PAID'.

-- ── 1. Under-collected: marked PAID but short of what was payable ────────
SELECT
  gc.id,
  c.name                                   AS club,
  gc."periodNumber",
  u."fullName"                             AS member,
  gc."amountDue",
  gc."carryAdjustment",
  COALESCE(gc."amountPayable", gc."amountDue" + COALESCE(gc."carryAdjustment", 0))
                                           AS payable,
  gc."amountPaid",
  ROUND(
    COALESCE(gc."amountPayable", gc."amountDue" + COALESCE(gc."carryAdjustment", 0))
    - gc."amountPaid", 2)                  AS shortfall,
  gc."paidAt"
FROM "GroceryContribution" gc
JOIN "GroceryClub" c ON c.id = gc."clubId"
JOIN "User"        u ON u.id = gc."userId"
WHERE gc.status = 'PAID'
  AND gc."amountPaid" < COALESCE(gc."amountPayable",
                                 gc."amountDue" + COALESCE(gc."carryAdjustment", 0)) - 0.005
ORDER BY c.name, gc."periodNumber", u."fullName";

-- ── 2. Stuck PARTIAL: paid in full but never flipped to PAID ─────────────
SELECT
  gc.id,
  c.name                                   AS club,
  gc."periodNumber",
  u."fullName"                             AS member,
  gc."amountDue",
  gc."carryAdjustment",
  COALESCE(gc."amountPayable", gc."amountDue" + COALESCE(gc."carryAdjustment", 0))
                                           AS payable,
  gc."amountPaid"
FROM "GroceryContribution" gc
JOIN "GroceryClub" c ON c.id = gc."clubId"
JOIN "User"        u ON u.id = gc."userId"
WHERE gc.status <> 'PAID'
  AND gc.status <> 'WAIVED'
  AND gc."amountPaid" >= COALESCE(gc."amountPayable",
                                  gc."amountDue" + COALESCE(gc."carryAdjustment", 0)) - 0.005
  AND gc."amountPaid" > 0
ORDER BY c.name, gc."periodNumber", u."fullName";

-- ── 3. CORRECTIONS — commented out deliberately ──────────────────────────
--
-- Section 1 is NOT safe to auto-correct. A shortfall means the club is owed
-- money it never received; flipping the row back to PARTIAL would be honest
-- about the debt, but it also reopens periods a treasurer has already closed
-- and told members were settled. That is a decision about real money owed by
-- real people, not a data migration. Review the rows first and decide per
-- club whether to reopen them or write the difference off deliberately.
--
-- Section 2 IS safe: the money genuinely arrived and only the status is
-- wrong. Uncomment to correct, then re-run recalcTotals by touching any
-- contribution in the affected clubs, or run the UPDATE in section 4.
--
-- UPDATE "GroceryContribution"
--    SET status   = 'PAID'::"GroceryContribStatus",
--        "paidAt" = COALESCE("paidAt", NOW()),
--        "updatedAt" = NOW()
--  WHERE status NOT IN ('PAID', 'WAIVED')
--    AND "amountPaid" > 0
--    AND "amountPaid" >= COALESCE("amountPayable",
--                                 "amountDue" + COALESCE("carryAdjustment", 0)) - 0.005;

-- ── 4. Rebuild club and member totals after any correction ───────────────
-- recalcTotals only counts rows with status='PAID', so fixing section 2
-- changes both club "totalContributed" and every member's share.
--
-- UPDATE "GroceryClub" c
--    SET "totalContributed" = (SELECT COALESCE(SUM(gc."amountPaid"), 0)
--                                FROM "GroceryContribution" gc
--                               WHERE gc."clubId" = c.id AND gc.status = 'PAID'),
--        "updatedAt" = NOW();

-- ── 5. Confirmation ──────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM "GroceryContribution" gc
    WHERE gc.status = 'PAID'
      AND gc."amountPaid" < COALESCE(gc."amountPayable",
            gc."amountDue" + COALESCE(gc."carryAdjustment", 0)) - 0.005) AS under_collected,
  (SELECT COUNT(*) FROM "GroceryContribution" gc
    WHERE gc.status NOT IN ('PAID', 'WAIVED') AND gc."amountPaid" > 0
      AND gc."amountPaid" >= COALESCE(gc."amountPayable",
            gc."amountDue" + COALESCE(gc."carryAdjustment", 0)) - 0.005) AS stuck_partial;
