// src/app/api/grocery/route.ts — v1.11
// v1.1: handleActivate no longer issues one INSERT per (member × period) —
//       schedule rows are written in batched multi-row INSERTs. Club creation
//       batches its member INSERTs. recalcTotals is now two set-based
//       statements run in parallel instead of N+3 sequential round trips.
// v1.2: club creation now writes GroceryClub."schemeId" and enrols members
//       into "SchemeMember" as well as "GroceryMember". Without both, the
//       mobile hub reads the Grocery Club card as "Not enrolled" for every
//       member of every group. Run sql/13-grocery-scheme-link.sql first to
//       repair rows created before this version. Adds enrolAllMembers so the
//       mobile create sheet does not need a roster fetch.
// v1.3: handleAssignItem stopped trusting the client's "assignedToName".
// v1.4: DISBURSEMENT MODEL. The club holds no pooled balance. Contributions
//       are collected and handed out as purchase advances to named members,
//       who buy the goods and keep them until distribution.
//         - "GroceryAssignment" (item x member x qty x advance x spend) is now
//           the source of truth. "GroceryItem"."assignedToId" is a mirror,
//           kept only so existing reads keep working; a line item may be split
//           across several members and that column cannot express it.
//         - ACQUIT_ASSIGNMENT records actual spend and writes ONE signed
//           "GroceryCarryForward" row, then applies it to the member's earliest
//           unpaid contribution. Sign is NEGATIVE in both variance directions
//           (both reduce the new cash brought); "reason" tells them apart.
//         - Advances outstanding may never exceed cash actually collected.
//           Explicit 409, never a silent overdraw.
//       Requires sql/14-grocery-assignments.sql.
// v1.5: SMART SETTLEMENT. Contributions derive from the ASSIGNED total for
//       the cycle, and a cycle must be LOCKED before contributions issue.
//         - LOCK_CYCLE snapshots assignments, derives the per-member
//           contribution in INTEGER CENTS (620/6 in float does not reconcile)
//           and rotates the rounding remainder by period so the same members
//           do not always carry the extra cent.
//         - SOLVE_SETTLEMENT computes B(i) = assigned - contribution and
//           greedily matches payers to receivers on MIN(owes, needs), giving
//           at most n-1 transfers. Supplier accounts are receiver nodes, so
//           SUPPLIER_DIRECT lines are funded without any member holding cash.
//         - CLAIM / CONFIRM / DISPUTE. Only CONFIRMED counts toward funding a
//           buyer's basket: a payer's claim is not money in the buyer's hand.
//         - Re-solving preserves CONFIRMED transfers and re-matches only the
//           unpaid remainder.
//       Requires sql/15-grocery-settlement.sql.
// v1.6: FUNDS CONFIRMATION GATE. Corrected cycle sequence —
//         day 1   budget, pick items, set the target contribution
//         last day each member ticks that they HAVE their money
//         then    confirmations lock; the pot is known
//         then    items are assigned, capped at the confirmed pot
//         then    contributions re-derive from the assigned total across
//                 CONFIRMED members only, and the settlement is solved
//       A decliner is out of the cycle: no groceries, no node in the
//       settlement graph, and their contribution carries as ARREARS.
//
//       CHANGE HELD vs OUT OF POCKET are asymmetric for settlement and this
//       is the one thing in the module most likely to be "simplified" wrongly:
//         CHANGE_HELD   the member is holding the club's cash. They can hand
//                       it to whoever the settlement names, so it does NOT
//                       reduce their contribution — only the new money they
//                       must find. It stays in the pot.
//         OUT_OF_POCKET the club owes the member. It DOES reduce what they
//                       hand over, and the pot is smaller by that much.
//       Both are stored as negative "carryAdjustment" (correct for "new cash
//       to bring"), so the solver uses amountPayable MINUS change held.
//       Using amountPayable for both makes any club with change held fail
//       the reconciliation guard.
//       Requires sql/16-grocery-confirmation.sql.
// v1.6.1: serialise the confirmation state to the client. v1.6 added the
//       columns but the GET never returned them, so no roll-call UI could be
//       built against it.
// v1.7: PERIOD PURCHASES. The group agrees what to buy with this period's
//       money BEFORE the roll-call, and that plan sets the contribution.
//       Previously the contribution was only derived at LOCK_CYCLE from the
//       assignments — too late to tell members what to bring.
//         - "GroceryItem" is the CATALOGUE. "GroceryPeriodPurchase" is this
//           period's selection from it, with its own qty and its own price
//           copied at selection time.
//         - SET_PERIOD_BUDGET sums the plan and writes the target
//           contribution to every member's "amountDue" for the period.
//         - An item cannot be assigned beyond what the period plan contains,
//           and an item absent from the plan cannot be assigned at all.
//       Requires sql/17-grocery-period-purchases.sql.
// v1.8: RESCHEDULE. An active club whose cycles have not actually started can
//       have its dates, frequency and duration changed. Once anything real
//       has happened the schedule locks, because changing it regenerates the
//       contribution rows those things hang off.
//         "In motion" means a roll-call answer, a payment, an assignment, a
//         settlement instruction, a carry-forward row, an acquitted purchase,
//         or any cycle past OPEN. The grocery CATALOGUE is exempt — building
//         the list is planning, not transacting — and so is the period
//         purchase plan, which is re-derived anyway.
// v1.9: SAVE_PERIOD_PLAN — the whole period plan in one request. Ticking an
//       item used to fire SAVE_PERIOD_PURCHASE and then a full club refetch,
//       so every checkbox cost two Tokyo round trips plus re-serialising
//       items, members, contributions, assignments, cycles, transfers and
//       suppliers. Editing a twenty-item list meant forty round trips.
//       The batch replaces the plan in a single statement (delete-what-is-
//       gone + upsert-what-remains via CTE), so the cost is constant in the
//       number of items rather than linear. The single-line actions stay for
//       anything that still wants them.
// v1.10: SAVE_ROLL_CALL — the whole roll-call in one request, for the same
//       reason as the period plan. Each tick was a write plus a full club
//       refetch, so a ten-member roll-call cost twenty Tokyo round trips at
//       exactly the moment the group is sitting in a room waiting for it.
//       One UPDATE joined against a VALUES list now covers every member.
//       A response can also be CLEARED back to "no answer" (hasFunds null),
//       so a mis-tap in front of the group is undoable — LOCK_CONTRIBUTIONS
//       still refuses to close while anyone is unanswered.
// v1.11: CATALOGUE vs CYCLE. "GroceryItem" is now CRUD + whole-period budget
//       + purchase status, and nothing else. Supplier moved to the period
//       purchase line (which supplier the group uses changes cycle to cycle)
//       and assignment lives on "GroceryAssignment" alone.
//         - syncItemMirror deleted. It wrote assignedToId/assignedToName back
//           onto the catalogue, which could only ever hold ONE assignee while
//           a line may be split across several members — the mirror was
//           lossy by construction.
//         - Item status stops receiving ASSIGNED. It keeps
//           PENDING -> PURCHASED -> DISTRIBUTED, driven by acquittal and
//           distribution rather than by allocation.
//       Requires sql/18-grocery-supplier-to-cycle.sql.
// v1.12: DETAIL READ PERFORMANCE. Three separate problems, all in GET:
//         (a) The per-item assignment aggregate had NO "clubId" filter. It
//             grouped the ENTIRE "GroceryAssignment" table — every club on the
//             platform — and then joined the handful of rows that matched.
//             Cost grew with total platform volume, not club size. This is a
//             correctness-adjacent bug: it was only ever right because the
//             join threw the other clubs away afterwards.
//         (b) The club row was fetched, awaited, and only THEN did the
//             Promise.all start. Two sequential Tokyo round trips (~320ms of
//             pure latency) where one would do. The club query now sits inside
//             the same Promise.all and the 404 check happens after.
//         (c) The response carried the club's ENTIRE history — every
//             contribution, assignment, transfer and period-purchase row ever
//             written — while the panel renders only the current and previous
//             period. A 12-month WEEKLY club with 10 members is 520
//             contribution rows serialised, shipped over a mobile connection,
//             parsed, and then filtered away on the phone. Worse, every single
//             action refetched all of it. Those four reads are now scoped to
//             the active period and the one before it, which is exactly what
//             the UI shows.
//       The period-purchase "qtyAssigned" correlated subquery became a scoped
//       LEFT JOIN aggregate for the same reason as (a).
//       Run sql/19-grocery-indexes.sql — without the composite indexes the
//       period-scoped predicates fall back to sequential scans.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'
import { randomUUID } from 'crypto'
import { requireGroupManager } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// ── Timing harness (v1.13) ────────────────────────────────────
// Set GROCERY_TIMING=1 in the Vercel environment to have GET report where its
// time went, both as a Server-Timing response header and as data._timings.
// Costs nothing when the flag is off, and nothing but two Date.now() calls per
// query when it is on.
//
// READ THE SHAPE, NOT JUST THE TOTAL. The queries below are issued together
// via Promise.all, so their individual timings tell you which of three very
// different problems you have:
//
//   ALL ROUGHLY EQUAL AND LARGE (say all ~9000ms, including the trivial
//   `probe` query)          -> nothing to do with the queries. The cost is
//                              establishing the connection: a cold serverless
//                              function opening a fresh TLS session to Tokyo.
//
//   A RISING STAIRCASE (200, 400, 600, 800 ...) -> the queries are running
//                              SEQUENTIALLY despite Promise.all, which happens
//                              when the Prisma connection pool holds a single
//                              connection. Check for connection_limit=1 in
//                              DATABASE_URL.
//
//   ONE OUTLIER, REST FAST  -> a genuinely slow query. That one is missing an
//                              index, and its name tells you which table.
//
// `probe` is the control. It is `SELECT 1` — it cannot be slow for any reason
// intrinsic to it, so whatever time it reports is pure overhead that every
// other query is also paying.
const TIMING_ON = process.env.GROCERY_TIMING === '1'

type Timing = { name: string; ms: number }

function timed<T>(name: string, sink: Timing[], p: Promise<T>): Promise<T> {
  if (!TIMING_ON) return p
  const started = Date.now()
  return p.then(
    v => { sink.push({ name, ms: Date.now() - started }); return v },
    e => { sink.push({ name: `${name}:ERROR`, ms: Date.now() - started }); throw e },
  )
}

// Server-Timing renders in the browser devtools Network panel under the
// Timing tab, so the numbers land next to the request they describe rather
// than in a log the person debugging has to go and find.
function timingHeader(sink: Timing[], totalMs: number): Record<string, string> {
  if (!TIMING_ON) return {}
  const parts = sink
    .slice()
    .sort((a, b) => b.ms - a.ms)
    .map(t => `${t.name.replace(/[^a-zA-Z0-9_]/g, '_')};dur=${t.ms}`)
  parts.push(`total;dur=${totalMs}`)
  return { 'Server-Timing': parts.join(', ') }
}

async function sql(query: string, params: any[] = []) {
  return prisma.$queryRawUnsafe(query, ...params) as Promise<any[]>
}
async function exec(query: string, params: any[] = []) {
  return prisma.$executeRawUnsafe(query, ...params)
}

// ── Schemas ───────────────────────────────────────────────────
const clubSchema = z.object({
  groupId:               z.string().uuid(),
  name:                  z.string().min(2),
  description:           z.string().nullish().transform(v => v || null),
  periodMonths:          z.coerce.number().int().min(1).max(24).default(3),
  contributionFrequency: z.enum(['WEEKLY','FORTNIGHTLY','MONTHLY']).default('MONTHLY'),
  startDate:             z.string(),
  coordinatorId:         z.string().uuid().nullish().transform(v => v || null),
  notes:                 z.string().nullish().transform(v => v || null),
  memberIds:             z.array(z.string().uuid()).default([]),
  // Mobile create sheet sends this instead of a member list. Selecting
  // members needs a roster fetch the phone should not have to make just to
  // create a club — the server already knows who is in the group.
  enrolAllMembers:       z.coerce.boolean().default(false),
})

// Resolves the group's single GROCERY_CLUB scheme row, creating it if the
// group has never run one, and marks it contributory.
//
// WindfallScheme has UNIQUE ("groupId","schemeType") — one row per type per
// group — so this never produces a second grocery scheme. A club is an
// instance underneath that one row, which is why creating "another grocery
// club" does not add a seventh card to the hub.
async function ensureGrocerySchemeId(groupId: string): Promise<string> {
  const existing = await sql(
    `SELECT id FROM "WindfallScheme"
      WHERE "groupId" = $1 AND "schemeType" = 'GROCERY_CLUB'::"WindfallSchemeType"`,
    [groupId]
  )
  if (existing.length) {
    // isContributory defaults to false. Left false, the hub reads the card
    // as "No passbook" even for an enrolled member.
    await exec(
      `UPDATE "WindfallScheme" SET "isContributory"=true,"updatedAt"=NOW()
        WHERE id=$1 AND "isContributory"=false`,
      [existing[0].id]
    )
    return existing[0].id
  }

  const schemeId = randomUUID()
  await exec(
    `INSERT INTO "WindfallScheme"
       (id,"groupId","schemeType",name,description,status,"isContributory","isRotating","createdAt","updatedAt")
     VALUES ($1,$2,'GROCERY_CLUB'::"WindfallSchemeType",$3,$4,'ACTIVE'::"WindfallSchemeStatus",true,false,NOW(),NOW())
     ON CONFLICT ("groupId","schemeType") DO NOTHING`,
    [schemeId, groupId, 'Grocery Club', 'Bulk grocery buying for members']
  )

  // ON CONFLICT DO NOTHING means a concurrent request may have won the race,
  // in which case our id was never inserted. Re-read rather than assume.
  const row = await sql(
    `SELECT id FROM "WindfallScheme"
      WHERE "groupId" = $1 AND "schemeType" = 'GROCERY_CLUB'::"WindfallSchemeType"`,
    [groupId]
  )
  if (!row.length) throw new Error('Could not resolve the group\'s Grocery Club scheme')
  return row[0].id
}

// Enrols users into BOTH membership tables in one pass.
//
// GroceryMember scopes a member to one club. SchemeMember scopes them to the
// scheme and is what the mobile hub reads to decide enrolment. Writing only
// the first is why every grocery card read "Not enrolled / Ask your admin".
async function enrolMembers(clubId: string, schemeId: string, userIds: string[]) {
  const ids = Array.from(new Set(userIds.filter(Boolean)))
  if (!ids.length) return

  const memberParams: any[] = [clubId]
  const memberTuples = ids.map(userId => {
    const b = memberParams.length
    memberParams.push(randomUUID(), userId)
    return `($${b+1},$1,$${b+2},0,0,true,NOW(),NOW())`
  }).join(',')

  const schemeParams: any[] = [schemeId]
  const schemeTuples = ids.map(userId => {
    const b = schemeParams.length
    schemeParams.push(randomUUID(), userId)
    return `($${b+1},$1,$${b+2},'ACTIVE'::"MemberStatus",NOW(),NOW(),NOW())`
  }).join(',')

  await Promise.all([
    exec(
      `INSERT INTO "GroceryMember" (id,"clubId","userId","totalContributed","sharePercentage","isActive","createdAt","updatedAt")
       VALUES ${memberTuples}
       ON CONFLICT ("clubId","userId") DO UPDATE SET "isActive"=true,"updatedAt"=NOW()`,
      memberParams
    ),
    exec(
      `INSERT INTO "SchemeMember" (id,"schemeId","userId",status,"joinedAt","createdAt","updatedAt")
       VALUES ${schemeTuples}
       ON CONFLICT ("schemeId","userId") DO UPDATE SET status='ACTIVE'::"MemberStatus","exitedAt"=NULL,"updatedAt"=NOW()`,
      schemeParams
    ),
  ])
}

const itemSchema = z.object({
  clubId:              z.string().uuid(),
  name:                z.string().min(1),
  description:         z.string().nullish().transform(v => v || null),
  unit:                z.string().default('units'),
  qtyPerMember:        z.coerce.number().positive().default(1),
  estimatedUnitPrice:  z.coerce.number().min(0),
  notes:               z.string().nullish().transform(v => v || null),
})

function calcPeriodCount(months: number, freq: string): number {
  if (freq === 'WEEKLY')      return Math.ceil(months * 4.33)
  if (freq === 'FORTNIGHTLY') return Math.ceil(months * 2.17)
  return months
}

function calcDueDate(start: Date, p: number, freq: string): Date {
  const d = new Date(start)
  if (freq === 'WEEKLY')           d.setDate(d.getDate() + (p-1)*7)
  else if (freq === 'FORTNIGHTLY') d.setDate(d.getDate() + (p-1)*14)
  else                             d.setMonth(d.getMonth() + (p-1))
  return d
}

