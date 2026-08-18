// src/app/api/schemes/passbook/route.ts — v4
//
// One member's passbook for ONE windfall scheme.
//
// GET /api/schemes/passbook?schemeId=xxx[&poolId=yyy][&clubId=zzz]
//
// WHAT CHANGED IN v3
//
// WHAT CHANGED IN v4
//
//   The instance list is now a PERMANENT level, not a tie-breaker. v3
//   returned it only when a scheme held more than one ledger; a group with
//   a single grocery club went straight to the book, which left an admin
//   with nowhere to stand to create the second one. The list is where
//   "add another" lives, so it has to exist even when it holds one row.
//
//   It also carries canManage, so that list can offer the create action.
//   The hub no longer does — an admin already inside December Hampers is
//   "enrolled", and the old hub gate hid create from exactly the person
//   most likely to want it.
//
//   Grocery Club reads its own module — GroceryClub, GroceryContribution,
//   GroceryMember, GroceryItem — the same way savings reads SavingsPool.
//   Before v3 every grocery card returned READER_NOT_BUILT.
//
//   A scheme holds MANY clubs. WindfallScheme is one row per type per
//   group, but "another grocery club" creates another GroceryClub beneath
//   it, so a member may hold several books under one card. Rather than
//   merging them into one ledger — which would interleave two unrelated
//   hampers — the route returns the club list and the member picks, the
//   same shape MULTIPLE_POOLS already uses for savings.
//
// WHAT CHANGED IN v2
//
//   v1 read Cycle and Contribution. Those are the OLD group-level ROSCA
//   tables; migration 12 removed the seeded cycle and they are now empty.
//
//   The real ledger for a savings scheme is the SavingsPool module —
//   SavingsPool, SavingsContribution, SavingsPoolMember,
//   SavingsRotationPayout. That is consistent with every other scheme
//   type: Property has PropertyGroup, Assets has Asset, Loans has Loan.
//   WindfallScheme is the REGISTRY of which scheme types a group runs;
//   the ledger lives in the type's own module.
//
//   Migration 12 added SavingsPool.schemeId, so a scheme now resolves to
//   its pool directly rather than by sharing a groupId — which would have
//   picked arbitrarily the moment a group ran two pools.
//
// GRAMMAR
//   poolType ROTATING  → the rotating book. One member collects per
//                        period; the payout row is theirs.
//   poolType MATURITY  → the accumulating book. Everyone collects at
//                        maturityDate.
//   The savings module arrived at the same two shapes independently, which
//   is why no translation is needed beyond naming.
//
// ENUM HANDLING
//   SavingsContribution.status is a SavingsContributionStatus enum whose
//   labels are not confirmed, so it is compared as ::text. A cast to a
//   label that does not exist fails at runtime, and ::text cannot.
//   SavingsRotationPayout.status is already plain text.
//
// PAYLOAD DISCIPLINE
//   A render-ready view. No pool config, no interest rate, no other
//   members' contributions. Members pay for these bytes out of airtime.

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'
import { getClaimsFromRequest, unauthorized, forbidden, SUPER_ROLES } from '@/lib/auth'
import { buildRotatingView, buildAccumulatingView, buildGroceryView } from '@/lib/passbook/build'
import type {
  ContributionInput, RotationInput, SchemeInput, GroceryClubInput,
} from '@/lib/passbook/build'

export const dynamic = 'force-dynamic'

// Statuses that mean the member owes nothing further for that period.
// Compared against status::text, so this list is the single place to
// adjust once the SavingsContributionStatus labels are confirmed.
const SETTLED = ['PAID', 'WAIVED']

// GroceryContribStatus labels are PENDING / PAID / PARTIAL / WAIVED. A
// PARTIAL payment is deliberately NOT settled — the member still owes the
// balance and the row must keep catching their eye.
const GROCERY_SETTLED = ['PAID', 'WAIVED']

type SchemeRow = {
  schemeId: string
  schemeName: string
  schemeType: string
  groupId: string
  groupName: string
  currency: string
  isGroupMember: boolean
  isGroupManager: boolean
  poolCount: number
  clubCount: number
}

type PoolRow = {
  poolId: string
  poolName: string
  poolType: string
  poolStatus: string
  currency: string
  contributionAmount: string
  contributionFrequency: string
  maturityDate: string | null
  isPoolMember: boolean
  myPosition: number | null
  totalPaid: string
  periodsPaid: number
  contributions: ContributionInput[] | null
  rotation: (Omit<RotationInput, 'isMe'> & { userId: string })[] | null
}

