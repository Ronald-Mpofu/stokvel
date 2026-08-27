// src/app/api/grocery/member/route.ts — v1.0
//
// The member's own view of one grocery club, and the handful of things a
// member may do without being an officer.
//
// WHY A SEPARATE ROUTE
//   /api/grocery guards BOTH its POST branches with requireGroupManager, so
//   every action there is an officer action by construction. A member cannot
//   mark their own payment sent, confirm money they received, or report what
//   they spent. Loosening that guard would open officer actions — roll-call
//   for the whole club, settlement solving, member removal — to everyone.
//   So self-service lives here, on its own guard, with its own small verb
//   list, and /api/grocery is left exactly as strict as it was.
//
// THE ONLY SECURITY RULE THAT MATTERS
//   The caller is resolved from the session. This route NEVER reads a userId
//   from the request body, and there is no parameter through which one could
//   be supplied. Every write carries the caller's id in its WHERE clause, so
//   ownership is enforced by the UPDATE itself rather than by a preceding
//   SELECT — a read-then-write leaves a window in which the row can change
//   between the check and the write, and "0 rows updated" is a far safer
//   failure than "checked the wrong row".
//
//   Concretely:
//     CLAIM_TRANSFER    only where "payerId"     = caller
//     CONFIRM_TRANSFER  only where "payeeUserId" = caller
//     DISPUTE_TRANSFER  only where caller is payer or payee
//     ACQUIT_ASSIGNMENT only where "userId"      = caller
//     CONFIRM/DECLINE   only the caller's own contribution row
//
// STATE MACHINE IS MIRRORED, NOT REINVENTED
//   The allowed transitions match handleTransferState in /api/grocery
//   exactly. Two routes disagreeing about when a payment may be confirmed
//   would be worse than either rule on its own.
//
// ONE REQUEST
//   GET returns the club, the current cycle, the member's contribution,
//   their carry rows, their assignments, their transfers, the period plan,
//   the standing list and the comment thread — in a single statement,
//   scoped to the current period only.
//
// REQUIRES
//   sql/23-grocery-comments.sql for the comment thread. Until that runs,
//   COMMENT returns 501 and GET omits the comments key, which the screen
//   reads as "no thread" and hides the section.

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'
import { randomUUID } from 'crypto'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

async function sql(query: string, params: any[] = []) {
  return prisma.$queryRawUnsafe(query, ...params) as Promise<any[]>
}

async function exec(query: string, params: any[] = []) {
  return prisma.$executeRawUnsafe(query, ...params)
}

// Postgres serialises `timestamp` (without time zone) into JSON with no
// offset. JavaScript reads an offsetless string as LOCAL time, so anything
// read through jsonb has to be marked UTC explicitly or every date shifts by
// the reader's offset — ten hours in Adelaide, two in Harare, none on a UTC
// server, which is the worst case because it looks right in the logs and
// wrong on the phone. Same helper as /api/grocery, same reason.
const NAIVE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?$/

function utcify<T>(value: T): T {
  if (typeof value === 'string') {
    return (NAIVE_TIMESTAMP.test(value) ? `${value}Z` : value) as unknown as T
  }
  if (Array.isArray(value)) return value.map(utcify) as unknown as T
  if (value !== null && typeof value === 'object') {
    if (value instanceof Date) return value
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) return value
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = utcify(v)
    return out as unknown as T
  }
  return value
}

function bad(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status })
}

function fmtAmt(v: any) { return Number(v || 0).toFixed(2) }

// Whether sql/23 has run. Checked once per cold start rather than per
// request: the answer only changes when a migration runs, which restarts
// nothing but also cannot happen mid-request.
let commentsTablePresent: boolean | null = null