// ── GET ───────────────────────────────────────────────────────
// The period currently being worked: the lowest cycle that is not CLOSED,
// falling back to the lowest cycle at all, falling back to 1 for a club that
// has not been activated yet. This mirrors exactly what the panel computes
// from the cycles array, so the rows we ship are the rows it renders.
//
// Inlined as a scalar rather than resolved in a preflight query — a preflight
// would reintroduce the sequential round trip this version exists to remove.
// Every query below already binds $1 = clubId, so it costs no extra parameter.
const ACTIVE_PERIOD = `COALESCE(
        (SELECT MIN("periodNumber") FROM "GroceryCycle" WHERE "clubId"=$1 AND status <> 'CLOSED'),
        (SELECT MIN("periodNumber") FROM "GroceryCycle" WHERE "clubId"=$1),
        1)`

// Current period and the one before it. The Cycle stepper works the active
// period; Contributions shows this period and last. Nothing in the panel reads
// further back, so nothing further back is sent.
const PERIOD_WINDOW = `${ACTIVE_PERIOD} - 1`

export async function GET(req: NextRequest) {
  const handlerStarted = Date.now()
  const marks: Timing[] = []
  try {
    const { searchParams } = new URL(req.url)
    const groupId = searchParams.get('groupId')
    const clubId  = searchParams.get('clubId')

    if (clubId) {
      // Single hop. The club row is one of the ten, not a gate in front of
      // them — a missing club costs one wasted parallel batch, which is far
      // cheaper than making every successful read wait for the check.
      const [clubs, items, members, contribs, assignments, cycles, transfers, suppliers, plan, lock] = await Promise.all([
        timed('club', marks, sql(`SELECT gc.*, g.name as "groupName", g.currency as "groupCurrency",
              u."fullName" as "coordinatorName",
              COALESCE((SELECT SUM(ga."advanceAmount") FROM "GroceryAssignment" ga
                         WHERE ga."clubId"=gc.id AND ga.status IN ('ASSIGNED','PURCHASED')),0) AS "advancedOut",
              COALESCE((SELECT SUM(ga2."advanceAmount") FROM "GroceryAssignment" ga2
                         WHERE ga2."clubId"=gc.id AND ga2.status IN ('ASSIGNED','PURCHASED')
                           AND ga2."actualSpent" IS NULL),0)                                   AS "unacquitted",
              COALESCE((SELECT COUNT(*) FROM "GroceryAssignment" ga3
                         WHERE ga3."clubId"=gc.id AND ga3.status IN ('ASSIGNED','PURCHASED')),0) AS "openAssignments",
              COALESCE((SELECT SUM(cf.amount) FROM "GroceryCarryForward" cf
                         WHERE cf."clubId"=gc.id AND cf."appliedPeriod" IS NULL),0)            AS "carryForwardNet"
             FROM "GroceryClub" gc
             JOIN "Group" g ON g.id = gc."groupId"
             LEFT JOIN "User" u ON u.id = gc."coordinatorId"
             WHERE gc.id = $1`, [clubId])),

        // The catalogue, with its assignment rollup. The inner aggregate is
        // scoped to this club — without that filter it groups every
        // assignment row on the platform before the join discards them.
        timed('items', marks, sql(`SELECT gi.*, pu."fullName" as "purchasedByLive",
                    COALESCE(a."assignmentCount",0)   as "assignmentCount",
                    COALESCE(a."qtyAssigned",0)       as "qtyAssignedTotal",
                    COALESCE(a."advanceTotal",0)      as "advanceTotal",
                    COALESCE(a."spentTotal",0)        as "spentTotal",
                    COALESCE(a."openCount",0)         as "openAssignments"
             FROM "GroceryItem" gi
             LEFT JOIN "User" pu ON pu.id = gi."purchasedById"
             LEFT JOIN (
               SELECT "itemId",
                      COUNT(*)                                              as "assignmentCount",
                      SUM("qtyAssigned")                                    as "qtyAssigned",
                      SUM("advanceAmount")                                  as "advanceTotal",
                      SUM(COALESCE("actualSpent",0))                        as "spentTotal",
                      COUNT(*) FILTER (WHERE status IN ('ASSIGNED','PURCHASED')) as "openCount"
                 FROM "GroceryAssignment"
                WHERE "clubId" = $1 AND status <> 'CANCELLED'
                GROUP BY "itemId"
             ) a ON a."itemId" = gi.id
             WHERE gi."clubId" = $1 ORDER BY gi."createdAt" ASC`, [clubId])),

        timed('members', marks, sql(`SELECT gm.*, u."fullName", u.email, u.tier
             FROM "GroceryMember" gm
             JOIN "User" u ON u.id = gm."userId"
             WHERE gm."clubId" = $1 AND gm."isActive" = true
             ORDER BY u."fullName" ASC`, [clubId])),

        // Current period and the previous one only.
        timed('contributions', marks, sql(`SELECT gc2.*, u."fullName" as "memberName"
             FROM "GroceryContribution" gc2
             JOIN "User" u ON u.id = gc2."userId"
             WHERE gc2."clubId" = $1
               AND gc2."periodNumber" >= ${PERIOD_WINDOW}
             ORDER BY gc2."periodNumber" ASC, gc2."userId" ASC`, [clubId])),

        // periodNumber is COALESCEd because rows written before v1.5 predate
        // the column and read as NULL; the panel treats those as period 1.
        timed('assignments', marks, sql(`SELECT ga.*, u."fullName" as "memberName", gi.name as "itemName", gi.unit
             FROM "GroceryAssignment" ga
             JOIN "User" u        ON u.id  = ga."userId"
             JOIN "GroceryItem" gi ON gi.id = ga."itemId"
             WHERE ga."clubId" = $1 AND ga.status <> 'CANCELLED'
               AND COALESCE(ga."periodNumber",1) >= ${PERIOD_WINDOW}
             ORDER BY gi.name ASC, u."fullName" ASC`, [clubId])),

        // Cycles stay whole — one narrow row per period, and the panel needs
        // the full list to work out which period is active.
        timed('cycles', marks, sql(`SELECT * FROM "GroceryCycle" WHERE "clubId" = $1 ORDER BY "periodNumber" ASC`, [clubId])),

        timed('transfers', marks, sql(`SELECT st.*, pu."fullName" as "payerName", ru."fullName" as "payeeName",
                    sa."supplierName", sa."bankName", sa."accountNumber", sa."referenceFormat"
             FROM "GrocerySettlementTransfer" st
             JOIN "User" pu ON pu.id = st."payerId"
             LEFT JOIN "User" ru ON ru.id = st."payeeUserId"
             LEFT JOIN "GrocerySupplierAccount" sa ON sa.id = st."payeeSupplierId"
             WHERE st."clubId" = $1 AND st.status <> 'CANCELLED'
               AND st."periodNumber" >= ${PERIOD_WINDOW}
             ORDER BY st."periodNumber" ASC, st.amount DESC`, [clubId])),

        timed('suppliers', marks, sql(`SELECT * FROM "GrocerySupplierAccount" WHERE "clubId" = $1 AND "isActive" = true
             ORDER BY "supplierName" ASC`, [clubId])),

        // qtyAssigned was a correlated subquery evaluated once per plan line.
        // One scoped grouped aggregate joined on (itemId, periodNumber) gives
        // the same numbers at constant cost.
        timed('periodPlan', marks, sql(`SELECT pp.*, gi.name AS "itemName", gi.unit, gi."estimatedUnitPrice",
                    COALESCE(qa."qtyAssigned",0) AS "qtyAssigned"
             FROM "GroceryPeriodPurchase" pp
             JOIN "GroceryItem" gi ON gi.id = pp."itemId"
             LEFT JOIN (
               SELECT "itemId", COALESCE("periodNumber",1) AS "periodNumber",
                      SUM("qtyAssigned") AS "qtyAssigned"
                 FROM "GroceryAssignment"
                WHERE "clubId" = $1 AND status <> 'CANCELLED'
                GROUP BY "itemId", COALESCE("periodNumber",1)
             ) qa ON qa."itemId" = pp."itemId" AND qa."periodNumber" = pp."periodNumber"
             WHERE pp."clubId" = $1
               AND pp."periodNumber" >= ${PERIOD_WINDOW}
             ORDER BY pp."periodNumber" ASC, gi.name ASC`, [clubId])),

        timed('scheduleLock', marks, scheduleLock(clubId)),

        // Control. `SELECT 1` has no table, no index and no rows to serialise.
        // If this is slow, EVERYTHING is slow for a reason that has nothing to
        // do with the queries above.
        timed('probe', marks, sql(`SELECT 1 AS ok`)),
      ])

      if (!clubs.length) return NextResponse.json({ success:false, error:'Club not found' }, { status:404 })
      const club = clubs[0]

      // Recomputed here so the client is told which window it received rather
      // than having to infer it. A panel that assumes it holds full history
      // would silently render an empty Contributions tab otherwise.
      const activePeriod = Number(
        cycles.find((c: any) => c.status !== 'CLOSED')?.periodNumber
        ?? cycles[0]?.periodNumber
        ?? 1
      )
      const now = new Date()
      const serialiseStarted = Date.now()
      const payload = { success:true, data: {
        ...formatClub(club),
        _timings: TIMING_ON ? { marks, handlerMs: Date.now() - handlerStarted } : undefined,
        // contributions, assignments, settlementTransfers and periodPurchases
        // below cover periods >= periodWindowFrom ONLY. Anything that needs
        // older rows must ask for them; do not treat these arrays as history.
        activePeriod,
        periodWindowFrom: Math.max(1, activePeriod - 1),
        items:   items.map(formatItem),
        members: members.map(m => ({
          userId: m.userId, fullName: m.fullName, email: m.email, tier: m.tier,
          totalContributed: Number(m.totalContributed), sharePercentage: Number(m.sharePercentage),
          isActive: m.isActive, joinedAt: m.joinedAt,
        })),
        scheduleLocked:  lock.locked,
        scheduleLockReasons: lock.reasons,
        periodPurchases: plan.map((r: any) => ({
          id: r.id, periodNumber: Number(r.periodNumber), itemId: r.itemId,
          itemName: r.itemName, unit: r.unit,
          qty: Number(r.qty), unitPrice: Number(r.unitPrice),
          lineTotal: Number(r.lineTotal),
          estimatedUnitPrice: Number(r.estimatedUnitPrice || 0),
          supplierName: r.supplierName, supplierContact: r.supplierContact,
          supplierAccountId: r.supplierAccountId,
          qtyAssigned: Number(r.qtyAssigned || 0),
          qtyUnassigned: Number(r.qty) - Number(r.qtyAssigned || 0),
          notes: r.notes,
        })),
        cycles: cycles.map((c: any) => ({
          id: c.id, periodNumber: Number(c.periodNumber), status: c.status,
          assignedTotal: Number(c.assignedTotal), memberCount: Number(c.memberCount),
          baseContribution: Number(c.baseContribution), roundingCents: Number(c.roundingCents),
          plannedTotal: Number(c.plannedTotal || 0),
          targetContribution: Number(c.targetContribution || 0),
          budgetSetAt: c.budgetSetAt,
          confirmedPot: Number(c.confirmedPot || 0),
          confirmedMemberCount: Number(c.confirmedMemberCount || 0),
          declinedMemberCount: Number(c.declinedMemberCount || 0),
          fundedAt: c.fundedAt,
          lockedAt: c.lockedAt, settledAt: c.settledAt, closedAt: c.closedAt,
        })),
        settlementTransfers: transfers.map((t: any) => ({
          id: t.id, periodNumber: Number(t.periodNumber),
          payerId: t.payerId, payerName: t.payerName,
          payeeType: t.payeeType,
          payeeName: t.payeeType === 'SUPPLIER' ? t.supplierName : t.payeeName,
          payeeUserId: t.payeeUserId, payeeSupplierId: t.payeeSupplierId,
          bankName: t.bankName, accountNumber: t.accountNumber, reference: t.referenceFormat,
          amount: Number(t.amount), currency: t.currency, status: t.status,
          paymentReference: t.paymentReference,
          claimedAt: t.claimedAt, confirmedAt: t.confirmedAt, disputedAt: t.disputedAt,
        })),
        supplierAccounts: suppliers.map((x: any) => ({
          id: x.id, supplierName: x.supplierName, bankName: x.bankName,
          accountName: x.accountName, accountNumber: x.accountNumber,
          referenceFormat: x.referenceFormat, currency: x.currency,
        })),
        assignments: assignments.map((a: any) => ({
          id: a.id, itemId: a.itemId, itemName: a.itemName, unit: a.unit,
          userId: a.userId, memberName: a.memberName,
          qtyAssigned:   Number(a.qtyAssigned),
          advanceAmount: Number(a.advanceAmount),
          actualSpent:   a.actualSpent != null ? Number(a.actualSpent) : null,
          // Reported as advance - spent, so a positive figure reads as
          // "change held" and a negative one as "out of pocket". The ledger
          // row itself is negative either way; this is the human view.
          variance:      a.actualSpent != null
            ? Number((Number(a.advanceAmount) - Number(a.actualSpent)).toFixed(4)) : null,
          status: a.status, receiptUrl: a.receiptUrl,
          periodNumber: Number(a.periodNumber || 1),
          fundingMode: a.fundingMode || 'MEMBER_CASH',
          supplierAccountId: a.supplierAccountId,
          purchasedAt: a.purchasedAt, acquittedAt: a.acquittedAt, notes: a.notes,
        })),
        contributions: contribs.map(c => ({
          id: c.id, userId: c.userId, memberName: c.memberName,
          periodNumber: Number(c.periodNumber), dueDate: c.dueDate,
          amountDue: Number(c.amountDue), amountPaid: Number(c.amountPaid),
          // Base obligation and adjustment are reported separately. Collapsing
          // them would make a member holding change look like they contributed
          // less than they actually delivered.
          carryAdjustment: Number(c.carryAdjustment || 0),
          amountPayable:   c.amountPayable != null
            ? Number(c.amountPayable)
            : Number(c.amountDue) + Number(c.carryAdjustment || 0),
          status: c.status, paidAt: c.paidAt,
          fundsConfirmedAt: c.fundsConfirmedAt,
          fundsDeclinedAt:  c.fundsDeclinedAt,
          declineReason:    c.declineReason,
          arrearsCarriedAt: c.arrearsCarriedAt,
          isOverdue: c.status !== 'PAID' && c.status !== 'WAIVED' && new Date(c.dueDate) < now,
        })),
      }}
      if (TIMING_ON) {
        marks.push({ name: 'serialise', ms: Date.now() - serialiseStarted })
        const totalMs = Date.now() - handlerStarted
        ;(payload.data as any)._timings = { marks, handlerMs: totalMs }
        console.log('GET /api/grocery timings',
          JSON.stringify({ clubId, totalMs, marks,
            rows: { items: items.length, members: members.length,
                    contributions: contribs.length, assignments: assignments.length,
                    cycles: cycles.length, transfers: transfers.length,
                    periodPurchases: plan.length } }))
        return NextResponse.json(payload, { headers: timingHeader(marks, totalMs) })
      }
      return NextResponse.json(payload)
    }

    if (!groupId) return NextResponse.json({ success:false, error:'groupId required' }, { status:400 })

    const clubs = await timed('clubList', marks, sql(
      `SELECT gc.*, g.name as "groupName", g.currency as "groupCurrency",
        u."fullName" as "coordinatorName",
        (SELECT COUNT(*) FROM "GroceryMember" WHERE "clubId"=gc.id AND "isActive"=true) as "memberCount",
        (SELECT COUNT(*) FROM "GroceryItem" WHERE "clubId"=gc.id) as "itemCount",
        (SELECT COUNT(*) FROM "GroceryItem" WHERE "clubId"=gc.id AND status='PURCHASED') as "purchasedCount"
       FROM "GroceryClub" gc
       JOIN "Group" g ON g.id = gc."groupId"
       LEFT JOIN "User" u ON u.id = gc."coordinatorId"
       WHERE gc."groupId" = $1
       ORDER BY gc."createdAt" DESC`, [groupId]
    ))

    if (TIMING_ON) {
      const totalMs = Date.now() - handlerStarted
      console.log('GET /api/grocery (list) timings',
        JSON.stringify({ groupId, totalMs, marks, clubs: clubs.length }))
      return NextResponse.json(
        { success:true, data: clubs.map(formatClub), _timings: { marks, handlerMs: totalMs } },
        { headers: timingHeader(marks, totalMs) })
    }
    return NextResponse.json({ success:true, data: clubs.map(formatClub) })
  } catch (e: any) {
    console.error('GET /api/grocery error:', e, TIMING_ON ? JSON.stringify(marks) : '')
    return NextResponse.json({ success:false, error:e.message }, { status:500 })
  }
}