// $1 = userId, $2 = schemeId
const SCHEME_SQL = `
SELECT
  ws.id                    AS "schemeId",
  ws.name                  AS "schemeName",
  ws."schemeType"::text    AS "schemeType",
  ws."groupId"             AS "groupId",
  g.name                   AS "groupName",
  g.currency::text         AS currency,
  EXISTS (
    SELECT 1 FROM "GroupMember" gm
     WHERE gm."groupId" = ws."groupId"
       AND gm."userId"  = $1::text
       AND gm.status <> 'EXITED'::"MemberStatus"
  )                        AS "isGroupMember",
  (
    EXISTS (
      SELECT 1 FROM "GroupMember" gm
       WHERE gm."groupId" = ws."groupId"
         AND gm."userId"  = $1::text
         AND gm.status <> 'EXITED'::"MemberStatus"
         AND gm.role IN ('GROUP_ADMIN'::"UserRole", 'TREASURER'::"UserRole")
    )
    OR g."adminUserId" = $1::text
  )                        AS "isGroupManager",
  (SELECT count(*)::int FROM "SavingsPool" sp
    WHERE sp."schemeId" = ws.id)  AS "poolCount",
  (SELECT count(*)::int FROM "GroceryClub" gc
    WHERE gc."schemeId" = ws.id)  AS "clubCount"
FROM "WindfallScheme" ws
JOIN "Group" g ON g.id = ws."groupId"
WHERE ws.id = $2::text
  AND g."deletedAt" IS NULL
`

// $1 = userId, $2 = schemeId, $3 = poolId or NULL
//
// One round trip. LATERAL joins carry the caller's aggregate, their
// rotation position, their ledger and the pool's rotation schedule.
const POOL_SQL = `
SELECT
  sp.id                          AS "poolId",
  sp.name                        AS "poolName",
  sp."poolType"                  AS "poolType",
  sp.status                      AS "poolStatus",
  sp.currency::text              AS currency,
  sp."contributionAmount"        AS "contributionAmount",
  sp."contributionFrequency"     AS "contributionFrequency",
  sp."maturityDate"              AS "maturityDate",

  EXISTS (
    SELECT 1 FROM "SavingsPoolMember" m
     WHERE m."poolId" = sp.id
       AND m."userId" = $1::text
       AND m."isActive" = true
       AND m."exitedAt" IS NULL
  )                              AS "isPoolMember",

  (SELECT rp.position FROM "SavingsRotationPayout" rp
    WHERE rp."poolId" = sp.id AND rp."userId" = $1::text
    LIMIT 1)                     AS "myPosition",

  COALESCE((SELECT SUM(sc."amountPaid") FROM "SavingsContribution" sc
             WHERE sc."poolId" = sp.id AND sc."userId" = $1::text), 0)
                                 AS "totalPaid",

  COALESCE((SELECT count(*)::int FROM "SavingsContribution" sc
             WHERE sc."poolId" = sp.id AND sc."userId" = $1::text
               AND sc.status::text = ANY($4::text[])), 0)
                                 AS "periodsPaid",

  (SELECT COALESCE(json_agg(c ORDER BY c."monthNumber"), '[]'::json)
     FROM (
       SELECT sc."periodNumber" AS "monthNumber",
              sc."dueDate", sc."amountDue", sc."amountPaid",
              sc.status::text  AS status,
              sc."paidAt",
              sc."paymentMethod"
         FROM "SavingsContribution" sc
        WHERE sc."poolId" = sp.id
          AND sc."userId" = $1::text
        ORDER BY sc."periodNumber"
     ) c
  )                              AS contributions,

  (SELECT COALESCE(json_agg(r ORDER BY r."monthNumber"), '[]'::json)
     FROM (
       SELECT rp.position       AS "monthNumber",
              rp."scheduledDate",
              rp.amount         AS "payoutAmount",
              rp.status         AS status,
              rp."userId",
              u."fullName"      AS "recipientName"
         FROM "SavingsRotationPayout" rp
         LEFT JOIN "User" u ON u.id = rp."userId"
        WHERE rp."poolId" = sp.id
        ORDER BY rp.position
     ) r
  )                              AS rotation

FROM "SavingsPool" sp
WHERE sp."schemeId" = $2::text
  AND ($3::text IS NULL OR sp.id = $3::text)
ORDER BY sp."createdAt"
LIMIT 1
`