async function hasCommentsTable(): Promise<boolean> {
  if (commentsTablePresent !== null) return commentsTablePresent
  try {
    const rows = await sql(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='GroceryPeriodComment' LIMIT 1`
    )
    commentsTablePresent = rows.length > 0
  } catch {
    commentsTablePresent = false
  }
  return commentsTablePresent
}

// Resolves the club, the period in focus, and the caller's membership in one
// round trip. Every handler below needs all three, and none of them may act
// without them.
//
// "The period in focus" is the earliest cycle that is not CLOSED; if every
// cycle is closed it is the latest one, so a finished club still shows its
// last period rather than its first. Matches what the officer screen picks.
async function resolveContext(clubId: string, userId: string) {
  const rows = await sql(
    `SELECT gc.id                AS "clubId",
            gc.name              AS "clubName",
            gc."groupId"         AS "groupId",
            gc.currency::text    AS currency,
            gc.status::text      AS "clubStatus",
            cy."periodNumber"    AS "periodNumber",
            cy.status            AS "cycleStatus",
            (gm."userId" IS NOT NULL) AS "isMember"
       FROM "GroceryClub" gc
       LEFT JOIN LATERAL (
            SELECT c."periodNumber", c.status
              FROM "GroceryCycle" c
             WHERE c."clubId" = gc.id
             ORDER BY CASE WHEN c.status <> 'CLOSED' THEN 0 ELSE 1 END,
                      CASE WHEN c.status <> 'CLOSED' THEN c."periodNumber" END ASC,
                      c."periodNumber" DESC
             LIMIT 1
       ) cy ON TRUE
       LEFT JOIN "GroceryMember" gm
              ON gm."clubId" = gc.id AND gm."userId" = $2 AND gm."isActive" = true
      WHERE gc.id = $1`,
    [clubId, userId]
  )
  return rows.length ? rows[0] : null
}

// ── GET ───────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { error, claims } = await requireAuth(req)
    if (error) return error
    const userId = claims.id

    const { searchParams } = new URL(req.url)
    const clubId = searchParams.get('clubId')
    if (!clubId) return bad('clubId is required')

    const ctx = await resolveContext(clubId, userId)
    if (!ctx) return bad('Club not found', 404)
    if (!ctx.isMember) {
      return bad('You are not a member of this club', 403)
    }

    const period = Number(ctx.periodNumber ?? 1)
    const withComments = await hasCommentsTable()

    // One statement. Each sub-select is independently scoped to this club,
    // this period and — where it is the member's own data — this caller.
    const rows = await sql(
      `SELECT jsonb_build_object(

         'myContribution', (
           SELECT to_jsonb(x) FROM (
             SELECT c.id, c."periodNumber", c."dueDate",
                    c."amountDue", c."carryAdjustment", c."amountPayable",
                    c."amountPaid", c.status::text AS status,
                    c."fundsConfirmedAt", c."fundsDeclinedAt", c."declineReason",
                    (c.status <> 'PAID' AND c."dueDate" < NOW()) AS "isOverdue"
               FROM "GroceryContribution" c
              WHERE c."clubId" = $1 AND c."userId" = $2 AND c."periodNumber" = $3
           ) x
         ),

         'myAssignments', COALESCE((
           SELECT jsonb_agg(to_jsonb(x) ORDER BY x."itemName")
             FROM (
               SELECT ga.id, ga."itemId", gi.name AS "itemName", gi.unit,
                      ga."qtyAssigned", ga."advanceAmount", ga."actualSpent",
                      ga.status, ga.notes, ga."acquittedAt",
                      CASE WHEN ga."actualSpent" IS NULL THEN NULL
                           ELSE ROUND(ga."advanceAmount" - ga."actualSpent", 2)
                      END AS variance
                 FROM "GroceryAssignment" ga
                 JOIN "GroceryItem" gi ON gi.id = ga."itemId"
                WHERE ga."clubId" = $1 AND ga."userId" = $2
                  AND ga."periodNumber" = $3
                  AND ga.status <> 'CANCELLED'
             ) x
         ), '[]'::jsonb),

         'myTransfers', COALESCE((
           SELECT jsonb_agg(to_jsonb(x) ORDER BY x.direction DESC, x.amount DESC)
             FROM (
               SELECT t.id, t.amount, t.status,
                      t."payeeType", t."paymentReference" AS reference,
                      CASE WHEN t."payerId" = $2 THEN 'PAY' ELSE 'RECEIVE' END AS direction,
                      CASE WHEN t."payerId" = $2
                           THEN COALESCE(sa."supplierName", pu."fullName")
                           ELSE pr."fullName"
                      END AS "counterpartyName",
                      sa."bankName", sa."accountNumber"
                 FROM "GrocerySettlementTransfer" t
                 LEFT JOIN "User" pu ON pu.id = t."payeeUserId"
                 LEFT JOIN "User" pr ON pr.id = t."payerId"
                 LEFT JOIN "GrocerySupplierAccount" sa ON sa.id = t."payeeSupplierId"
                WHERE t."clubId" = $1 AND t."periodNumber" = $3
                  AND t.status <> 'CANCELLED'
                  AND (t."payerId" = $2 OR t."payeeUserId" = $2)
             ) x
         ), '[]'::jsonb),

         'plan', COALESCE((
           SELECT jsonb_agg(to_jsonb(x) ORDER BY x."itemName")
             FROM (
               SELECT pp."itemId", gi.name AS "itemName", gi.unit,
                      pp.qty, pp."unitPrice", pp."lineTotal"
                 FROM "GroceryPeriodPurchase" pp
                 JOIN "GroceryItem" gi ON gi.id = pp."itemId"
                WHERE pp."clubId" = $1 AND pp."periodNumber" = $3
             ) x
         ), '[]'::jsonb),

         'list', COALESCE((
           SELECT jsonb_agg(to_jsonb(x) ORDER BY x.name)
             FROM (
               SELECT gi.id, gi.name, gi.unit, gi."qtyPerMember",
                      gi."estimatedUnitPrice", gi.status::text AS status
                 FROM "GroceryItem" gi
                WHERE gi."clubId" = $1
             ) x
         ), '[]'::jsonb),

         'myCarry', COALESCE((
           SELECT jsonb_agg(to_jsonb(x) ORDER BY x."createdAt")
             FROM (
               SELECT cf.id, cf.amount, cf.reason, cf."appliedPeriod", cf."createdAt"
                 FROM "GroceryCarryForward" cf
                WHERE cf."clubId" = $1 AND cf."userId" = $2
                  AND cf."appliedPeriod" IS NULL
             ) x
         ), '[]'::jsonb),

         'assignedToMe', COALESCE((
           SELECT SUM(ga."advanceAmount")
             FROM "GroceryAssignment" ga
            WHERE ga."clubId" = $1 AND ga."userId" = $2
              AND ga."periodNumber" = $3 AND ga.status <> 'CANCELLED'
         ), 0)

         ${withComments ? `,
         'comments', COALESCE((
           SELECT jsonb_agg(to_jsonb(x) ORDER BY x."createdAt")
             FROM (
               SELECT pc.id, pc."userId", pc.kind, pc.body, pc."createdAt",
                      u."fullName" AS "authorName"
                 FROM "GroceryPeriodComment" pc
                 LEFT JOIN "User" u ON u.id = pc."userId"
                WHERE pc."clubId" = $1 AND pc."periodNumber" = $3
             ) x
         ), '[]'::jsonb)` : ''}

       ) AS payload`,
      [clubId, userId, period]
    )

    const p = rows.length ? rows[0].payload : {}
    const contrib     = p.myContribution || null
    const assignedToMe = Number(p.assignedToMe || 0)
    const payable     = Number(contrib?.amountPayable ?? contrib?.amountDue ?? 0)
    const paid        = Number(contrib?.amountPaid ?? 0)

    // Assigned purchases credit at the BUDGETED advance, never at actual
    // spend. The figure a member is looking at when they pay must not move
    // because someone acquitted late; the difference reaches them through
    // carry-forward into the next period instead.
    const netToPay = Number((payable - paid - assignedToMe).toFixed(2))

    return NextResponse.json({
      success: true,
      data: utcify({
        me:    { userId, fullName: claims.fullName || null },
        club:  {
          id: ctx.clubId,
          name: ctx.clubName,
          currency: ctx.currency,
          status: ctx.clubStatus,
        },
        cycle: { periodNumber: period, status: ctx.cycleStatus || null },
        myContribution: contrib,
        myAssignments:  p.myAssignments || [],
        myTransfers:    p.myTransfers   || [],
        plan:           p.plan          || [],
        list:           p.list          || [],
        myCarry:        p.myCarry       || [],
        ...(withComments ? { comments: p.comments || [] } : {}),
        totals: { assignedToMe, netToPay },
      }),
    })
  } catch (e: any) {
    console.error('GET /api/grocery/member error:', e?.message)
    return bad('Could not load your period', 500)
  }
}

// ── POST ──────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { error, claims } = await requireAuth(req)
    if (error) return error
    const userId = claims.id

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const action = typeof body.action === 'string' ? body.action : ''

    switch (action) {
      case 'CLAIM_TRANSFER':    return claimTransfer(body, userId)
      case 'CONFIRM_TRANSFER':  return confirmTransfer(body, userId)
      case 'DISPUTE_TRANSFER':  return disputeTransfer(body, userId)
      case 'ACQUIT_ASSIGNMENT': return acquitOwn(body, userId)
      case 'CONFIRM_FUNDS':     return answerRollCall(body, userId, true)
      case 'DECLINE_FUNDS':     return answerRollCall(body, userId, false)
      case 'COMMENT':           return addComment(body, userId)
      default:                  return bad('Unknown action')
    }
  } catch (e: any) {
    console.error('POST /api/grocery/member error:', e?.message)
    return bad('That did not work', 500)
  }
}

// ── Transfers ─────────────────────────────────────────────────
// Transitions mirror handleTransferState in /api/grocery. The difference is
// the ownership predicate, which is why these are three functions rather
// than one parameterised by target state: who may act differs per verb, and
// collapsing them would invite passing the predicate in from the caller.

async function claimTransfer(body: any, userId: string) {
  const id = typeof body.transferId === 'string' ? body.transferId : ''
  if (!id) return bad('transferId is required')
  const reference = typeof body.reference === 'string' && body.reference ? body.reference : null

  const done = await sql(
    `UPDATE "GrocerySettlementTransfer"
        SET status='CLAIMED', "claimedAt"=NOW(),
            "paymentReference"=COALESCE($3,"paymentReference"),
            "updatedAt"=NOW()
      WHERE id=$1
        AND "payerId"=$2
        AND status IN ('INSTRUCTED','DISPUTED')
      RETURNING id, amount`,
    [id, userId, reference]
  )
  if (!done.length) {
    return bad('This payment is not yours to mark, or it has already moved on.', 409)
  }
  return NextResponse.json({
    success: true,
    message: `Marked ${fmtAmt(done[0].amount)} as sent. It settles once they confirm.`,
  })
}

async function confirmTransfer(body: any, userId: string) {
  const id = typeof body.transferId === 'string' ? body.transferId : ''
  if (!id) return bad('transferId is required')

  // payeeType is checked explicitly. A SUPPLIER payee has payeeUserId NULL,
  // and a NULL never equals the caller — but relying on that is relying on
  // an absence, and the intent is worth stating.
  const done = await sql(
    `UPDATE "GrocerySettlementTransfer"
        SET status='CONFIRMED', "confirmedAt"=NOW(), "confirmedById"=$2,
            "updatedAt"=NOW()
      WHERE id=$1
        AND "payeeType"='MEMBER'
        AND "payeeUserId"=$2
        AND status IN ('INSTRUCTED','CLAIMED','DISPUTED')
      RETURNING id, amount`,
    [id, userId]
  )
  if (!done.length) {
    return bad('This payment is not owed to you, or it is already confirmed.', 409)
  }
  return NextResponse.json({
    success: true,
    message: `Confirmed you received ${fmtAmt(done[0].amount)}.`,
  })
}

async function disputeTransfer(body: any, userId: string) {
  const id = typeof body.transferId === 'string' ? body.transferId : ''
  if (!id) return bad('transferId is required')
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (reason.length < 3) return bad('Say briefly what is wrong so the treasurer can act on it')

  // Either side may dispute: the payer whose payment was not acknowledged,
  // or the payee who was marked as having received something they did not.
  const done = await sql(
    `UPDATE "GrocerySettlementTransfer"
        SET status='DISPUTED', "disputedAt"=NOW(), "disputeReason"=$3,
            "updatedAt"=NOW()
      WHERE id=$1
        AND ("payerId"=$2 OR "payeeUserId"=$2)
        AND status IN ('CLAIMED','CONFIRMED')
      RETURNING id, amount`,
    [id, userId, reason]
  )
  if (!done.length) {
    return bad('This payment is not yours to dispute, or it has not been claimed yet.', 409)
  }
  return NextResponse.json({
    success: true,
    message: 'Sent to the treasurer. They will get in touch.',
  })
}

// ── Acquittal ─────────────────────────────────────────────────
// The member's own version of ACQUIT_ASSIGNMENT. The variance rules and the
// carry-forward sign convention match /api/grocery exactly: both CHANGE_HELD
// and OUT_OF_POCKET are stored NEGATIVE, which is what
// "GroceryCarryForward_sign_chk" requires.
async function acquitOwn(body: any, userId: string) {
  const assignmentId = typeof body.assignmentId === 'string' ? body.assignmentId : ''
  const actualSpent  = Number(body.actualSpent)
  const notes        = typeof body.notes === 'string' && body.notes ? body.notes.slice(0, 500) : null

  if (!assignmentId) return bad('assignmentId is required')
  if (!Number.isFinite(actualSpent) || actualSpent < 0) return bad('Enter what you actually spent')

  // Ownership is in the WHERE clause of the UPDATE, so there is no window
  // between checking and writing. The RETURNING gives back what is needed to
  // compute the variance from the row as it was actually written.
  const done = await sql(
    `UPDATE "GroceryAssignment" ga
        SET "actualSpent"=$3, status='ACQUITTED',
            "purchasedAt"=COALESCE(ga."purchasedAt", NOW()),
            "acquittedAt"=NOW(),
            notes=COALESCE($4, ga.notes),
            "updatedAt"=NOW()
      WHERE ga.id=$1
        AND ga."userId"=$2
        AND ga.status IN ('ASSIGNED','PURCHASED')
      RETURNING ga.id, ga."clubId", ga."itemId", ga."advanceAmount"`,
    [assignmentId, userId, actualSpent, notes]
  )
  if (!done.length) {
    return bad('That is not yours to report, or you have already reported it.', 409)
  }

  const a        = done[0]
  const advance  = Number(a.advanceAmount)
  const variance = Number((advance - actualSpent).toFixed(4))

  if (variance !== 0) {
    const itemRows = await sql(`SELECT name FROM "GroceryItem" WHERE id=$1`, [a.itemId])
    const itemName = itemRows.length ? itemRows[0].name : 'an item'
    await exec(
      `INSERT INTO "GroceryCarryForward"
         (id,"clubId","userId","assignmentId",amount,reason,notes,"createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT DO NOTHING`,
      [randomUUID(), String(a.clubId), userId, assignmentId,
       -Math.abs(variance),
       variance > 0 ? 'CHANGE_HELD' : 'OUT_OF_POCKET',
       variance > 0
         ? `Holding ${variance.toFixed(2)} change from ${itemName}`
         : `Out of pocket ${Math.abs(variance).toFixed(2)} on ${itemName}`]
    )
  }

  const message = variance === 0
    ? 'Recorded — exactly the advance.'
    : variance > 0
      ? `Recorded. You are holding ${fmtAmt(variance)} change, which carries forward.`
      : `Recorded. The club owes you ${fmtAmt(Math.abs(variance))}, which carries forward.`

  return NextResponse.json({ success: true, message })
}

// ── Roll-call ─────────────────────────────────────────────────
// A member answering for themselves. Writes the same two column pairs as the
// officer's SAVE_ROLL_CALL and honours the same cycle guard, so the two
// cannot disagree about whether the roll-call is open.
//
// This does NOT move money and does not mark anything paid. It records
// whether the member has their contribution ready.
async function answerRollCall(body: any, userId: string, has: boolean) {
  const clubId = typeof body.clubId === 'string' ? body.clubId : ''
  if (!clubId) return bad('clubId is required')
  const reason = typeof body.reason === 'string' && body.reason ? body.reason.slice(0, 300) : null

  const ctx = await resolveContext(clubId, userId)
  if (!ctx) return bad('Club not found', 404)
  if (!ctx.isMember) return bad('You are not a member of this club', 403)
  if (ctx.periodNumber == null) return bad('This club has no open period', 409)

  const cycleStatus = String(ctx.cycleStatus || '')
  if (!['OPEN', 'REOPENED'].includes(cycleStatus)) {
    return bad(
      `The roll-call for period ${ctx.periodNumber} is closed. Speak to your treasurer if this needs changing.`,
      409
    )
  }

  const done = await sql(
    `UPDATE "GroceryContribution"
        SET "fundsConfirmedAt"   = CASE WHEN $4 THEN COALESCE("fundsConfirmedAt", NOW()) ELSE NULL END,
            "fundsConfirmedById" = CASE WHEN $4 THEN COALESCE("fundsConfirmedById", $2)  ELSE NULL END,
            "fundsDeclinedAt"    = CASE WHEN $4 THEN NULL ELSE COALESCE("fundsDeclinedAt", NOW()) END,
            "declineReason"      = CASE WHEN $4 THEN NULL ELSE $5 END,
            "updatedAt"          = NOW()
      WHERE "clubId"=$1 AND "userId"=$2 AND "periodNumber"=$3
      RETURNING id`,
    [clubId, userId, Number(ctx.periodNumber), has, reason]
  )
  if (!done.length) return bad('No contribution found for you in this period', 404)

  return NextResponse.json({
    success: true,
    message: has
      ? 'Thank you — noted that you are ready.'
      : 'Noted. Your treasurer will follow up.',
  })
}

// ── Comments ──────────────────────────────────────────────────
async function addComment(body: any, userId: string) {
  if (!(await hasCommentsTable())) {
    return bad('Messages are not switched on for this club yet.', 501)
  }

  const clubId = typeof body.clubId === 'string' ? body.clubId : ''
  if (!clubId) return bad('clubId is required')
  const text = typeof body.body === 'string' ? body.body.trim() : ''
  if (text.length < 2) return bad('Write a short message first')
  if (text.length > 2000) return bad('That message is too long')

  const kind = body.kind === 'RECEIPT_ACK' ? 'RECEIPT_ACK' : 'COMMENT'

  const ctx = await resolveContext(clubId, userId)
  if (!ctx) return bad('Club not found', 404)
  if (!ctx.isMember) return bad('You are not a member of this club', 403)

  await exec(
    `INSERT INTO "GroceryPeriodComment"
       (id,"clubId","periodNumber","userId",kind,body,"createdAt")
     VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
    [randomUUID(), clubId, Number(ctx.periodNumber ?? 1), userId, kind, text]
  )

  return NextResponse.json({ success: true, message: 'Sent.' })
}
