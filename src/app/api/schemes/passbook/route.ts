// src/app/api/schemes/passbook/route.ts — v2
//
// One member's passbook for ONE windfall scheme.
//
// GET /api/schemes/passbook?schemeId=xxx[&poolId=yyy]
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
import { buildRotatingView, buildAccumulatingView } from '@/lib/passbook/build'
import type { ContributionInput, RotationInput, SchemeInput } from '@/lib/passbook/build'

export const dynamic = 'force-dynamic'

// Statuses that mean the member owes nothing further for that period.
// Compared against status::text, so this list is the single place to
// adjust once the SavingsContributionStatus labels are confirmed.
const SETTLED = ['PAID', 'WAIVED']

type SchemeRow = {
  schemeId: string
  schemeName: string
  schemeType: string
  groupId: string
  groupName: string
  currency: string
  isGroupMember: boolean
  poolCount: number
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
  (SELECT count(*)::int FROM "SavingsPool" sp
    WHERE sp."schemeId" = ws.id)  AS "poolCount"
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
    if (!scheme.isGroupMember && !isStaff) {
      return forbidden('You are not a member of this group')
    }

    // Only savings has a reader today. Grocery and investment modules exist
    // as tables but hold no rows; property, assets and loans keep their own
    // ledgers and need their own readers. Saying so is better than
    // rendering an empty book that looks like lost money.
    if (scheme.schemeType !== 'SAVINGS_POOL') {
      return unavailable(
        'READER_NOT_BUILT',
        `${scheme.schemeName} keeps its records in its own module, which does not have a passbook yet.`,
        { schemeType: scheme.schemeType }
      )
    }

    if (scheme.poolCount === 0) {
      return unavailable(
        'NO_POOL',
        'No savings pool has been created for this scheme yet.'
      )
    }

    // More than one pool and no choice made. Picking one would be the
    // arbitrary-selection bug this whole migration existed to remove, so
    // the caller is asked instead.
    if (scheme.poolCount > 1 && !poolId) {
      const pools = await prisma.$queryRawUnsafe<{ id: string; name: string }[]>(
        `SELECT id, name FROM "SavingsPool" WHERE "schemeId" = $1::text ORDER BY "createdAt"`,
        schemeId
      )
      return unavailable(
        'MULTIPLE_POOLS',
        'This group runs more than one savings pool. Choose which one to open.',
        { pools }
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