type ClubRow = {
  clubId: string
  clubName: string
  clubStatus: string
  currency: string
  contributionAmount: string
  contributionFrequency: string
  endDate: string | null
  totalBudget: string
  isClubMember: boolean
  myShare: string
  totalPaid: string
  periodsPaid: number
  itemCount: number
  purchasedCount: number
  distributedCount: number
  contributions: ContributionInput[] | null
}

// $1 = userId, $2 = schemeId, $3 = clubId or NULL, $4 = settled statuses
//
// One round trip. The caller's membership, their aggregate, their ledger
// and the club's item counts all ride on the same statement.
//
// myShare comes from the club's own contributionAmount (budget ÷ members),
// not from multiplying a period amount, because adding an item after
// activation changes the share without changing the period count.
const CLUB_SQL = `
SELECT
  gc.id                          AS "clubId",
  gc.name                        AS "clubName",
  gc.status::text                AS "clubStatus",
  gc.currency::text              AS currency,
  gc."contributionAmount"        AS "contributionAmount",
  gc."contributionFrequency"     AS "contributionFrequency",
  gc."endDate"                   AS "endDate",
  gc."totalBudget"               AS "totalBudget",

  EXISTS (
    SELECT 1 FROM "GroceryMember" gm
     WHERE gm."clubId" = gc.id
       AND gm."userId" = $1::text
       AND gm."isActive" = true
  )                              AS "isClubMember",

  COALESCE((SELECT SUM(c."amountDue") FROM "GroceryContribution" c
             WHERE c."clubId" = gc.id AND c."userId" = $1::text), 0)
                                 AS "myShare",

  COALESCE((SELECT SUM(c."amountPaid") FROM "GroceryContribution" c
             WHERE c."clubId" = gc.id AND c."userId" = $1::text), 0)
                                 AS "totalPaid",

  COALESCE((SELECT count(*)::int FROM "GroceryContribution" c
             WHERE c."clubId" = gc.id AND c."userId" = $1::text
               AND c.status::text = ANY($4::text[])), 0)
                                 AS "periodsPaid",

  (SELECT count(*)::int FROM "GroceryItem" i WHERE i."clubId" = gc.id)
                                 AS "itemCount",
  (SELECT count(*)::int FROM "GroceryItem" i
    WHERE i."clubId" = gc.id
      AND i.status::text IN ('PURCHASED', 'DISTRIBUTED'))
                                 AS "purchasedCount",
  (SELECT count(*)::int FROM "GroceryItem" i
    WHERE i."clubId" = gc.id AND i.status::text = 'DISTRIBUTED')
                                 AS "distributedCount",

  (SELECT COALESCE(json_agg(c ORDER BY c."monthNumber"), '[]'::json)
     FROM (
       SELECT gcon."periodNumber" AS "monthNumber",
              gcon."dueDate", gcon."amountDue", gcon."amountPaid",
              gcon.status::text   AS status,
              gcon."paidAt",
              gcon."paymentMethod"
         FROM "GroceryContribution" gcon
        WHERE gcon."clubId" = gc.id
          AND gcon."userId" = $1::text
        ORDER BY gcon."periodNumber"
     ) c
  )                              AS contributions

FROM "GroceryClub" gc
WHERE gc."schemeId" = $2::text
  AND ($3::text IS NULL OR gc.id = $3::text)
ORDER BY gc."createdAt"
LIMIT 1
`