// ── POST ──────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // ── Group-manager guard (BR 4 & 6) ────────────────────────
    let guardGroupId: string | null = body.groupId || null
    if (!guardGroupId && body.clubId) {
      const r = await sql(`SELECT "groupId" FROM "GroceryClub" WHERE id=$1`, [body.clubId])
      guardGroupId = r[0]?.groupId ?? null
    }
    const guardErr = await requireGroupManager(req, guardGroupId)
    if (guardErr) return guardErr

    if (body.action === 'ACTIVATE')          return handleActivate(body)
    if (body.action === 'ADD_MEMBER')        return handleAddMember(body)
    if (body.action === 'REMOVE_MEMBER')     return handleRemoveMember(body)
    if (body.action === 'ADD_ITEM')          return handleAddItem(body)
    if (body.action === 'UPDATE_ITEM')       return handleUpdateItem(body)
    if (body.action === 'DELETE_ITEM')       return handleDeleteItem(body)
    if (body.action === 'ASSIGN_ITEM')       return handleAssignItem(body)
    if (body.action === 'CANCEL_ASSIGNMENT') return handleCancelAssignment(body)
    if (body.action === 'ACQUIT_ASSIGNMENT') return handleAcquitAssignment(body)
    if (body.action === 'RESCHEDULE_CLUB')        return handleRescheduleClub(body)
    if (body.action === 'SAVE_PERIOD_PLAN')       return handleSavePeriodPlan(body)
    if (body.action === 'SAVE_PERIOD_PURCHASE')   return handleSavePeriodPurchase(body)
    if (body.action === 'REMOVE_PERIOD_PURCHASE') return handleRemovePeriodPurchase(body)
    if (body.action === 'SET_PERIOD_BUDGET')      return handleSetPeriodBudget(body)
    if (body.action === 'SAVE_ROLL_CALL')    return handleSaveRollCall(body)
    if (body.action === 'CONFIRM_FUNDS')     return handleFundsResponse(body, true)
    if (body.action === 'DECLINE_FUNDS')     return handleFundsResponse(body, false)
    if (body.action === 'LOCK_CONTRIBUTIONS')return handleLockContributions(body)
    if (body.action === 'LOCK_CYCLE')        return handleLockCycle(body)
    if (body.action === 'SOLVE_SETTLEMENT')  return handleSolveSettlement(body)
    if (body.action === 'CLAIM_TRANSFER')    return handleTransferState(body, 'CLAIMED')
    if (body.action === 'CONFIRM_TRANSFER')  return handleTransferState(body, 'CONFIRMED')
    if (body.action === 'DISPUTE_TRANSFER')  return handleTransferState(body, 'DISPUTED')
    if (body.action === 'MARK_PURCHASED')    return handleMarkPurchased(body)
    if (body.action === 'MARK_DISTRIBUTED')  return handleMarkDistributed(body)
    if (body.action === 'PAY_CONTRIBUTION')  return handlePayContrib(body)
    if (body.action === 'WAIVE_CONTRIBUTION') return handleWaiveContrib(body)
    if (body.action === 'MARK_PERIOD_PAID')  return handleMarkPeriodPaid(body)
    if (body.action === 'UPDATE_CLUB')       return handleUpdateClub(body)
    if (body.action === 'CLOSE')             return handleClose(body)

    // Create club
    const data = clubSchema.parse(body)
    const group = await prisma.group.findUnique({ where:{ id:data.groupId }, select:{ currency:true } })
    if (!group) return NextResponse.json({ success:false, error:'Group not found' }, { status:404 })

    const startDate = new Date(data.startDate)
    const endDate   = new Date(startDate)
    endDate.setMonth(endDate.getMonth() + data.periodMonths)
    const clubId = randomUUID()

    // Resolve the scheme BEFORE inserting the club. A club with a NULL
    // schemeId is invisible to the mobile hub, and we would rather fail
    // loudly here than write an orphan that reads as "Not enrolled".
    const schemeId = await ensureGrocerySchemeId(data.groupId)

    await exec(
      `INSERT INTO "GroceryClub" (id,"groupId","schemeId",name,description,"periodMonths","contributionFrequency",
        "contributionAmount","startDate","endDate",status,currency,"totalBudget","totalContributed",
        "totalSpent","coordinatorId",notes,"createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,'SETUP'::"GroceryClubStatus",$10::"CurrencyCode",0,0,0,$11,$12,NOW(),NOW())`,
      [clubId, data.groupId, schemeId, data.name, data.description, data.periodMonths,
       data.contributionFrequency, startDate, endDate, group.currency,
       data.coordinatorId, data.notes]
    )

    // The mobile create sheet asks the server for the roster rather than
    // fetching it on the phone first.
    let memberIds = data.memberIds
    if (data.enrolAllMembers) {
      const roster = await sql(
        `SELECT "userId" FROM "GroupMember"
          WHERE "groupId" = $1 AND status <> 'EXITED'::"MemberStatus"`,
        [data.groupId]
      )
      memberIds = roster.map((r: any) => r.userId)
    }

    await enrolMembers(clubId, schemeId, memberIds)

    return NextResponse.json({
      success:true, data:{ id:clubId },
      message:`"${data.name}" grocery club created. Add items to build your grocery list.`,
    }, { status:201 })

  } catch (e: any) {
    if (e instanceof z.ZodError) return NextResponse.json({ success:false, error:e.errors.map(x=>x.message).join('; ') }, { status:400 })
    console.error('POST /api/grocery error:', e)
    return NextResponse.json({ success:false, error:e.message }, { status:500 })
  }
}

// ── PUT — update club ─────────────────────────────────────────
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const { clubId, ...fields } = body
    if (!clubId) return NextResponse.json({ success:false, error:'clubId required' }, { status:400 })
    await exec(
      `UPDATE "GroceryClub" SET name=$1, description=$2, "coordinatorId"=$3, notes=$4, "updatedAt"=NOW() WHERE id=$5`,
      [fields.name, fields.description||null, fields.coordinatorId||null, fields.notes||null, clubId]
    )
    return NextResponse.json({ success:true, message:'Club updated' })
  } catch (e: any) {
    return NextResponse.json({ success:false, error:e.message }, { status:500 })
  }
}

// ── DELETE — delete item OR entire club ──────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const itemId  = searchParams.get('itemId')
    const clubId  = searchParams.get('clubId')

    // ── Group-manager guard ────────────────────────────────────
    let guardGroupId: string | null = null
    if (clubId) {
      const r = await sql(`SELECT "groupId" FROM "GroceryClub" WHERE id=$1`, [clubId])
      guardGroupId = r[0]?.groupId ?? null
    } else if (itemId) {
      const r = await sql(`SELECT gc."groupId" FROM "GroceryItem" gi JOIN "GroceryClub" gc ON gc.id = gi."clubId" WHERE gi.id=$1`, [itemId])
      guardGroupId = r[0]?.groupId ?? null
    }
    const guardErr = await requireGroupManager(req, guardGroupId)
    if (guardErr) return guardErr

    // ── Delete a single item ──────────────────────────────────
    if (itemId) {
      await exec(`DELETE FROM "GroceryItem" WHERE id=$1`, [itemId])
      return NextResponse.json({ success:true, message:'Item deleted' })
    }

    // ── Delete entire club (temporary hard-delete — remove before go-live) ──
    if (clubId) {
      const rows = await sql(`SELECT id, name FROM "GroceryClub" WHERE id=$1`, [clubId])
      if (!rows.length) return NextResponse.json({ success:false, error:'Grocery club not found' }, { status:404 })
      const name = rows[0].name
      try { await exec(`DELETE FROM "GroceryPurchase"     WHERE "itemId" IN (SELECT id FROM "GroceryItem" WHERE "clubId"=$1)`, [clubId]) } catch {}
      try { await exec(`DELETE FROM "GroceryItem"         WHERE "clubId"=$1`, [clubId]) } catch {}
      try { await exec(`DELETE FROM "GroceryContribution" WHERE "clubId"=$1`, [clubId]) } catch {}
      try { await exec(`DELETE FROM "GroceryMember"       WHERE "clubId"=$1`, [clubId]) } catch {}
      await exec(`DELETE FROM "GroceryClub" WHERE id=$1`, [clubId])
      return NextResponse.json({ success:true, message:`"${name}" has been permanently deleted.` })
    }

    return NextResponse.json({ success:false, error:'itemId or clubId required' }, { status:400 })
  } catch (e: any) {
    console.error('DELETE /api/grocery error:', e)
    return NextResponse.json({ success:false, error:e.message }, { status:500 })
  }
}

// ── Activate — generate contribution schedule ─────────────────
// v1.1: the schedule is written with batched multi-row INSERTs instead of one
//       round trip per (member × period). A 12-month WEEKLY club with 10
//       members is 520 rows — previously 520 sequential round trips at ~160ms
//       Tokyo↔Washington (~83s), now a handful of statements (well under 1s).
//
// Placeholders stay untyped so Postgres infers each parameter's type from the
// target column. Do NOT switch this to unnest(...::text[]) — an explicit array
// cast defeats that inference and will fail if a column is uuid rather than text.
const ACTIVATE_CHUNK_ROWS = 500

async function handleActivate(body: any): Promise<NextResponse> {
  const { clubId } = body

  // One round trip for club + roster + items instead of three sequential ones.
  const [clubs, members, items] = await Promise.all([
    sql(`SELECT * FROM "GroceryClub" WHERE id=$1`, [clubId]),
    sql(`SELECT * FROM "GroceryMember" WHERE "clubId"=$1 AND "isActive"=true`, [clubId]),
    sql(`SELECT "estimatedTotalPrice" FROM "GroceryItem" WHERE "clubId"=$1`, [clubId]),
  ])

  if (!clubs.length) return NextResponse.json({ success:false, error:'Club not found' }, { status:404 })
  const club = clubs[0]
  if (club.status !== 'SETUP') return NextResponse.json({ success:false, error:'Club already activated' }, { status:400 })
  if (!members.length) return NextResponse.json({ success:false, error:'Add at least one member before activating' }, { status:400 })

  // Recalc budget and contribution amount from items
  const totalBudget   = items.reduce((s: number, i: any) => s + Number(i.estimatedTotalPrice), 0)
  const contribAmount = totalBudget / members.length

  const periodCount = calcPeriodCount(Number(club.periodMonths), club.contributionFrequency)
  const startDate   = new Date(club.startDate)

  // Build the full row set in memory first — cheap, and lets us size the batches.
  const rows: { id: string; userId: string; period: number; due: Date }[] = []
  for (const m of members) {
    for (let p = 1; p <= periodCount; p++) {
      rows.push({
        id:     randomUUID(),
        userId: m.userId,
        period: p,
        due:    calcDueDate(startDate, p, club.contributionFrequency),
      })
    }
  }

  // $1 = clubId and $2 = amountDue are shared by every tuple, so each row costs
  // only 4 further placeholders. Chunked to keep any single statement modest.
  for (let i = 0; i < rows.length; i += ACTIVATE_CHUNK_ROWS) {
    const chunk  = rows.slice(i, i + ACTIVATE_CHUNK_ROWS)
    const params: any[] = [clubId, contribAmount]
    const tuples = chunk.map(r => {
      const b = params.length
      params.push(r.id, r.userId, r.period, r.due)
      return `($${b+1},$1,$${b+2},$${b+3},$${b+4},$2,0,'PENDING'::"GroceryContribStatus",NOW(),NOW())`
    }).join(',')

    await exec(
      `INSERT INTO "GroceryContribution" (id,"clubId","userId","periodNumber","dueDate","amountDue","amountPaid",status,"createdAt","updatedAt")
       VALUES ${tuples}
       ON CONFLICT ("clubId","userId","periodNumber") DO NOTHING`,
      params
    )
  }

  await exec(
    `UPDATE "GroceryClub" SET status='ACTIVE'::"GroceryClubStatus","totalBudget"=$1,"contributionAmount"=$2,"updatedAt"=NOW() WHERE id=$3`,
    [totalBudget, contribAmount, clubId]
  )

  return NextResponse.json({
    success:true,
    data:{ periodCount, memberCount: members.length, scheduleRows: rows.length },
    message:`Club activated! Budget: $${totalBudget.toFixed(2)}. Each member contributes $${contribAmount.toFixed(2)} over ${periodCount} periods.`,
  })
}

// ── Add/Remove member ─────────────────────────────────────────
async function handleAddMember(body: any): Promise<NextResponse> {
  const { clubId, userId } = body
  const clubs = await sql(`SELECT "groupId","schemeId" FROM "GroceryClub" WHERE id=$1`, [clubId])
  if (!clubs.length) return NextResponse.json({ success:false, error:'Club not found' }, { status:404 })

  // A club created before migration 13 may still have a NULL schemeId.
  const schemeId = clubs[0].schemeId || await ensureGrocerySchemeId(clubs[0].groupId)
  if (!clubs[0].schemeId) {
    await exec(`UPDATE "GroceryClub" SET "schemeId"=$1,"updatedAt"=NOW() WHERE id=$2`, [schemeId, clubId])
  }

  await enrolMembers(clubId, schemeId, [userId])
  const user = await prisma.user.findUnique({ where:{ id:userId }, select:{ fullName:true } })
  return NextResponse.json({ success:true, message:`${user?.fullName} added to club` })
}

async function handleRemoveMember(body: any): Promise<NextResponse> {
  const { clubId, userId } = body
  await exec(`UPDATE "GroceryMember" SET "isActive"=false,"updatedAt"=NOW() WHERE "clubId"=$1 AND "userId"=$2`, [clubId, userId])

  // SchemeMember is scheme-scoped, not club-scoped. A member dropped from
  // one club may still be active in another under the same scheme, so only
  // exit them from the scheme when no active club membership remains.
  // Getting this wrong would erase their passbook for clubs they are still in.
  await exec(
    `UPDATE "SchemeMember" sm
        SET status='EXITED'::"MemberStatus", "exitedAt"=NOW(), "updatedAt"=NOW()
      WHERE sm."userId" = $2
        AND sm."schemeId" = (SELECT "schemeId" FROM "GroceryClub" WHERE id=$1)
        AND NOT EXISTS (
              SELECT 1
                FROM "GroceryMember" gm
                JOIN "GroceryClub"   gc ON gc.id = gm."clubId"
               WHERE gm."userId"  = $2
                 AND gm."isActive" = true
                 AND gc."schemeId" = sm."schemeId"
            )`,
    [clubId, userId]
  )
  return NextResponse.json({ success:true, message:'Member removed from club' })
}

// ── Grocery Item CRUD ─────────────────────────────────────────
async function handleAddItem(body: any): Promise<NextResponse> {
  const data = itemSchema.parse(body)
  const clubs = await sql(`SELECT * FROM "GroceryClub" WHERE id=$1`, [data.clubId])
  if (!clubs.length) return NextResponse.json({ success:false, error:'Club not found' }, { status:404 })
  const club = clubs[0]

  const memberCount = await sql(`SELECT COUNT(*) as cnt FROM "GroceryMember" WHERE "clubId"=$1 AND "isActive"=true`, [data.clubId])
  const mc       = Number((memberCount[0] as any).cnt) || 1
  const totalQty = data.qtyPerMember * mc
  const estTotal = data.estimatedUnitPrice * totalQty
  const itemId   = randomUUID()

  await exec(
    `INSERT INTO "GroceryItem" (id,"clubId",name,description,unit,"qtyPerMember","totalQty",
      "estimatedUnitPrice","estimatedTotalPrice",status,notes,"createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING'::"GroceryItemStatus",$10,NOW(),NOW())`,
    [itemId, data.clubId, data.name, data.description, data.unit,
     data.qtyPerMember, totalQty, data.estimatedUnitPrice, estTotal, data.notes]
  )

  // Update club total budget
  await exec(
    `UPDATE "GroceryClub" SET "totalBudget"=(SELECT COALESCE(SUM("estimatedTotalPrice"),0) FROM "GroceryItem" WHERE "clubId"=$1),"updatedAt"=NOW() WHERE id=$1`,
    [data.clubId]
  )

  // Recalc contribution amount if active
  if (club.status === 'ACTIVE') await recalcContribAmount(data.clubId)

  return NextResponse.json({ success:true, data:{ id:itemId }, message:`"${data.name}" added to grocery list` }, { status:201 })
}

