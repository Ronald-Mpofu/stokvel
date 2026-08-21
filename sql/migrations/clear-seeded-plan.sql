-- Clears migration 17's pre-seeded period-1 plan for the Christmas Hamper
-- club, so Period Purchases opens with nothing ticked and the group chooses.
-- Refuses to touch a line that already has an assignment against it.
BEGIN;

DELETE FROM "GroceryPeriodPurchase" p
 USING "GroceryClub" c
 WHERE c.id = p."clubId"
   AND c.name ILIKE '%christmas%hamper%'
   AND p."periodNumber" = 1
   AND NOT EXISTS (SELECT 1 FROM "GroceryAssignment" a
                    WHERE a."clubId" = p."clubId"
                      AND a."periodNumber" = p."periodNumber"
                      AND a."itemId" = p."itemId"
                      AND a.status <> 'CANCELLED');

UPDATE "GroceryCycle" y
   SET "plannedTotal"       = COALESCE((SELECT SUM(p."lineTotal") FROM "GroceryPeriodPurchase" p
                                         WHERE p."clubId" = y."clubId" AND p."periodNumber" = y."periodNumber"), 0),
       "targetContribution" = 0,
       "budgetSetAt"        = NULL,
       "updatedAt"          = NOW()
  FROM "GroceryClub" c
 WHERE c.id = y."clubId" AND c.name ILIKE '%christmas%hamper%' AND y."periodNumber" = 1;

SELECT c.name, y."plannedTotal", y."targetContribution",
       (SELECT COUNT(*) FROM "GroceryPeriodPurchase" p
         WHERE p."clubId"=y."clubId" AND p."periodNumber"=1) AS plan_lines,
       (SELECT COUNT(*) FROM "GroceryItem" i WHERE i."clubId"=y."clubId") AS catalogue_items
  FROM "GroceryCycle" y JOIN "GroceryClub" c ON c.id=y."clubId"
 WHERE c.name ILIKE '%christmas%hamper%' AND y."periodNumber"=1;

COMMIT;