function num(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function unavailable(reason: string, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({
    success: true,
    data: { view: null, unavailable: { reason, message, ...extra } },
  })
}

export async function GET(req: NextRequest) {
  const t0 = Date.now()

  try {
    const claims = await getClaimsFromRequest(req)
    if (!claims) return unauthorized()

    const url = new URL(req.url)
    const schemeId = url.searchParams.get('schemeId')
    const poolId = url.searchParams.get('poolId')
    const clubId = url.searchParams.get('clubId')

    if (!schemeId) {
      return NextResponse.json(
        { success: false, error: 'schemeId is required' },
        { status: 400 }
      )
    }

    const schemeRows = await prisma.$queryRawUnsafe<SchemeRow[]>(SCHEME_SQL, claims.id, schemeId)
    const scheme = schemeRows[0]

    if (!scheme) {
      return NextResponse.json({ success: false, error: 'Scheme not found' }, { status: 404 })
    }

    const isStaff = SUPER_ROLES.includes(claims.role)
    // Same rule as /api/groups/schemes, so the two screens never disagree
    // about who may act. Display only — the write endpoints re-authorise.
    const canManage = Boolean(scheme.isGroupManager) || isStaff
    if (!scheme.isGroupMember && !isStaff) {
      return forbidden('You are not a member of this group')
    }

    // ── Grocery Club ──────────────────────────────────────────
    if (scheme.schemeType === 'GROCERY_CLUB') {
      // The list always shows when no club is chosen — even for a single
      // club, and even for none. It is the level that owns "add another",
      // so skipping it would strand an admin with nowhere to create from.
      // An empty list plus a create action is the correct first screen.
      if (!clubId) {
        const clubs = await prisma.$queryRawUnsafe<
          { id: string; name: string; status: string; endDate: string | null; mine: boolean }[]
        >(
          `SELECT gc.id, gc.name, gc.status::text AS status, gc."endDate",
                  EXISTS (SELECT 1 FROM "GroceryMember" gm
                           WHERE gm."clubId" = gc.id
                             AND gm."userId" = $2::text
                             AND gm."isActive" = true) AS mine
             FROM "GroceryClub" gc
            WHERE gc."schemeId" = $1::text
            ORDER BY gc."createdAt" DESC`,
          schemeId, claims.id
        )
        return unavailable(
          'MULTIPLE_CLUBS',
          clubs.length === 1
            ? 'Open the club to see your book.'
            : 'This group runs more than one grocery club. Choose which one to open.',
          { clubs, canManage, schemeType: scheme.schemeType, groupId: scheme.groupId }
        )
      }

      if (scheme.clubCount === 0) {
        return unavailable(
          'NO_CLUB',
          'No grocery club has been created for this scheme yet.'
        )
      }

      const clubRows = await prisma.$queryRawUnsafe<ClubRow[]>(
        CLUB_SQL, claims.id, schemeId, clubId, GROCERY_SETTLED
      )
      const club = clubRows[0]

      if (!club) {
        return unavailable('NO_CLUB', 'That grocery club could not be found.')
      }

      if (!club.isClubMember) {
        if (isStaff) {
          return unavailable(
            'NOT_ENROLLED_STAFF',
            'A passbook belongs to a member. You are not in this club, so there is no passbook of yours to show.'
          )
        }
        return unavailable(
          'NOT_ENROLLED',
          'You are not in this grocery club yet. Your group admin can add you.'
        )
      }

      const groceryContribs = Array.isArray(club.contributions) ? club.contributions : []

      const groceryScheme: SchemeInput = {
        id: scheme.schemeId,
        name: club.clubName || scheme.schemeName,
        schemeType: scheme.schemeType,
        groupName: scheme.groupName || '',
        currency: club.currency || scheme.currency || 'USD',
        isContributory: true,
        isRotating: false,
        contributionAmount: num(club.contributionAmount),
        contributionFrequency: club.contributionFrequency,
      }

      const clubInput: GroceryClubInput = {
        clubId: club.clubId,
        clubName: club.clubName,
        status: club.clubStatus,
        totalBudget: num(club.totalBudget),
        myShare: num(club.myShare),
        itemCount: num(club.itemCount),
        purchasedCount: num(club.purchasedCount),
        distributedCount: num(club.distributedCount),
        endDate: club.endDate,
      }

      const groceryView = buildGroceryView(
        groceryScheme,
        clubInput,
        groceryContribs,
        { position: null, totalPaid: num(club.totalPaid), monthsPaid: num(club.periodsPaid) },
        new Date()
      )

      console.log('GET /api/schemes/passbook grocery db_ms=', Date.now() - t0)

      return NextResponse.json(
        {
          success: true,
          data: {
            view: groceryView,
            unavailable: null,
            clubId: club.clubId,
            hasLedger: groceryContribs.length > 0,
          },
        },
        { headers: { 'Cache-Control': 'private, max-age=60' } }
      )
    }

    // Savings has a reader; property, assets and loans keep their own
    // ledgers and need their own. Saying so is better than rendering an
    // empty book that looks like lost money.
    if (scheme.schemeType !== 'SAVINGS_POOL') {
      return unavailable(
        'READER_NOT_BUILT',
        `${scheme.schemeName} keeps its records in its own module, which does not have a passbook yet.`,
        { schemeType: scheme.schemeType }
      )
    }

    // Same as grocery: the list is a permanent level, shown even when it
    // holds one pool or none.
    if (!poolId) {
      const pools = await prisma.$queryRawUnsafe<
        { id: string; name: string; status: string; mine: boolean }[]
      >(
        `SELECT sp.id, sp.name, sp.status::text AS status,
                EXISTS (SELECT 1 FROM "SavingsPoolMember" m
                         WHERE m."poolId" = sp.id
                           AND m."userId" = $2::text
                           AND m."isActive" = true
                           AND m."exitedAt" IS NULL) AS mine
           FROM "SavingsPool" sp
          WHERE sp."schemeId" = $1::text
          ORDER BY sp."createdAt"`,
        schemeId, claims.id
      )
      return unavailable(
        'MULTIPLE_POOLS',
        pools.length === 1
          ? 'Open the pool to see your book.'
          : 'This group runs more than one savings pool. Choose which one to open.',
        { pools, canManage, schemeType: scheme.schemeType, groupId: scheme.groupId }
      )
    }

    if (scheme.poolCount === 0) {
      return unavailable(
        'NO_POOL',
        'No savings pool has been created for this scheme yet.'
      )
    }

    const poolRows = await prisma.$queryRawUnsafe<PoolRow[]>(
      POOL_SQL, claims.id, schemeId, poolId, SETTLED
    )
    const pool = poolRows[0]

    if (!pool) {
      return unavailable('NO_POOL', 'That savings pool could not be found.')
    }

    if (!pool.isPoolMember) {
      if (isStaff) {
        return unavailable(
          'NOT_ENROLLED_STAFF',
          'A passbook belongs to a member. You are not in this pool, so there is no passbook of yours to show.'
        )
      }
      return unavailable(
        'NOT_ENROLLED',
        'You are not in this savings pool yet. Your group admin can add you.'
      )
    }

    const contributions = Array.isArray(pool.contributions) ? pool.contributions : []
    const rotationRaw = Array.isArray(pool.rotation) ? pool.rotation : []
    const rotation: RotationInput[] = rotationRaw.map(r => ({
      monthNumber: r.monthNumber,
      scheduledDate: r.scheduledDate,
      payoutAmount: r.payoutAmount,
      status: r.status,
      recipientName: r.recipientName,
      isMe: r.userId === claims.id,
    }))

    const rotating = String(pool.poolType || '').toUpperCase() === 'ROTATING'

    const schemeInput: SchemeInput = {
      id: scheme.schemeId,
      // The POOL's name, not the scheme's. "Sydney Rotation Scheme" is
      // what the member joined; "Savings Pool" is a registry label.
      name: pool.poolName || scheme.schemeName,
      schemeType: scheme.schemeType,
      groupName: scheme.groupName || '',
      currency: pool.currency || scheme.currency || 'USD',
      isContributory: true,
      isRotating: rotating,
      contributionAmount: num(pool.contributionAmount),
      contributionFrequency: pool.contributionFrequency,
    }

    const me = {
      position: pool.myPosition,
      totalPaid: num(pool.totalPaid),
      monthsPaid: num(pool.periodsPaid),
    }

    const view = rotating
      ? buildRotatingView(schemeInput, null, contributions, rotation, me, new Date())
      : buildAccumulatingView(schemeInput, null, contributions, rotation, me, new Date(), {
          goalLabel: 'Maturity',
          goalDetail: 'Everyone collects their share at maturity',
        })

    console.log('GET /api/schemes/passbook db_ms=', Date.now() - t0)

    return NextResponse.json(
      {
        success: true,
        data: { view, unavailable: null, poolId: pool.poolId, hasLedger: contributions.length > 0 },
      },
      {
        headers: {
          // A ledger changes only when a payment lands. A member checking
          // twice around a due date — which is the common case — then costs
          // no bytes at all. private, because this is one member's book.
          'Cache-Control': 'private, max-age=60',
        },
      }
    )
  } catch (e: any) {
    console.error('GET /api/schemes/passbook error:', e?.message)
    return NextResponse.json(
      { success: false, error: 'Failed to load passbook' },
      { status: 500 }
    )
  }
}