async function handleUpdateItem(body: any): Promise<NextResponse> {
  const { itemId, clubId, ...fields } = body
  const memberCount = await sql(`SELECT COUNT(*) as cnt FROM "GroceryMember" WHERE "clubId"=$1 AND "isActive"=true`, [clubId])
  const mc       = Number((memberCount[0] as any).cnt) || 1
  const totalQty = Number(fields.qtyPerMember) * mc
  const estTotal = Number(fields.estimatedUnitPrice) * totalQty

  await exec(
    `UPDATE "GroceryItem" SET name=$1, description=$2, unit=$3, "qtyPerMember"=$4, "totalQty"=$5,
      "estimatedUnitPrice"=$6, "estimatedTotalPrice"=$7, notes=$8, "updatedAt"=NOW()
     WHERE id=$9`,
    [fields.name, fields.description||null, fields.unit, fields.qtyPerMember, totalQty,
     fields.estimatedUnitPrice, estTotal, fields.notes||null, itemId]
  )

  await exec(
    `UPDATE "GroceryClub" SET "totalBudget"=(SELECT COALESCE(SUM("estimatedTotalPrice"),0) FROM "GroceryItem" WHERE "clubId"=$1),"updatedAt"=NOW() WHERE id=$1`,
    [clubId]
  )
  await recalcContribAmount(clubId)
  return NextResponse.json({ success:true, message:'Item updated' })
}

async function handleDeleteItem(body: any): Promise<NextResponse> {
  const { itemId, clubId } = body
  await exec(`DELETE FROM "GroceryItem" WHERE id=$1`, [itemId])
  await exec(
    `UPDATE "GroceryClub" SET "totalBudget"=(SELECT COALESCE(SUM("estimatedTotalPrice"),0) FROM "GroceryItem" WHERE "clubId"=$1),"updatedAt"=NOW() WHERE id=$1`,
    [clubId]
  )
  await recalcContribAmount(clubId)
  return NextResponse.json({ success:true, message:'Item removed from grocery list' })
}

// ── Item status transitions ───────────────────────────────────
// ══════════════════════════════════════════════════════════════
// SMART SETTLEMENT
// ══════════════════════════════════════════════════════════════
// All settlement arithmetic runs in integer minor units. $620/6 in floating
// point is 103.33333333333333 and six of those do not sum to $620.00.
const cents = (v: any) => Math.round(Number(v || 0) * 100)
const money = (c: number) => (c / 100).toFixed(2)

type SettleNode = { key: string; type: 'MEMBER' | 'SUPPLIER'; bal: number }

// Greedy min-cash-flow. Sorted by amount desc then key, so the same inputs
// always produce the same instructions — a member must never be told to pay
// a different person just because a page was refreshed.
function solveSettlement(nodes: SettleNode[]) {
  const payers = nodes.filter(n => n.bal < 0)
    .map(n => ({ ...n, rem: -n.bal }))
    .sort((a, b) => b.rem - a.rem || a.key.localeCompare(b.key))
  const recvs = nodes.filter(n => n.bal > 0)
    .map(n => ({ ...n, rem: n.bal }))
    .sort((a, b) => b.rem - a.rem || a.key.localeCompare(b.key))

  const out: { payer: string; payee: string; payeeType: 'MEMBER'|'SUPPLIER'; cents: number }[] = []
  let i = 0, j = 0
  while (i < payers.length && j < recvs.length) {
    const amt = Math.min(payers[i].rem, recvs[j].rem)
    if (amt > 0) out.push({ payer: payers[i].key, payee: recvs[j].key, payeeType: recvs[j].type, cents: amt })
    payers[i].rem -= amt; recvs[j].rem -= amt
    if (payers[i].rem === 0) i++
    if (recvs[j].rem === 0) j++
  }
  return out
}

// Split a total across n members to the cent. The remainder cents rotate by
// period so the same two members do not carry the extra cent every cycle.
function splitContribution(totalCents: number, userIds: string[], periodNumber: number) {
  const n = userIds.length
  const base = Math.floor(totalCents / n)
  const rem  = totalCents - base * n
  const ordered = [...userIds].sort()
  const offset  = n > 0 ? (periodNumber - 1) % n : 0
  const out = new Map<string, number>(ordered.map(u => [u, base]))
  for (let k = 0; k < rem; k++) {
    const u = ordered[(offset + k) % n]
    out.set(u, (out.get(u) as number) + 1)
  }
  return out
}

// ── Schedule mutability ───────────────────────────────────────
// Changing the start date, frequency or duration regenerates every
// contribution row, so it is only safe while nothing hangs off them. One
// round trip establishes the whole picture, and the caller gets back the
// specific reasons rather than a bare "locked" so the admin knows what to
// undo if they need to.
async function scheduleLock(clubId: string) {
  const r = await sql(
    `SELECT
       (SELECT COUNT(*) FROM "GroceryContribution"
         WHERE "clubId"=$1 AND ("fundsConfirmedAt" IS NOT NULL
                             OR "fundsDeclinedAt"  IS NOT NULL))            AS "rollCall",
       (SELECT COUNT(*) FROM "GroceryContribution"
         WHERE "clubId"=$1 AND ("amountPaid" > 0 OR "arrearsCarriedAt" IS NOT NULL)) AS "payments",
       (SELECT COUNT(*) FROM "GroceryAssignment"
         WHERE "clubId"=$1 AND status <> 'CANCELLED')                       AS "assignments",
       (SELECT COUNT(*) FROM "GrocerySettlementTransfer"
         WHERE "clubId"=$1 AND status <> 'CANCELLED')                       AS "settlements",
       (SELECT COUNT(*) FROM "GroceryCarryForward" WHERE "clubId"=$1)       AS "carry",
       (SELECT COUNT(*) FROM "GroceryCycle"
         WHERE "clubId"=$1 AND status NOT IN ('OPEN','REOPENED'))           AS "cyclesStarted",
       (SELECT COUNT(*) FROM "GroceryItem"
         WHERE "clubId"=$1 AND status IN ('PURCHASED','DISTRIBUTED'))       AS "purchases"`,
    [clubId]
  )
  const c = r[0] || {}
  const checks: [string, number, string][] = [
    ['rollCall',      Number(c.rollCall      || 0), 'members have answered the roll-call'],
    ['payments',      Number(c.payments      || 0), 'contributions have been paid or carried as arrears'],
    ['assignments',   Number(c.assignments   || 0), 'items have been assigned to members'],
    ['settlements',   Number(c.settlements   || 0), 'settlement instructions have been issued'],
    ['carry',         Number(c.carry         || 0), 'carry-forward balances exist'],
    ['cyclesStarted', Number(c.cyclesStarted || 0), 'a cycle has moved past the roll-call'],
    ['purchases',     Number(c.purchases     || 0), 'items have been purchased or distributed'],
  ]
  const reasons = checks.filter(([, n]) => n > 0).map(([, n, why]) => `${n} ${why}`)
  return { locked: reasons.length > 0, reasons }
}

// ── Reschedule ────────────────────────────────────────────────
async function handleRescheduleClub(body: any): Promise<NextResponse> {
  const clubId = typeof body.clubId === 'string' ? body.clubId : ''
  if (!clubId) return NextResponse.json({ success:false, error:'clubId is required' }, { status:400 })

  const lock = await scheduleLock(clubId)
  if (lock.locked) {
    return NextResponse.json({ success:false,
      error:`This club is already in motion, so its schedule is locked: ${lock.reasons.join('; ')}. Changing the dates now would regenerate the contribution rows those records depend on.` },
      { status:409 })
  }

  const clubs = await sql(`SELECT * FROM "GroceryClub" WHERE id=$1`, [clubId])
  if (!clubs.length) return NextResponse.json({ success:false, error:'Club not found' }, { status:404 })
  const club = clubs[0]

  const months = Number.isInteger(Number(body.periodMonths)) ? Number(body.periodMonths) : Number(club.periodMonths)
  const freq   = ['WEEKLY','FORTNIGHTLY','MONTHLY'].includes(body.contributionFrequency)
    ? body.contributionFrequency : String(club.contributionFrequency)
  const start  = body.startDate ? new Date(body.startDate) : new Date(club.startDate)

  if (!(months > 0))          return NextResponse.json({ success:false, error:'Duration must be at least one month' }, { status:400 })
  if (isNaN(start.getTime())) return NextResponse.json({ success:false, error:'Start date is not a valid date' }, { status:400 })

  const periodCount = calcPeriodCount(months, freq)
  if (periodCount > 260)
    return NextResponse.json({ success:false, error:`That works out to ${periodCount} periods. Reduce the duration or use a less frequent cycle.` }, { status:400 })

  // End date is derived, never taken from the client — a stored end date that
  // disagrees with startDate + duration would make every downstream figure
  // ambiguous.
  const end = calcDueDate(start, periodCount, freq)

  const members = await sql(
    `SELECT "userId" FROM "GroceryMember" WHERE "clubId"=$1 AND "isActive"=true ORDER BY "userId"`, [clubId])

  // Nothing is in motion, so rows beyond the new horizon can go. Anything
  // still within it is re-dated rather than dropped and recreated, which
  // keeps the period purchase plan attached to its cycle.
  await Promise.all([
    exec(`DELETE FROM "GroceryPeriodPurchase" WHERE "clubId"=$1 AND "periodNumber" > $2`, [clubId, periodCount]),
    exec(`DELETE FROM "GroceryContribution"   WHERE "clubId"=$1 AND "periodNumber" > $2`, [clubId, periodCount]),
    exec(`DELETE FROM "GroceryCycle"          WHERE "clubId"=$1 AND "periodNumber" > $2`, [clubId, periodCount]),
  ])

  // Re-date the surviving contribution rows in one statement per chunk
  // rather than one per row — the round trip to Tokyo is the cost here.
  if (members.length) {
    const rows: { userId: string; p: number; due: Date }[] = []
    for (const m of members) {
      for (let p = 1; p <= periodCount; p++) rows.push({ userId: String(m.userId), p, due: calcDueDate(start, p, freq) })
    }
    for (let i = 0; i < rows.length; i += ACTIVATE_CHUNK_ROWS) {
      const chunk = rows.slice(i, i + ACTIVATE_CHUNK_ROWS)
      const params: any[] = [clubId]
      const tuples = chunk.map(r => {
        const b = params.length
        params.push(randomUUID(), r.userId, r.p, r.due)
        return `($${b+1},$1,$${b+2},$${b+3},$${b+4},0,0)`
      }).join(',')
      await exec(
        `INSERT INTO "GroceryContribution"
           (id,"clubId","userId","periodNumber","dueDate","amountDue","amountPaid","createdAt","updatedAt")
         SELECT v.id,v."clubId",v."userId",v.p,v.due,v.amt,v.paid,NOW(),NOW()
           FROM (VALUES ${tuples}) AS v(id,"clubId","userId",p,due,amt,paid)
         ON CONFLICT ("clubId","userId","periodNumber") DO UPDATE
           SET "dueDate"=EXCLUDED."dueDate", "updatedAt"=NOW()`,
        params)
    }
  }

  // Cycles: one OPEN row per period, none missing, none stale.
  const cparams: any[] = [clubId]
  const ctuples = Array.from({ length: periodCount }, (_, i) => {
    const b = cparams.length
    cparams.push(randomUUID(), i + 1)
    return `($${b+1},$1,$${b+2})`
  }).join(',')
  await exec(
    `INSERT INTO "GroceryCycle" (id,"clubId","periodNumber",status,"createdAt","updatedAt")
     SELECT v.id, v."clubId", v.p, 'OPEN', NOW(), NOW()
       FROM (VALUES ${ctuples}) AS v(id,"clubId",p)
     ON CONFLICT ("clubId","periodNumber") DO NOTHING`,
    cparams)

  await exec(
    `UPDATE "GroceryClub"
        SET "periodMonths"=$1, "contributionFrequency"=$2, "startDate"=$3, "endDate"=$4, "updatedAt"=NOW()
      WHERE id=$5`,
    [months, freq, start, end, clubId])

  return NextResponse.json({ success:true,
    data:{ periodMonths: months, contributionFrequency: freq,
           startDate: start, endDate: end, periods: periodCount },
    message:`Rescheduled: ${periodCount} ${freq.toLowerCase()} period${periodCount===1?'':'s'} from ${start.toISOString().split('T')[0]} to ${end.toISOString().split('T')[0]}.` })
}

// ── Save the whole period plan at once ────────────────────────
// Replaces the plan for a period in one shot. Constant round-trip cost
// whatever the list size: one read to validate, one statement to delete and
// upsert, one to restate the total.
async function handleSavePeriodPlan(body: any): Promise<NextResponse> {
  const clubId = typeof body.clubId === 'string' ? body.clubId : ''
  const period = Number(body.periodNumber)
  const lines  = Array.isArray(body.lines) ? body.lines : null
  if (!clubId || !Number.isInteger(period) || period < 1 || !lines)
    return NextResponse.json({ success:false, error:'clubId, periodNumber and lines are required' }, { status:400 })

  // Normalise and reject anything malformed before touching the database.
  const clean: { itemId: string; qty: number; price: number;
                 supplierName: string | null; supplierContact: string | null;
                 supplierAccountId: string | null }[] = []
  const seen = new Set<string>()
  for (const l of lines) {
    const itemId = typeof l?.itemId === 'string' ? l.itemId : ''
    const qty    = Number(l?.qty)
    const price  = Number(l?.unitPrice)
    if (!itemId) return NextResponse.json({ success:false, error:'A line is missing its item' }, { status:400 })
    if (seen.has(itemId)) return NextResponse.json({ success:false, error:'The same item appears twice in the plan' }, { status:400 })
    if (!Number.isFinite(qty) || qty <= 0)
      return NextResponse.json({ success:false, error:'Every chosen item needs a quantity above zero' }, { status:400 })
    if (!Number.isFinite(price) || price < 0)
      return NextResponse.json({ success:false, error:'Prices cannot be negative' }, { status:400 })
    seen.add(itemId)
    clean.push({ itemId, qty, price,
      supplierName:      typeof l?.supplierName === 'string' && l.supplierName ? l.supplierName : null,
      supplierContact:   typeof l?.supplierContact === 'string' && l.supplierContact ? l.supplierContact : null,
      supplierAccountId: typeof l?.supplierAccountId === 'string' && l.supplierAccountId ? l.supplierAccountId : null })
  }

  // One read: cycle state, which items really belong to this club, and which
  // are already assigned so they cannot be dropped from under a member.
  const ctx = await sql(
    `SELECT
       (SELECT cy.status FROM "GroceryCycle" cy
         WHERE cy."clubId"=$1 AND cy."periodNumber"=$2)                      AS "cycleStatus",
       COALESCE((SELECT json_agg(gi.id) FROM "GroceryItem" gi
                  WHERE gi."clubId"=$1), '[]'::json)                         AS "validItems",
       COALESCE((SELECT json_agg(json_build_object('itemId', ga."itemId", 'name', gi2.name))
                   FROM "GroceryAssignment" ga
                   JOIN "GroceryItem" gi2 ON gi2.id = ga."itemId"
                  WHERE ga."clubId"=$1 AND ga."periodNumber"=$2
                    AND ga.status <> 'CANCELLED'), '[]'::json)               AS "assigned"`,
    [clubId, period]
  )
  const status = ctx[0]?.cycleStatus
  if (!status) return NextResponse.json({ success:false, error:`Cycle ${period} does not exist for this club` }, { status:404 })
  if (!['OPEN','REOPENED'].includes(String(status)))
    return NextResponse.json({ success:false,
      error:`Cycle ${period} is ${String(status).toLowerCase()}. Reopen it to change what the group is buying — contributions are derived from this plan.` },
      { status:409 })

  const valid = new Set<string>((ctx[0].validItems || []).map((x: any) => String(x)))
  const alien = clean.filter(l => !valid.has(l.itemId))
  if (alien.length)
    return NextResponse.json({ success:false, error:`${alien.length} item(s) do not belong to this club` }, { status:400 })

  const keeping = new Set(clean.map(l => l.itemId))
  const orphan  = (ctx[0].assigned || []).filter((a: any) => !keeping.has(String(a.itemId)))
  if (orphan.length) {
    const names = Array.from(new Set(orphan.map((a: any) => String(a.name))))
    return NextResponse.json({ success:false,
      error:`${names.join(', ')} ${names.length===1?'is':'are'} already assigned to a member for this period. Withdraw the assignment before removing ${names.length===1?'it':'them'} from the plan.` },
      { status:409 })
  }

  if (!clean.length) {
    await exec(`DELETE FROM "GroceryPeriodPurchase" WHERE "clubId"=$1 AND "periodNumber"=$2`, [clubId, period])
    await refreshPlannedTotal(clubId, period)
    return NextResponse.json({ success:true, data:{ lines:0, plannedTotal:0 }, message:'Period plan cleared' })
  }

  // Delete-what-is-gone and upsert-what-remains in ONE statement. The two
  // sets never overlap — the CTE only removes items absent from `incoming`
  // — so running both against the same snapshot is safe.
  const params: any[] = [clubId, period]
  const tuples = clean.map(l => {
    const b = params.length
    params.push(randomUUID(), l.itemId, l.qty, l.price, l.supplierName, l.supplierContact, l.supplierAccountId)
    return `($${b+1}::text,$${b+2}::text,$${b+3}::numeric,$${b+4}::numeric,$${b+5}::text,$${b+6}::text,$${b+7}::text)`
  }).join(',')

  await exec(
    `WITH incoming(id,"itemId",qty,price,"supName","supContact","supAcct") AS (VALUES ${tuples}),
          del AS (
            DELETE FROM "GroceryPeriodPurchase" p
             WHERE p."clubId"=$1 AND p."periodNumber"=$2
               AND p."itemId" NOT IN (SELECT i."itemId" FROM incoming i)
          )
     INSERT INTO "GroceryPeriodPurchase"
       (id,"clubId","periodNumber","itemId",qty,"unitPrice",
        "supplierName","supplierContact","supplierAccountId","createdAt","updatedAt")
     SELECT i.id,$1,$2,i."itemId",i.qty,i.price,
            i."supName",i."supContact",i."supAcct",NOW(),NOW() FROM incoming i
     ON CONFLICT ("clubId","periodNumber","itemId") DO UPDATE
       SET qty=EXCLUDED.qty, "unitPrice"=EXCLUDED."unitPrice",
           "supplierName"=EXCLUDED."supplierName",
           "supplierContact"=EXCLUDED."supplierContact",
           "supplierAccountId"=EXCLUDED."supplierAccountId",
           "updatedAt"=NOW()`,
    params
  )
  await refreshPlannedTotal(clubId, period)

  const total = clean.reduce((t, l) => t + l.qty * l.price, 0)
  return NextResponse.json({ success:true,
    data:{ lines: clean.length, plannedTotal: Number(total.toFixed(4)) },
    message:`Period ${period} plan saved — ${clean.length} item${clean.length===1?'':'s'}, $${total.toFixed(2)}.` })
}

// ── Period purchases ──────────────────────────────────────────
// "GroceryItem" is the catalogue — the full hamper the club works from.
// This is the subset the group agrees to buy with THIS period's money, and
// it is what sets the contribution. Prices are copied onto the line rather
// than read through to the catalogue, so editing a catalogue price next
// month cannot restate a cycle that has already settled.

// Period purchases may only change while the roll-call is still open. Once
// members have been told what to bring, the plan behind that figure is fixed.
async function periodEditable(clubId: string, period: number) {
  const cy = await sql(`SELECT status FROM "GroceryCycle" WHERE "clubId"=$1 AND "periodNumber"=$2`, [clubId, period])
  if (!cy.length) return { ok:false, error:`Cycle ${period} does not exist for this club`, status:404 }
  if (!['OPEN','REOPENED'].includes(String(cy[0].status)))
    return { ok:false, status:409,
      error:`Cycle ${period} is ${String(cy[0].status).toLowerCase()}. Reopen it to change what the group is buying — contributions are derived from this plan.` }
  return { ok:true }
}

async function handleSavePeriodPurchase(body: any): Promise<NextResponse> {
  const clubId = typeof body.clubId === 'string' ? body.clubId : ''
  const itemId = typeof body.itemId === 'string' ? body.itemId : ''
  const period = Number(body.periodNumber)
  const qty    = Number(body.qty)
  if (!clubId || !itemId || !Number.isInteger(period) || period < 1)
    return NextResponse.json({ success:false, error:'clubId, itemId and periodNumber are required' }, { status:400 })
  if (!Number.isFinite(qty) || qty <= 0)
    return NextResponse.json({ success:false, error:'Quantity must be greater than zero' }, { status:400 })

  const gate = await periodEditable(clubId, period)
  if (!gate.ok) return NextResponse.json({ success:false, error:gate.error }, { status:gate.status })

  // Default the price from the catalogue estimate, but let the group override
  // it — the point of a period plan is that prices move between cycles.
  const item = await sql(
    `SELECT name, unit, "estimatedUnitPrice" FROM "GroceryItem" WHERE id=$1 AND "clubId"=$2`, [itemId, clubId])
  if (!item.length) return NextResponse.json({ success:false, error:'Item not found in this club' }, { status:404 })
  const price = Number.isFinite(Number(body.unitPrice)) && Number(body.unitPrice) >= 0
    ? Number(body.unitPrice) : Number(item[0].estimatedUnitPrice || 0)

  await exec(
    `INSERT INTO "GroceryPeriodPurchase"
       (id,"clubId","periodNumber","itemId",qty,"unitPrice",notes,"createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
     ON CONFLICT ("clubId","periodNumber","itemId") DO UPDATE
       SET qty=EXCLUDED.qty, "unitPrice"=EXCLUDED."unitPrice",
           notes=EXCLUDED.notes, "updatedAt"=NOW()`,
    [randomUUID(), clubId, period, itemId, qty, price,
     typeof body.notes === 'string' && body.notes ? body.notes : null])

  await refreshPlannedTotal(clubId, period)
  return NextResponse.json({ success:true,
    message:`${qty} ${item[0].unit} of ${item[0].name} at $${price.toFixed(2)} added to period ${period}` })
}

async function handleRemovePeriodPurchase(body: any): Promise<NextResponse> {
  const clubId = typeof body.clubId === 'string' ? body.clubId : ''
  const itemId = typeof body.itemId === 'string' ? body.itemId : ''
  const period = Number(body.periodNumber)
  if (!clubId || !itemId || !Number.isInteger(period))
    return NextResponse.json({ success:false, error:'clubId, itemId and periodNumber are required' }, { status:400 })

  const gate = await periodEditable(clubId, period)
  if (!gate.ok) return NextResponse.json({ success:false, error:gate.error }, { status:gate.status })

  // Refuse if the line is already carrying assignments — removing it would
  // orphan a member's purchase obligation.
  const held = await sql(
    `SELECT COUNT(*)::int AS n FROM "GroceryAssignment"
      WHERE "clubId"=$1 AND "periodNumber"=$2 AND "itemId"=$3 AND status <> 'CANCELLED'`,
    [clubId, period, itemId])
  if (Number(held[0]?.n || 0) > 0)
    return NextResponse.json({ success:false,
      error:'This item is already assigned to a member for this period. Withdraw the assignment first.' }, { status:409 })

  await exec(`DELETE FROM "GroceryPeriodPurchase" WHERE "clubId"=$1 AND "periodNumber"=$2 AND "itemId"=$3`,
    [clubId, period, itemId])
  await refreshPlannedTotal(clubId, period)
  return NextResponse.json({ success:true, message:'Removed from this period' })
}

async function refreshPlannedTotal(clubId: string, period: number) {
  await exec(
    `UPDATE "GroceryCycle" cy
        SET "plannedTotal" = COALESCE((SELECT SUM(pp."lineTotal") FROM "GroceryPeriodPurchase" pp
                                        WHERE pp."clubId"=cy."clubId" AND pp."periodNumber"=cy."periodNumber"),0),
            "updatedAt" = NOW()
      WHERE cy."clubId"=$1 AND cy."periodNumber"=$2`, [clubId, period])
}

// ── Set the period contribution from the plan ─────────────────
// This is the figure members are told to bring to the last-day meeting. It
// is a TARGET: the final contribution re-derives at LOCK_CYCLE from what was
// actually assigned, across confirmed members only.
async function handleSetPeriodBudget(body: any): Promise<NextResponse> {
  const clubId = typeof body.clubId === 'string' ? body.clubId : ''
  const period = Number(body.periodNumber)
  if (!clubId || !Number.isInteger(period) || period < 1)
    return NextResponse.json({ success:false, error:'clubId and periodNumber are required' }, { status:400 })

  const gate = await periodEditable(clubId, period)
  if (!gate.ok) return NextResponse.json({ success:false, error:gate.error }, { status:gate.status })

  const [plan, members] = await Promise.all([
    sql(`SELECT COALESCE(SUM("lineTotal"),0) AS total, COUNT(*)::int AS lines
           FROM "GroceryPeriodPurchase" WHERE "clubId"=$1 AND "periodNumber"=$2`, [clubId, period]),
    sql(`SELECT "userId" FROM "GroceryMember" WHERE "clubId"=$1 AND "isActive"=true ORDER BY "userId"`, [clubId]),
  ])

  const lines = Number(plan[0]?.lines || 0)
  if (!lines)
    return NextResponse.json({ success:false, error:'Nothing selected for this period yet — add what the group is buying first.' }, { status:400 })
  if (!members.length)
    return NextResponse.json({ success:false, error:'Add members before setting the period contribution' }, { status:400 })

  const totalCents = cents(plan[0].total)
  if (totalCents <= 0)
    return NextResponse.json({ success:false, error:'The period plan totals zero. Set quantities and prices first.' }, { status:400 })

  const userIds = members.map((m: any) => String(m.userId))
  const split   = splitContribution(totalCents, userIds, period)
  const check   = [...split.values()].reduce((a, b) => a + b, 0)
  if (check !== totalCents)
    return NextResponse.json({ success:false, error:`Contribution split did not reconcile (${check} vs ${totalCents} cents). Nothing was written.` }, { status:500 })

  const params: any[] = [clubId, period]
  const tuples = userIds.map(u => {
    const b = params.length
    params.push(u, Number(money(split.get(u) as number)))
    return `($${b+1}::text,$${b+2}::numeric)`
  }).join(',')

  const baseCents = Math.floor(totalCents / userIds.length)
  await Promise.all([
    exec(`UPDATE "GroceryContribution" gc
             SET "amountDue" = v.amt, "updatedAt" = NOW()
            FROM (VALUES ${tuples}) AS v("userId", amt)
           WHERE gc."clubId"=$1 AND gc."periodNumber"=$2 AND gc."userId"=v."userId"`, params),
    exec(`UPDATE "GroceryCycle"
             SET "plannedTotal"=$1, "targetContribution"=$2, "budgetSetAt"=NOW(), "updatedAt"=NOW()
           WHERE "clubId"=$3 AND "periodNumber"=$4`,
         [Number(money(totalCents)), Number(money(baseCents)), clubId, period]),
  ])

  return NextResponse.json({ success:true,
    data:{ plannedTotal: Number(money(totalCents)), targetContribution: Number(money(baseCents)),
           memberCount: userIds.length, lines },
    message:`Period ${period}: $${money(totalCents)} of groceries across ${userIds.length} members — $${money(baseCents)} each.` })
}

// ── Save the whole roll-call at once ──────────────────────────
// hasFunds true = has the money, false = does not, null = clears the answer.
// Timestamps are preserved through COALESCE so re-saving an unchanged row
// does not restate when the member actually answered.
async function handleSaveRollCall(body: any): Promise<NextResponse> {
  const clubId    = typeof body.clubId === 'string' ? body.clubId : ''
  const period    = Number(body.periodNumber)
  const responses = Array.isArray(body.responses) ? body.responses : null
  if (!clubId || !Number.isInteger(period) || period < 1 || !responses)
    return NextResponse.json({ success:false, error:'clubId, periodNumber and responses are required' }, { status:400 })
  if (!responses.length)
    return NextResponse.json({ success:true, data:{ updated:0 }, message:'Nothing to save' })

  const clean: { userId: string; has: boolean | null; reason: string | null }[] = []
  const seen = new Set<string>()
  for (const r of responses) {
    const userId = typeof r?.userId === 'string' ? r.userId : ''
    if (!userId) return NextResponse.json({ success:false, error:'A response is missing its member' }, { status:400 })
    if (seen.has(userId)) return NextResponse.json({ success:false, error:'The same member appears twice' }, { status:400 })
    seen.add(userId)
    clean.push({
      userId,
      has: r.hasFunds === true ? true : r.hasFunds === false ? false : null,
      reason: typeof r?.reason === 'string' && r.reason ? r.reason : null,
    })
  }

  const cy = await sql(`SELECT status FROM "GroceryCycle" WHERE "clubId"=$1 AND "periodNumber"=$2`, [clubId, period])
  if (!cy.length) return NextResponse.json({ success:false, error:'Cycle not found' }, { status:404 })
  if (!['OPEN','REOPENED'].includes(String(cy[0].status)))
    return NextResponse.json({ success:false,
      error:`Cycle ${period} is ${String(cy[0].status).toLowerCase()} — the roll-call is closed. Reopen it to change a response.` },
      { status:409 })

  const params: any[] = [clubId, period, typeof body.recordedById === 'string' ? body.recordedById : null]
  const tuples = clean.map(r => {
    const b = params.length
    params.push(r.userId, r.has, r.reason)
    return `($${b+1}::text,$${b+2}::boolean,$${b+3}::text)`
  }).join(',')

  const done = await sql(
    `UPDATE "GroceryContribution" gc
        SET "fundsConfirmedAt"   = CASE WHEN v.has IS TRUE  THEN COALESCE(gc."fundsConfirmedAt", NOW()) ELSE NULL END,
            "fundsConfirmedById" = CASE WHEN v.has IS TRUE  THEN COALESCE(gc."fundsConfirmedById", $3) ELSE NULL END,
            "fundsDeclinedAt"    = CASE WHEN v.has IS FALSE THEN COALESCE(gc."fundsDeclinedAt", NOW()) ELSE NULL END,
            "declineReason"      = CASE WHEN v.has IS FALSE THEN v.reason ELSE NULL END,
            "updatedAt"          = NOW()
       FROM (VALUES ${tuples}) AS v("userId", has, reason)
      WHERE gc."clubId" = $1 AND gc."periodNumber" = $2 AND gc."userId" = v."userId"
      RETURNING gc."userId", gc."fundsConfirmedAt", gc."fundsDeclinedAt", gc."amountPayable"`,
    params
  )

  const yes = done.filter((r: any) => r.fundsConfirmedAt)
  const no  = done.filter((r: any) => r.fundsDeclinedAt)
  const pot = yes.reduce((t: number, r: any) => t + cents(r.amountPayable), 0)

  return NextResponse.json({ success:true,
    data:{ updated: done.length, confirmed: yes.length, declined: no.length,
           unanswered: done.length - yes.length - no.length,
           potIfClosedNow: Number(money(pot)) },
    message:`Roll-call saved — ${yes.length} with funds, ${no.length} without. $${money(pot)} in the room.` })
}

// ── Funds confirmation ────────────────────────────────────────
// A tick is not a payment. The member is holding cash they have not handed
// to anyone — they will not know who to pay until the settlement is solved.
async function handleFundsResponse(body: any, hasFunds: boolean): Promise<NextResponse> {
  const clubId = typeof body.clubId === 'string' ? body.clubId : ''
  const userId = typeof body.userId === 'string' ? body.userId : ''
  const period = Number(body.periodNumber)
  if (!clubId || !userId || !Number.isInteger(period) || period < 1)
    return NextResponse.json({ success:false, error:'clubId, userId and periodNumber are required' }, { status:400 })

  const cyc = await sql(`SELECT status FROM "GroceryCycle" WHERE "clubId"=$1 AND "periodNumber"=$2`, [clubId, period])
  if (!cyc.length) return NextResponse.json({ success:false, error:'Cycle not found' }, { status:404 })
  if (!['OPEN','REOPENED'].includes(String(cyc[0].status)))
    return NextResponse.json({ success:false, error:`Cycle ${period} is ${String(cyc[0].status).toLowerCase()} — the roll-call is closed. Reopen it to change a response.` }, { status:409 })

  const done = await sql(
    `UPDATE "GroceryContribution"
        SET "fundsConfirmedAt"   = ${hasFunds ? 'NOW()' : 'NULL'},
            "fundsConfirmedById" = ${hasFunds ? '$4' : 'NULL'},
            "fundsDeclinedAt"    = ${hasFunds ? 'NULL' : 'NOW()'},
            "declineReason"      = ${hasFunds ? 'NULL' : '$4'},
            "updatedAt"          = NOW()
      WHERE "clubId"=$1 AND "userId"=$2 AND "periodNumber"=$3
      RETURNING "amountPayable"`,
    [clubId, userId, period,
     hasFunds ? (typeof body.confirmedById === 'string' ? body.confirmedById : null)
              : (typeof body.reason === 'string' ? body.reason : null)]
  )
  if (!done.length)
    return NextResponse.json({ success:false, error:'No contribution row for that member in this period' }, { status:404 })

  return NextResponse.json({ success:true,
    message: hasFunds
      ? `Confirmed — $${fmtAmt(done[0].amountPayable)} available for this cycle`
      : `Recorded as not available. This contribution will carry forward as arrears.` })
}

// ── Lock the roll-call: OPEN -> FUNDED ────────────────────────
// Fixes who is in the cycle and how much money is in the room. Decliners are
// out entirely and their contribution is raised as arrears.
async function handleLockContributions(body: any): Promise<NextResponse> {
  const clubId = typeof body.clubId === 'string' ? body.clubId : ''
  const period = Number(body.periodNumber)
  if (!clubId || !Number.isInteger(period) || period < 1)
    return NextResponse.json({ success:false, error:'clubId and periodNumber are required' }, { status:400 })

  const [cyc, rows] = await Promise.all([
    sql(`SELECT status FROM "GroceryCycle" WHERE "clubId"=$1 AND "periodNumber"=$2`, [clubId, period]),
    sql(`SELECT gc.id, gc."userId", gc."amountDue", gc."carryAdjustment", gc."amountPayable",
                gc."fundsConfirmedAt", gc."fundsDeclinedAt", gc."arrearsCarriedAt",
                u."fullName" AS "memberName",
                COALESCE((SELECT SUM(cf.amount) FROM "GroceryCarryForward" cf
                           WHERE cf."clubId"=gc."clubId" AND cf."userId"=gc."userId"
                             AND cf."appliedPeriod"=gc."periodNumber"
                             AND cf.reason='OUT_OF_POCKET'),0)              AS "oop"
           FROM "GroceryContribution" gc
           JOIN "User" u ON u.id = gc."userId"
           JOIN "GroceryMember" gm ON gm."clubId"=gc."clubId" AND gm."userId"=gc."userId" AND gm."isActive"=true
          WHERE gc."clubId"=$1 AND gc."periodNumber"=$2`, [clubId, period]),
  ])

  if (!cyc.length) return NextResponse.json({ success:false, error:'Cycle not found' }, { status:404 })
  if (!['OPEN','REOPENED'].includes(String(cyc[0].status)))
    return NextResponse.json({ success:false, error:`Cycle ${period} is already ${String(cyc[0].status).toLowerCase()}` }, { status:409 })
  if (!rows.length) return NextResponse.json({ success:false, error:'No contribution rows for this period' }, { status:409 })

  // Everyone must have answered. Treating silence as a decline would quietly
  // drop a member from the cycle and raise arrears they never agreed to.
  const silent = rows.filter((r: any) => !r.fundsConfirmedAt && !r.fundsDeclinedAt)
  if (silent.length) {
    return NextResponse.json({ success:false,
      error:`${silent.length} member${silent.length===1?' has':'s have'} not answered yet: ${silent.map((r:any)=>r.memberName).join(', ')}` },
      { status:409 })
  }

  const confirmed = rows.filter((r: any) => r.fundsConfirmedAt)
  const declined  = rows.filter((r: any) => r.fundsDeclinedAt)
  if (!confirmed.length)
    return NextResponse.json({ success:false, error:'Nobody has funds available — there is nothing to assign this cycle.' }, { status:409 })

  // Pot = what confirmed members will actually hand over. Change they are
  // holding stays IN the pot (it is cash in the room); money the club owes
  // them comes OUT of it.
  const potCents = confirmed.reduce((t: number, r: any) => t + cents(r.amountDue) + cents(r.oop), 0)

  // Arrears for decliners, once only — "arrearsCarriedAt" makes a re-run a
  // no-op rather than doubling the debt.
  const toCarry = declined.filter((r: any) => !r.arrearsCarriedAt && cents(r.amountPayable) > 0)
  if (toCarry.length) {
    const params: any[] = [clubId]
    const tuples = toCarry.map((r: any) => {
      const b = params.length
      params.push(randomUUID(), String(r.userId), Number(r.amountPayable), String(r.id),
        `Contribution for period ${period} — funds not available`)
      return `($${b+1},$1,$${b+2},$${b+3},'ARREARS',$${b+4},$${b+5},NOW())`
    }).join(',')
    await exec(
      `INSERT INTO "GroceryCarryForward"
         (id,"clubId","userId",amount,reason,"sourceContributionId",notes,"createdAt")
       VALUES ${tuples}`, params)
    await exec(
      `UPDATE "GroceryContribution" SET "arrearsCarriedAt"=NOW(), "updatedAt"=NOW()
        WHERE id IN (${toCarry.map((_: any, i: number) => `$${i+1}`).join(',')})`,
      toCarry.map((r: any) => String(r.id)))
  }

  await exec(
    `UPDATE "GroceryCycle"
        SET status='FUNDED', "confirmedPot"=$1, "confirmedMemberCount"=$2,
            "declinedMemberCount"=$3, "fundedAt"=NOW(), "updatedAt"=NOW()
      WHERE "clubId"=$4 AND "periodNumber"=$5`,
    [Number(money(potCents)), confirmed.length, declined.length, clubId, period])

  return NextResponse.json({ success:true,
    data:{ confirmedPot: Number(money(potCents)), confirmed: confirmed.length,
           declined: declined.length, arrearsRaised: toCarry.length },
    message:`${confirmed.length} member${confirmed.length===1?'':'s'} confirmed — $${money(potCents)} available to assign.` +
            (declined.length ? ` ${declined.length} declined; their contributions carry as arrears.` : '') })
}

// ── Lock a cycle ──────────────────────────────────────────────
// Snapshots the assignment position, derives contributions from it and
// writes them onto the pre-generated rows for that period.
async function handleLockCycle(body: any): Promise<NextResponse> {
  const clubId = typeof body.clubId === 'string' ? body.clubId : ''
  const period = Number(body.periodNumber)
  if (!clubId || !Number.isInteger(period) || period < 1)
    return NextResponse.json({ success:false, error:'clubId and periodNumber are required' }, { status:400 })

  const [cycles, members, sums] = await Promise.all([
    sql(`SELECT * FROM "GroceryCycle" WHERE "clubId"=$1 AND "periodNumber"=$2`, [clubId, period]),
    sql(`SELECT gc."userId",
                COALESCE((SELECT SUM(cf.amount) FROM "GroceryCarryForward" cf
                           WHERE cf."clubId"=gc."clubId" AND cf."userId"=gc."userId"
                             AND cf."appliedPeriod"=gc."periodNumber"
                             AND cf.reason='OUT_OF_POCKET'),0) AS "oop",
                COALESCE(gc."carryAdjustment",0)               AS "carry"
           FROM "GroceryContribution" gc
          WHERE gc."clubId"=$1 AND gc."periodNumber"=$2
            AND gc."fundsConfirmedAt" IS NOT NULL
          ORDER BY gc."userId"`, [clubId, period]),
    sql(`SELECT COALESCE(SUM("advanceAmount"),0) AS total, COUNT(*) AS n
           FROM "GroceryAssignment"
          WHERE "clubId"=$1 AND "periodNumber"=$2 AND status <> 'CANCELLED'`, [clubId, period]),
  ])

  if (!cycles.length)
    return NextResponse.json({ success:false, error:`Cycle ${period} does not exist for this club` }, { status:404 })
  if (cycles[0].status !== 'FUNDED')
    return NextResponse.json({ success:false,
      error: cycles[0].status === 'OPEN'
        ? 'Close the funds roll-call first — contributions cannot be derived until you know who has money.'
        : `Cycle ${period} is already ${String(cycles[0].status).toLowerCase()}.` }, { status:409 })
  if (!members.length)
    return NextResponse.json({ success:false, error:'No members confirmed funds for this cycle' }, { status:400 })
  if (Number(sums[0].n) === 0)
    return NextResponse.json({ success:false, error:'Assign at least one item before locking — contributions are derived from what is assigned.' }, { status:400 })

  const totalCents = cents(sums[0].total)
  if (totalCents <= 0)
    return NextResponse.json({ success:false, error:'Assigned total is zero. Set the cash advances before locking.' }, { status:400 })

  const userIds = members.map((m: any) => String(m.userId))

  // Assignments cannot exceed what confirmed members are handing over.
  const potCents = cents(cycles[0].confirmedPot)
  if (totalCents > potCents) {
    return NextResponse.json({ success:false,
      error:`Assigned $${money(totalCents)} exceeds the $${money(potCents)} confirmed pot. Trim the list or reduce the advances.` },
      { status:409 })
  }

  // Money the club owes members comes out of the pot before it is shared, so
  // the base share is the assignable total net of those debts. Change a member
  // is HOLDING is not netted off — that cash is in the room and they can pay
  // it out; it only reduces the new money they must find.
  const oopCents  = members.reduce((t: number, m: any) => t + cents(m.oop), 0)
  const baseTotal = totalCents - oopCents
  const split     = splitContribution(baseTotal, userIds, period)

  // Reconciliation guard: base shares plus what the club owes must equal the
  // assigned total exactly, or the settlement cannot balance.
  const check = [...split.values()].reduce((a, b) => a + b, 0) + oopCents
  if (check !== totalCents)
    return NextResponse.json({ success:false, error:`Contribution split did not reconcile (${check} vs ${totalCents} cents). Nothing was written.` }, { status:500 })

  // One statement for every member's amountDue, joined against a VALUES list.
  const params: any[] = [clubId, period]
  const tuples = userIds.map(u => {
    const b = params.length
    params.push(u, Number(money(split.get(u) as number)))
    return `($${b+1}::text,$${b+2}::numeric)`
  }).join(',')

  await exec(
    `UPDATE "GroceryContribution" gc
        SET "amountDue" = v.amt, "updatedAt" = NOW()
       FROM (VALUES ${tuples}) AS v("userId", amt)
      WHERE gc."clubId" = $1 AND gc."periodNumber" = $2 AND gc."userId" = v."userId"`,
    params
  )

  const baseCents = Math.floor(baseTotal / userIds.length)
  await exec(
    `UPDATE "GroceryCycle"
        SET status='LOCKED', "assignedTotal"=$1, "memberCount"=$2,
            "baseContribution"=$3, "roundingCents"=$4,
            "lockedAt"=NOW(), "lockedById"=$5, "updatedAt"=NOW()
      WHERE "clubId"=$6 AND "periodNumber"=$7`,
    [Number(money(totalCents)), userIds.length, Number(money(baseCents)),
     totalCents - baseCents * userIds.length,
     typeof body.lockedById === 'string' ? body.lockedById : null, clubId, period]
  )

  return NextResponse.json({ success:true,
    data:{ assignedTotal: Number(money(totalCents)), memberCount: userIds.length,
           baseContribution: Number(money(baseCents)),
           roundingCents: totalCents - baseCents * userIds.length },
    message:`Cycle ${period} locked. $${money(totalCents)} assigned across ${userIds.length} confirmed member${userIds.length===1?'':'s'} — $${money(baseCents)} each.` })
}

// ── Solve the settlement ──────────────────────────────────────
async function handleSolveSettlement(body: any): Promise<NextResponse> {
  const clubId = typeof body.clubId === 'string' ? body.clubId : ''
  const period = Number(body.periodNumber)
  if (!clubId || !Number.isInteger(period) || period < 1)
    return NextResponse.json({ success:false, error:'clubId and periodNumber are required' }, { status:400 })

  const [cycles, contribs, assigns, confirmed, clubs] = await Promise.all([
    sql(`SELECT * FROM "GroceryCycle" WHERE "clubId"=$1 AND "periodNumber"=$2`, [clubId, period]),
    sql(`SELECT gc."userId", gc."amountDue", gc."carryAdjustment", gc."amountPayable",
                COALESCE((SELECT SUM(cf.amount) FROM "GroceryCarryForward" cf
                           WHERE cf."clubId"=gc."clubId" AND cf."userId"=gc."userId"
                             AND cf."appliedPeriod"=gc."periodNumber"
                             AND cf.reason='CHANGE_HELD'),0) AS "held"
           FROM "GroceryContribution" gc
          WHERE gc."clubId"=$1 AND gc."periodNumber"=$2
            AND gc."fundsConfirmedAt" IS NOT NULL`, [clubId, period]),
    sql(`SELECT "userId","advanceAmount","fundingMode","supplierAccountId"
           FROM "GroceryAssignment"
          WHERE "clubId"=$1 AND "periodNumber"=$2 AND status <> 'CANCELLED'`, [clubId, period]),
    sql(`SELECT "payerId","payeeType","payeeUserId","payeeSupplierId","amountCents"
           FROM "GrocerySettlementTransfer"
          WHERE "clubId"=$1 AND "periodNumber"=$2 AND status='CONFIRMED'`, [clubId, period]),
    sql(`SELECT currency FROM "GroceryClub" WHERE id=$1`, [clubId]),
  ])

  if (!cycles.length)
    return NextResponse.json({ success:false, error:'Cycle not found' }, { status:404 })
  if (!['LOCKED','SETTLED'].includes(String(cycles[0].status)))
    return NextResponse.json({ success:false, error:'Lock the cycle before solving the settlement — contributions are not issued until it is locked.' }, { status:409 })
  if (!contribs.length)
    return NextResponse.json({ success:false, error:'No confirmed members for this period — nobody has funds available.' }, { status:409 })

  // B(i) = purchases assigned to the member − their contribution.
  // SUPPLIER_DIRECT lines do not put cash in a member's hands, so they do
  // not raise that member's requirement; the supplier account becomes its
  // own receiver node instead.
  const bal = new Map<string, number>()
  for (const c of contribs) {
    const payable = c.amountPayable != null
      ? cents(c.amountPayable)
      : cents(c.amountDue) + cents(c.carryAdjustment)
    // Change held is negative in "carryAdjustment" because it reduces the NEW
    // cash the member brings — but they are holding that cash and can pay it
    // out, so it must not reduce what they put into the settlement.
    const contribution = payable - cents(c.held)
    bal.set(String(c.userId), -contribution)
  }
  const supplier = new Map<string, number>()
  for (const a of assigns) {
    const amt = cents(a.advanceAmount)
    if (String(a.fundingMode) === 'SUPPLIER_DIRECT' && a.supplierAccountId) {
      supplier.set(String(a.supplierAccountId), (supplier.get(String(a.supplierAccountId)) || 0) + amt)
    } else {
      const k = String(a.userId)
      // A decliner has no node. Adding their assignment here would unbalance
      // the graph against a contribution that is never coming.
      if (!bal.has(k)) continue
      bal.set(k, (bal.get(k) as number) + amt)
    }
  }

  // Money already CONFIRMED is settled and must not be re-instructed.
  for (const t of confirmed) {
    const amt = Number(t.amountCents)
    bal.set(String(t.payerId), (bal.get(String(t.payerId)) || 0) + amt)
    if (String(t.payeeType) === 'MEMBER' && t.payeeUserId) {
      bal.set(String(t.payeeUserId), (bal.get(String(t.payeeUserId)) || 0) - amt)
    } else if (t.payeeSupplierId) {
      supplier.set(String(t.payeeSupplierId), (supplier.get(String(t.payeeSupplierId)) || 0) - amt)
    }
  }

  const nodes: SettleNode[] = [
    ...[...bal.entries()].map(([key, b]) => ({ key, type:'MEMBER' as const, bal:b })),
    ...[...supplier.entries()].map(([key, need]) => ({ key, type:'SUPPLIER' as const, bal:need })),
  ]

  // Explicit failure over a set of instructions that cannot reconcile. If
  // payers and receivers do not offset, the underlying figures are wrong and
  // issuing instructions would move the wrong money.
  const owed = nodes.filter(n => n.bal < 0).reduce((t, n) => t - n.bal, 0)
  const need = nodes.filter(n => n.bal > 0).reduce((t, n) => t + n.bal, 0)
  if (owed !== need) {
    return NextResponse.json({ success:false,
      error:`Settlement does not reconcile: $${money(owed)} payable against $${money(need)} receivable (difference $${money(Math.abs(owed-need))}). This usually means carry-forward credits have changed the contributions since the cycle was locked. Re-lock the cycle, then solve.` },
      { status:409 })
  }

  const transfers = solveSettlement(nodes)
  const batchId   = randomUUID()
  const currency  = String(clubs[0]?.currency || 'USD')

  // Supersede the previous instruction set. CONFIRMED rows are left alone —
  // they are already netted out of the balances above.
  await exec(
    `UPDATE "GrocerySettlementTransfer"
        SET status='CANCELLED', "cancelledAt"=NOW(), "updatedAt"=NOW()
      WHERE "clubId"=$1 AND "periodNumber"=$2 AND status IN ('INSTRUCTED','CLAIMED')`,
    [clubId, period]
  )

  if (transfers.length) {
    const params: any[] = [clubId, period, batchId, currency]
    const tuples = transfers.map(t => {
      const b = params.length
      params.push(randomUUID(), t.payer,
        t.payeeType === 'MEMBER' ? t.payee : null,
        t.payeeType === 'SUPPLIER' ? t.payee : null,
        t.cents, Number(money(t.cents)), t.payeeType)
      return `($${b+1},$1,$2,$${b+2},$${b+7},$${b+3},$${b+4},$${b+5},$${b+6},$4,'INSTRUCTED',$3,NOW(),NOW())`
    }).join(',')

    await exec(
      `INSERT INTO "GrocerySettlementTransfer"
         (id,"clubId","periodNumber","payerId","payeeType","payeeUserId","payeeSupplierId",
          "amountCents",amount,currency,status,"solveBatchId","createdAt","updatedAt")
       VALUES ${tuples}`,
      params
    )
  }

  await exec(
    `UPDATE "GroceryCycle" SET status='SETTLED', "settledAt"=NOW(), "updatedAt"=NOW()
      WHERE "clubId"=$1 AND "periodNumber"=$2`, [clubId, period]
  )

  return NextResponse.json({ success:true,
    data:{ transfers: transfers.length, totalCents: transfers.reduce((t, x) => t + x.cents, 0), batchId },
    message:`Settlement solved: ${transfers.length} payment${transfers.length===1?'':'s'} moving $${money(transfers.reduce((t,x)=>t+x.cents,0))}.` })
}

// ── Attestation ───────────────────────────────────────────────
// The platform moves no money. It records that the payer says they paid and
// that the payee agrees. Only CONFIRMED funds a buyer's basket.
async function handleTransferState(body: any, next: 'CLAIMED'|'CONFIRMED'|'DISPUTED'): Promise<NextResponse> {
  const id = typeof body.transferId === 'string' ? body.transferId : ''
  if (!id) return NextResponse.json({ success:false, error:'transferId is required' }, { status:400 })

  const allowedFrom: Record<string, string[]> = {
    CLAIMED:   ['INSTRUCTED','DISPUTED'],
    CONFIRMED: ['INSTRUCTED','CLAIMED','DISPUTED'],
    DISPUTED:  ['CLAIMED','CONFIRMED'],
  }
  const from = allowedFrom[next].map(x => `'${x}'`).join(',')

  const stamp =
    next === 'CLAIMED'   ? `"claimedAt"=NOW(), "paymentReference"=COALESCE($2,"paymentReference")`
  : next === 'CONFIRMED' ? `"confirmedAt"=NOW(), "confirmedById"=$2`
  :                        `"disputedAt"=NOW(), "disputeReason"=$2`

  const arg = typeof body.reference === 'string' ? body.reference
            : typeof body.confirmedById === 'string' ? body.confirmedById
            : typeof body.reason === 'string' ? body.reason : null

  const done = await sql(
    `UPDATE "GrocerySettlementTransfer"
        SET status=$3, ${stamp}, "updatedAt"=NOW()
      WHERE id=$1 AND status IN (${from})
      RETURNING id, amount, status`,
    [id, arg, next]
  )
  if (!done.length) {
    return NextResponse.json({ success:false,
      error:`This payment cannot move to ${next.toLowerCase()} from its current state.` }, { status:409 })
  }

  const label = next === 'CLAIMED' ? 'marked as sent'
              : next === 'CONFIRMED' ? 'confirmed as received' : 'flagged as disputed'
  return NextResponse.json({ success:true, message:`Payment of $${fmtAmt(done[0].amount)} ${label}` })
}

function fmtAmt(v: any) { return Number(v || 0).toFixed(2) }

// ── Assignment helpers ────────────────────────────────────────

// NOTE — v1.4 had a cashPosition() guard refusing advances that exceeded cash
// collected. That is wrong under the confirmed model: contributions are
// DERIVED from the assigned total, so nothing is collected until the cycle is
// locked, and the guard would refuse the very first assignment of every cycle.
// The ceiling is now structural — assigned total defines what members owe —
// and the reconciliation check lives in handleSolveSettlement.

// NOTE — syncItemMirror was removed in v1.11. It wrote the assignee back
// onto "GroceryItem", a column that can hold one name while a line may be
// split across several members, so the mirror was lossy by construction.
// Assignment state is read from "GroceryAssignment" only.

// Applies every unapplied carry-forward row for a member to their earliest
// unpaid contribution. Contribution rows for all periods are written up front
// at activation, so there is no row-creation moment to fold the variance into
// — it has to land on an existing row.
//
// If the credit exceeds what that period can absorb, the remainder is written
// back as a fresh unapplied ADJUSTMENT row so it lands on the period after.
// Nothing is discarded and nothing is applied twice: rows are stamped with
// "appliedPeriod" in the same statement that consumes them.
async function applyCarryForward(clubId: string, userId: string) {
  const [pending, target] = await Promise.all([
    sql(`SELECT id, amount FROM "GroceryCarryForward"
          WHERE "clubId"=$1 AND "userId"=$2 AND "appliedPeriod" IS NULL
          ORDER BY "createdAt" ASC`, [clubId, userId]),
    sql(`SELECT id, "periodNumber", "amountDue", "carryAdjustment"
           FROM "GroceryContribution"
          WHERE "clubId"=$1 AND "userId"=$2 AND status <> 'PAID'
          ORDER BY "periodNumber" ASC
          LIMIT 1`, [clubId, userId]),
  ])

  if (!pending.length) return { applied: 0, carried: 0, periodNumber: null as number | null }

  const total = pending.reduce((sum: number, r: any) => sum + Number(r.amount), 0)

  // No unpaid period left to net against — the balance is a cash settlement
  // between the club and the member. The rows stay unapplied and surface on
  // close-out rather than being silently dropped.
  if (!target.length) {
    return { applied: 0, carried: total, periodNumber: null as number | null, settleInCash: true }
  }

  const row      = target[0]
  const payable  = Number(row.amountDue) + Number(row.carryAdjustment)
  // Credit is negative. This period can absorb at most `payable` of it.
  const absorb   = total < 0 ? Math.max(total, -payable) : total
  const leftover = Number((total - absorb).toFixed(4))

  const ids     = pending.map((r: any) => r.id)
  const holders = ids.map((_: string, i: number) => `$${i + 2}`).join(',')

  await Promise.all([
    exec(`UPDATE "GroceryContribution"
             SET "carryAdjustment" = "carryAdjustment" + $1,
                 "updatedAt" = NOW()
           WHERE id = $2`, [absorb, row.id]),
    exec(`UPDATE "GroceryCarryForward"
             SET "appliedPeriod" = $1, "appliedAt" = NOW()
           WHERE id IN (${holders}) AND "appliedPeriod" IS NULL`,
         [Number(row.periodNumber), ...ids]),
  ])

  if (leftover !== 0) {
    await exec(
      `INSERT INTO "GroceryCarryForward" (id,"clubId","userId",amount,reason,notes,"createdAt")
       VALUES ($1,$2,$3,$4,'ADJUSTMENT',$5,NOW())`,
      [randomUUID(), clubId, userId, leftover,
       `Balance carried past period ${row.periodNumber} — credit exceeded that period's contribution`]
    )
  }

  return { applied: absorb, carried: leftover, periodNumber: Number(row.periodNumber) }
}

// ── Item status transitions ───────────────────────────────────

// Assign a quantity of a line item to a member, together with the cash
// advance they are handed to buy it. Upsert against the plain unique index
// ("itemId","userId") — re-assigning the same member to the same item revises
// their advance rather than creating a second row.
async function handleAssignItem(body: any): Promise<NextResponse> {
  const itemId = typeof body.itemId === 'string' ? body.itemId : ''
  const userId = typeof body.assignedToId === 'string' && body.assignedToId ? body.assignedToId : null

  if (!itemId) return NextResponse.json({ success:false, error:'itemId is required' }, { status:400 })
  if (!userId) return NextResponse.json({ success:false, error:'Select the member responsible for buying this item' }, { status:400 })

  const qty     = Number(body.qtyAssigned)
  const advance = Number(body.advanceAmount)
  const period  = Number.isInteger(Number(body.periodNumber)) ? Number(body.periodNumber) : 1
  const mode    = body.fundingMode === 'SUPPLIER_DIRECT' ? 'SUPPLIER_DIRECT' : 'MEMBER_CASH'
  const supplierId = mode === 'SUPPLIER_DIRECT' && typeof body.supplierAccountId === 'string' && body.supplierAccountId
    ? body.supplierAccountId : null
  if (mode === 'SUPPLIER_DIRECT' && !supplierId)
    return NextResponse.json({ success:false, error:'Choose the supplier account this purchase will be paid into' }, { status:400 })
  if (!Number.isFinite(qty) || qty <= 0)
    return NextResponse.json({ success:false, error:'Quantity must be greater than zero' }, { status:400 })
  if (!Number.isFinite(advance) || advance < 0)
    return NextResponse.json({ success:false, error:'Advance cannot be negative' }, { status:400 })

  // Item, club, remaining quantity and the member's standing in one trip.
  const ctx = await sql(
    `SELECT gi."clubId", gi.name, gi.unit, gi.status::text AS "itemStatus", gi."totalQty",
            COALESCE((SELECT SUM(ga."qtyAssigned") FROM "GroceryAssignment" ga
                       WHERE ga."itemId"=gi.id AND ga.status <> 'CANCELLED'
                         AND ga."periodNumber"=$3
                         AND ga."userId" <> $2), 0)                       AS "qtyOthers",
            (SELECT pp.qty FROM "GroceryPeriodPurchase" pp
              WHERE pp."clubId"=gi."clubId" AND pp."periodNumber"=$3
                AND pp."itemId"=gi.id)                                    AS "planQty",
            (SELECT ga2.id FROM "GroceryAssignment" ga2
              WHERE ga2."itemId"=gi.id AND ga2."userId"=$2)               AS "existingId",
            (SELECT ga3.status FROM "GroceryAssignment" ga3
              WHERE ga3."itemId"=gi.id AND ga3."userId"=$2)               AS "existingStatus",
            EXISTS (SELECT 1 FROM "GroceryMember" gm
                     WHERE gm."clubId"=gi."clubId" AND gm."userId"=$2
                       AND gm."isActive"=true)                            AS "isMember",
            (SELECT cy.status FROM "GroceryCycle" cy
              WHERE cy."clubId"=gi."clubId" AND cy."periodNumber"=$3)     AS "cycleStatus",
            (SELECT cy2."confirmedPot" FROM "GroceryCycle" cy2
              WHERE cy2."clubId"=gi."clubId" AND cy2."periodNumber"=$3)   AS "confirmedPot",
            (SELECT gc2."fundsConfirmedAt" IS NOT NULL FROM "GroceryContribution" gc2
              WHERE gc2."clubId"=gi."clubId" AND gc2."userId"=$2
                AND gc2."periodNumber"=$3)                                AS "hasFunds",
            COALESCE((SELECT SUM(ga4."advanceAmount") FROM "GroceryAssignment" ga4
                       WHERE ga4."clubId"=gi."clubId" AND ga4."periodNumber"=$3
                         AND ga4.status <> 'CANCELLED'
                         AND NOT (ga4."itemId"=gi.id AND ga4."userId"=$2)),0) AS "advancedOther",
            (SELECT u."fullName" FROM "User" u WHERE u.id=$2)             AS "memberName"
       FROM "GroceryItem" gi
      WHERE gi.id = $1`,
    [itemId, userId, period]
  )
  if (!ctx.length) return NextResponse.json({ success:false, error:'Item not found' }, { status:404 })
  const c = ctx[0]

  if (!c.isMember)
    return NextResponse.json({ success:false, error:'That person is not an active member of this grocery club. Add them on the Members tab first.' }, { status:409 })
  if (['PURCHASED','DISTRIBUTED'].includes(String(c.itemStatus)))
    return NextResponse.json({ success:false, error:`This item is already ${String(c.itemStatus).toLowerCase()} and can no longer be assigned.` }, { status:409 })
  if (c.existingId && String(c.existingStatus) === 'ACQUITTED')
    return NextResponse.json({ success:false, error:`${c.memberName} has already acquitted their assignment on this item. Reverse it before re-assigning.` }, { status:409 })

  // The ceiling is what the group agreed to buy this period, not what the
  // catalogue says the full hamper contains. An item absent from the period
  // plan cannot be assigned at all — nobody agreed to fund it.
  if (c.planQty == null) {
    return NextResponse.json({ success:false,
      error:`${c.name} is not in the period ${period} purchase list. Add it on Period Purchases first.` }, { status:409 })
  }
  const qtyOthers = Number(c.qtyOthers)
  const planQty   = Number(c.planQty)
  if (qtyOthers + qty > planQty) {
    return NextResponse.json({ success:false,
      error:`Only ${planQty - qtyOthers} ${c.unit} of the ${planQty} planned for this period remain unassigned.` }, { status:409 })
  }

  // Contributions for a locked cycle have already been derived from the
  // assignments and, once solved, members are holding payment instructions
  // based on them. Changing an assignment now would invalidate those.
  if (String(c.cycleStatus) === 'OPEN' || String(c.cycleStatus) === 'REOPENED') {
    return NextResponse.json({ success:false,
      error:'Close the funds roll-call first. Items are assigned against money members have confirmed they hold, so the pot must be known before anything can be allocated.' },
      { status:409 })
  }
  if (c.cycleStatus && String(c.cycleStatus) !== 'FUNDED') {
    return NextResponse.json({ success:false,
      error:`Cycle ${period} is ${String(c.cycleStatus).toLowerCase()}. Reopen it to change assignments — contributions and payment instructions are derived from them.` },
      { status:409 })
  }
  if (c.hasFunds === false) {
    return NextResponse.json({ success:false,
      error:`${c.memberName} did not confirm funds for this cycle, so they cannot be given a purchase to make.` },
      { status:409 })
  }

  // The room only holds what members confirmed. Advancing beyond it would
  // instruct payments that cannot be funded.
  const potCents  = cents(c.confirmedPot)
  const otherCents = cents(c.advancedOther)
  if (cents(advance) + otherCents > potCents) {
    return NextResponse.json({ success:false,
      error:`Advance of $${advance.toFixed(2)} would take total assignments to $${money(otherCents + cents(advance))}, above the $${money(potCents)} confirmed pot.` },
      { status:409 })
  }

  await exec(
    `INSERT INTO "GroceryAssignment"
       (id,"clubId","itemId","userId","qtyAssigned","advanceAmount",status,notes,
        "periodNumber","fundingMode","supplierAccountId","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,'ASSIGNED',$7,$8,$9,$10,NOW(),NOW())
     ON CONFLICT ("itemId","userId") DO UPDATE
       SET "qtyAssigned"       = EXCLUDED."qtyAssigned",
           "advanceAmount"     = EXCLUDED."advanceAmount",
           status              = 'ASSIGNED',
           notes               = EXCLUDED.notes,
           "periodNumber"      = EXCLUDED."periodNumber",
           "fundingMode"       = EXCLUDED."fundingMode",
           "supplierAccountId" = EXCLUDED."supplierAccountId",
           "actualSpent"   = NULL,
           "acquittedAt"   = NULL,
           "updatedAt"     = NOW()`,
    [randomUUID(), String(c.clubId), itemId, userId, qty, advance,
     typeof body.notes === 'string' && body.notes ? body.notes : null,
     period, mode, supplierId]
  )


  return NextResponse.json({ success:true,
    message:`${c.memberName} assigned ${qty} ${c.unit} of ${c.name} with a $${advance.toFixed(2)} advance` })
}

// Withdraw an assignment. An acquitted one cannot simply be dropped — its
// variance is already in the carry-forward ledger.
async function handleCancelAssignment(body: any): Promise<NextResponse> {
  const itemId = typeof body.itemId === 'string' ? body.itemId : ''
  const userId = typeof body.assignedToId === 'string' ? body.assignedToId : ''
  if (!itemId || !userId)
    return NextResponse.json({ success:false, error:'itemId and assignedToId are required' }, { status:400 })

  const done = await sql(
    `UPDATE "GroceryAssignment"
        SET status='CANCELLED', "updatedAt"=NOW()
      WHERE "itemId"=$1 AND "userId"=$2 AND status IN ('ASSIGNED','PURCHASED')
      RETURNING id`,
    [itemId, userId]
  )
  if (!done.length) {
    return NextResponse.json({ success:false,
      error:'No open assignment found. An acquitted assignment must be reversed, not cancelled.' }, { status:409 })
  }

  return NextResponse.json({ success:true, message:'Assignment withdrawn' })
}

// Record what the member actually spent, write the signed variance to the
// carry-forward ledger and apply it to their next unpaid contribution.
//
// The variance is NEGATIVE either way, because both directions reduce the new
// cash the member brings. "reason" is what tells them apart:
//   CHANGE_HELD    spent < advance — member is holding the club's cash
//   OUT_OF_POCKET  spent > advance — club owes the member
async function handleAcquitAssignment(body: any): Promise<NextResponse> {
  const assignmentId = typeof body.assignmentId === 'string' ? body.assignmentId : ''
  const actualSpent  = Number(body.actualSpent)

  if (!assignmentId) return NextResponse.json({ success:false, error:'assignmentId is required' }, { status:400 })
  if (!Number.isFinite(actualSpent) || actualSpent < 0)
    return NextResponse.json({ success:false, error:'Enter what was actually spent' }, { status:400 })

  const rows = await sql(
    `SELECT ga.id, ga."clubId", ga."itemId", ga."userId", ga."advanceAmount", ga.status,
            gi.name AS "itemName", u."fullName" AS "memberName"
       FROM "GroceryAssignment" ga
       JOIN "GroceryItem" gi ON gi.id = ga."itemId"
       JOIN "User" u         ON u.id  = ga."userId"
      WHERE ga.id = $1`,
    [assignmentId]
  )
  if (!rows.length) return NextResponse.json({ success:false, error:'Assignment not found' }, { status:404 })
  const a = rows[0]

  if (String(a.status) === 'ACQUITTED')
    return NextResponse.json({ success:false, error:'This assignment has already been acquitted' }, { status:409 })
  if (String(a.status) === 'CANCELLED')
    return NextResponse.json({ success:false, error:'This assignment was withdrawn' }, { status:409 })

  const advance  = Number(a.advanceAmount)
  const variance = Number((advance - actualSpent).toFixed(4))

  await exec(
    `UPDATE "GroceryAssignment"
        SET "actualSpent"=$1, status='ACQUITTED',
            "purchasedAt"=COALESCE("purchasedAt",NOW()),
            "acquittedAt"=NOW(),
            "receiptUrl"=COALESCE($2,"receiptUrl"),
            "updatedAt"=NOW()
      WHERE id=$3`,
    [actualSpent, typeof body.receiptUrl === 'string' && body.receiptUrl ? body.receiptUrl : null, assignmentId]
  )

  let applied: any = { applied: 0, carried: 0, periodNumber: null }
  if (variance !== 0) {
    await exec(
      `INSERT INTO "GroceryCarryForward"
         (id,"clubId","userId","assignmentId",amount,reason,notes,"createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT DO NOTHING`,
      [randomUUID(), String(a.clubId), String(a.userId), assignmentId,
       -Math.abs(variance),
       variance > 0 ? 'CHANGE_HELD' : 'OUT_OF_POCKET',
       variance > 0
         ? `Holding $${variance.toFixed(2)} change from ${a.itemName}`
         : `Out of pocket $${Math.abs(variance).toFixed(2)} on ${a.itemName}`]
    )
    applied = await applyCarryForward(String(a.clubId), String(a.userId))
  }

  // Roll the item's actual cost up from its assignments, and close the item
  // once nothing is still open on it.
  await exec(
    `UPDATE "GroceryItem" gi
        SET "actualTotalPrice" = (SELECT SUM(COALESCE(ga."actualSpent",0))
                                    FROM "GroceryAssignment" ga
                                   WHERE ga."itemId"=gi.id AND ga.status='ACQUITTED'),
            status = CASE WHEN NOT EXISTS (
                            SELECT 1 FROM "GroceryAssignment" ga2
                             WHERE ga2."itemId"=gi.id
                               AND ga2.status IN ('ASSIGNED','PURCHASED'))
                          THEN 'PURCHASED'::"GroceryItemStatus" ELSE gi.status END,
            "purchasedAt" = COALESCE(gi."purchasedAt", NOW()),
            "updatedAt" = NOW()
      WHERE gi.id = $1`,
    [String(a.itemId)]
  )
  await exec(
    `UPDATE "GroceryClub"
        SET "totalSpent" = (SELECT COALESCE(SUM("actualSpent"),0)
                              FROM "GroceryAssignment"
                             WHERE "clubId"=$1 AND status='ACQUITTED'),
            "updatedAt" = NOW()
      WHERE id = $1`,
    [String(a.clubId)]
  )

  const tail = variance === 0
    ? 'Advance matched the spend exactly.'
    : applied.settleInCash
      ? (variance > 0
          ? `${a.memberName} holds $${variance.toFixed(2)} — no unpaid period left, settle in cash.`
          : `Club owes ${a.memberName} $${Math.abs(variance).toFixed(2)} — no unpaid period left, settle in cash.`)
      : (variance > 0
          ? `${a.memberName} holds $${variance.toFixed(2)} change — credited against period ${applied.periodNumber}.`
          : `${a.memberName} was $${Math.abs(variance).toFixed(2)} out of pocket — credited against period ${applied.periodNumber}.`)

  return NextResponse.json({ success:true,
    data:{ variance, appliedToPeriod: applied.periodNumber, carriedFurther: applied.carried },
    message:`${a.itemName} acquitted. ${tail}` })
}

async function handleMarkPurchased(body: any): Promise<NextResponse> {
  const { itemId, clubId, actualUnitPrice, actualTotalPrice, purchasedById, purchasedByName, receiptUrl, notes } = body
  await exec(
    `UPDATE "GroceryItem" SET status='PURCHASED'::"GroceryItemStatus","actualUnitPrice"=$1,"actualTotalPrice"=$2,
      "purchasedAt"=NOW(),"purchasedById"=$3,"purchasedByName"=$4,"receiptUrl"=$5,notes=$6,"updatedAt"=NOW() WHERE id=$7`,
    [actualUnitPrice||null, actualTotalPrice||null, purchasedById||null, purchasedByName||null, receiptUrl||null, notes||null, itemId]
  )
  // Update total spent
  await exec(
    `UPDATE "GroceryClub" SET "totalSpent"=(SELECT COALESCE(SUM("actualTotalPrice"),0) FROM "GroceryItem" WHERE "clubId"=$1 AND status='PURCHASED'),"updatedAt"=NOW() WHERE id=$1`,
    [clubId]
  )
  // Check if all items purchased — move to PURCHASING status
  const pending = await sql(`SELECT COUNT(*) as cnt FROM "GroceryItem" WHERE "clubId"=$1 AND status NOT IN ('PURCHASED','DISTRIBUTED')`, [clubId])
  if (Number((pending[0] as any).cnt) === 0) {
    await exec(`UPDATE "GroceryClub" SET status='PURCHASING'::"GroceryClubStatus","updatedAt"=NOW() WHERE id=$1`, [clubId])
  }
  return NextResponse.json({ success:true, message:'Item marked as purchased' })
}

async function handleMarkDistributed(body: any): Promise<NextResponse> {
  const { clubId, itemId } = body
  if (itemId) {
    await exec(`UPDATE "GroceryItem" SET status='DISTRIBUTED'::"GroceryItemStatus","distributedAt"=NOW(),"updatedAt"=NOW() WHERE id=$1`, [itemId])
  } else {
    // Mark all purchased items as distributed
    await exec(`UPDATE "GroceryItem" SET status='DISTRIBUTED'::"GroceryItemStatus","distributedAt"=NOW(),"updatedAt"=NOW() WHERE "clubId"=$1 AND status='PURCHASED'`, [clubId])
    await exec(`UPDATE "GroceryClub" SET status='DISTRIBUTED'::"GroceryClubStatus","updatedAt"=NOW() WHERE id=$1`, [clubId])
  }
  return NextResponse.json({ success:true, message:'Items marked as distributed' })
}

// ── Contributions ─────────────────────────────────────────────
async function handlePayContrib(body: any): Promise<NextResponse> {
  const { contributionId, amountPaid, paymentMethod, paymentRef } = body
  const contribs = await sql(`SELECT * FROM "GroceryContribution" WHERE id=$1`, [contributionId])
  if (!contribs.length) return NextResponse.json({ success:false, error:'Contribution not found' }, { status:404 })
  const c = contribs[0]

  const newPaid = Number(c.amountPaid) + Number(amountPaid)
  const isPaid  = newPaid >= Number(c.amountDue)

  await exec(
    `UPDATE "GroceryContribution" SET "amountPaid"=$1,status=$2::"GroceryContribStatus","paidAt"=$3,"paymentMethod"=$4,"paymentRef"=$5,"updatedAt"=NOW() WHERE id=$6`,
    [newPaid, isPaid?'PAID':'PARTIAL', isPaid?new Date():null, paymentMethod||null, paymentRef||null, contributionId]
  )
  await recalcTotals(c.clubId)
  return NextResponse.json({ success:true, message: isPaid ? `✅ Period #${c.periodNumber} paid` : 'Partial payment recorded' })
}

async function handleMarkPeriodPaid(body: any): Promise<NextResponse> {
  const { clubId, periodNumber } = body
  await exec(
    `UPDATE "GroceryContribution" SET status='PAID'::"GroceryContribStatus","amountPaid"="amountDue","paidAt"=NOW(),"updatedAt"=NOW()
     WHERE "clubId"=$1 AND "periodNumber"=$2 AND status != 'PAID'`,
    [clubId, periodNumber]
  )
  await recalcTotals(clubId)
  return NextResponse.json({ success:true, message:`Period ${periodNumber} marked as collected` })
}

async function handleWaiveContrib(body: any): Promise<NextResponse> {
  await exec(
    `UPDATE "GroceryContribution" SET status='WAIVED'::"GroceryContribStatus",notes=$1,"updatedAt"=NOW() WHERE id=$2`,
    [body.notes||'Waived by admin', body.contributionId]
  )
  return NextResponse.json({ success:true, message:'Contribution waived' })
}

async function handleUpdateClub(body: any): Promise<NextResponse> {
  const { clubId, name, description, coordinatorId, surplusNotes, notes } = body
  await exec(
    `UPDATE "GroceryClub" SET name=$1,description=$2,"coordinatorId"=$3,"surplusNotes"=$4,notes=$5,"updatedAt"=NOW() WHERE id=$6`,
    [name, description||null, coordinatorId||null, surplusNotes||null, notes||null, clubId]
  )
  return NextResponse.json({ success:true, message:'Club settings updated' })
}

async function handleClose(body: any): Promise<NextResponse> {
  await exec(
    `UPDATE "GroceryClub" SET status='CLOSED'::"GroceryClubStatus","surplusNotes"=$1,"updatedAt"=NOW() WHERE id=$2`,
    [body.surplusNotes||null, body.clubId]
  )
  return NextResponse.json({ success:true, message:'Grocery club closed' })
}

// ── Helpers ───────────────────────────────────────────────────
async function recalcContribAmount(clubId: string) {
  const [clubs, memberCount] = await Promise.all([
    sql(`SELECT "totalBudget" FROM "GroceryClub" WHERE id=$1`, [clubId]),
    sql(`SELECT COUNT(*) as cnt FROM "GroceryMember" WHERE "clubId"=$1 AND "isActive"=true`, [clubId]),
  ])
  if (!clubs.length) return
  const budget = Number(clubs[0].totalBudget)
  const mc     = Number((memberCount[0] as any).cnt) || 1
  const amount = budget / mc
  await exec(`UPDATE "GroceryClub" SET "contributionAmount"=$1,"updatedAt"=NOW() WHERE id=$2`, [amount, clubId])
}

// v1.1: was 2 reads + 1 write + one UPDATE per member (N+3 sequential round
// trips on every single payment). Now two set-based statements run in parallel,
// both computed entirely in the database. Correlated scalar subqueries are used
// rather than UPDATE…FROM with a LEFT JOIN, because Postgres rejects a join
// condition in the FROM list that references the UPDATE target.
async function recalcTotals(clubId: string) {
  await Promise.all([
    exec(
      `UPDATE "GroceryClub"
          SET "totalContributed" = (SELECT COALESCE(SUM("amountPaid"),0)
                                      FROM "GroceryContribution"
                                     WHERE "clubId"=$1 AND status='PAID'),
              "updatedAt" = NOW()
        WHERE id = $1`,
      [clubId]
    ),
    exec(
      `UPDATE "GroceryMember" gm
          SET "totalContributed" = COALESCE((SELECT SUM(gc."amountPaid")
                                               FROM "GroceryContribution" gc
                                              WHERE gc."clubId"=$1
                                                AND gc."userId"=gm."userId"
                                                AND gc.status='PAID'), 0),
              "sharePercentage"  = CASE
                WHEN (SELECT COALESCE(SUM("amountPaid"),0)
                        FROM "GroceryContribution"
                       WHERE "clubId"=$1 AND status='PAID') > 0
                THEN COALESCE((SELECT SUM(gc2."amountPaid")
                                 FROM "GroceryContribution" gc2
                                WHERE gc2."clubId"=$1
                                  AND gc2."userId"=gm."userId"
                                  AND gc2.status='PAID'), 0)
                     / (SELECT SUM("amountPaid")
                          FROM "GroceryContribution"
                         WHERE "clubId"=$1 AND status='PAID') * 100
                ELSE 0 END,
              "updatedAt" = NOW()
        WHERE gm."clubId" = $1`,
      [clubId]
    ),
  ])
}

function formatClub(c: any) {
  const start  = new Date(c.startDate)
  const end    = new Date(c.endDate)
  const now    = new Date()
  const budget    = Number(c.totalBudget || 0)
  const spent     = Number(c.totalSpent  || 0)
  const collected = Number(c.totalContributed || 0)
  // Disbursement position. The club holds no pool: cash collected is either
  // still uncommitted, or already out with a member as a purchase advance.
  const advanced    = Number(c.advancedOut  || 0)   // ASSIGNED + PURCHASED
  const unacquitted = Number(c.unacquitted  || 0)   // advances with no spend recorded yet
  const uncommitted = collected - advanced

  return {
    id:                   c.id,
    groupId:              c.groupId,
    groupName:            c.groupName,
    currency:             c.groupCurrency || c.currency || 'USD',
    name:                 c.name,
    description:          c.description,
    periodMonths:         Number(c.periodMonths),
    contributionFrequency: c.contributionFrequency,
    contributionAmount:   Number(c.contributionAmount || 0),
    startDate:            c.startDate,
    endDate:              c.endDate,
    status:               c.status,
    totalBudget:          budget,
    totalContributed:     collected,
    totalSpent:           spent,
    remainingBudget:      budget - spent,
    // Disbursement view — what the money is actually doing right now.
    advancedOut:          advanced,
    unacquitted:          unacquitted,
    uncommittedCash:      uncommitted,
    openAssignments:      Number(c.openAssignments || 0),
    listValue:            budget,
    carryForwardNet:      Number(c.carryForwardNet || 0),
    fundingPct:           budget > 0 ? Math.min(100, Math.round(collected / budget * 100)) : 0,
    spentPct:             budget > 0 ? Math.min(100, Math.round(spent    / budget * 100)) : 0,
    coordinatorId:        c.coordinatorId,
    coordinatorName:      c.coordinatorName,
    surplusNotes:         c.surplusNotes,
    notes:                c.notes,
    memberCount:          Number(c.memberCount || 0),
    itemCount:            Number(c.itemCount   || 0),
    purchasedCount:       Number(c.purchasedCount || 0),
    daysLeft:             Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86400000)),
    timeProgress:         Math.min(100, Math.round((now.getTime()-start.getTime())/(end.getTime()-start.getTime())*100)),
    createdAt:            c.createdAt,
  }
}

function formatItem(i: any) {
  return {
    id:                  i.id,
    clubId:              i.clubId,
    name:                i.name,
    description:         i.description,
    unit:                i.unit,
    qtyPerMember:        Number(i.qtyPerMember),
    totalQty:            Number(i.totalQty),
    estimatedUnitPrice:  Number(i.estimatedUnitPrice),
    estimatedTotalPrice: Number(i.estimatedTotalPrice),
    actualUnitPrice:     i.actualUnitPrice != null ? Number(i.actualUnitPrice) : null,
    actualTotalPrice:    i.actualTotalPrice != null ? Number(i.actualTotalPrice) : null,
    status:              i.status,
    // assignedToId/assignedToName are gone from the catalogue payload — a
    // line may be split across several members, so the count and quantities
    // below are the only honest summary.
    assignmentCount:     Number(i.assignmentCount || 0),
    qtyAssignedTotal:    Number(i.qtyAssignedTotal || 0),
    qtyUnassigned:       Number(i.totalQty) - Number(i.qtyAssignedTotal || 0),
    advanceTotal:        Number(i.advanceTotal || 0),
    spentTotal:          Number(i.spentTotal || 0),
    openAssignments:     Number(i.openAssignments || 0),
    purchasedAt:         i.purchasedAt,
    purchasedById:       i.purchasedById,
    purchasedByName:     i.purchasedByLive ?? i.purchasedByName ?? null,
    receiptUrl:          i.receiptUrl,
    distributedAt:       i.distributedAt,
    notes:               i.notes,
    priceDiff:           i.actualTotalPrice != null
      ? Number(i.actualTotalPrice) - Number(i.estimatedTotalPrice) : null,
  }
  
}
