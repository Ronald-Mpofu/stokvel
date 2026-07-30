// src/app/api/schemes/passbook/route.ts
//
// One member's passbook for ONE windfall scheme, in one query.
//
// GET /api/schemes/passbook?schemeId=xxx
//
// REPLACES /api/groups/passbook, which resolved the cycle by groupId. That
// worked only while a group had a single scheme with a cycle. Cycles now
// hang off schemes, so a group running both a savings pool and a grocery
// club has two active cycles and the old query picked whichever had the
// higher cycleNumber — silently returning a plausible passbook from the
// wrong scheme. Delete the old route once the mobile screen is switched
// over; leaving both live invites the same bug back in.
//
// AUTHORISATION
//   Membership of the SCHEME, not the group. Group admins assign members
//   per scheme, so being in the group no longer implies being in the
//   scheme. SchemeMember is the authoritative roster.
//
// PAYLOAD DISCIPLINE
//   Returns a render-ready view: rows with their meaning already decided,
//   three standing figures, one action. No scheme config, no fee
//   percentages, no member list. Members pay for these bytes out of
//   airtime.

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'
import { getClaimsFromRequest, unauthorized, forbidden, SUPER_ROLES } from '@/lib/auth'
import { buildView, grammarFor, GRAMMAR_READY } from '@/lib/passbook/build'
import type {
  ContributionInput, RotationInput,
} from '@/lib/passbook/build'

export const dynamic = 'force-dynamic'

type Row = {
  schemeId: string | null
  schemeName: string | null
  schemeType: string | null
  schemeStatus: string | null
  groupId: string | null
  groupName: string | null
  currency: string | null
  isContributory: boolean | null
  isRotating: boolean | null
  contributionAmount: string | null
  contributionFrequency: string | null
  isSchemeMember: boolean | null
  isGroupMember: boolean | null
  myPosition: number | null
  cycleId: string | null
  cycleNumber: number | null
  totalMembers: number | null
  poolAmount: string | null
  totalPaid: string | null
  monthsPaid: number | null
  contributions: ContributionInput[] | null
  rotation: (Omit<RotationInput, 'isMe'> & { recipientId: string })[] | null
}

// $1 = userId, $2 = schemeId
//
// WindfallScheme and SchemeMember are raw-SQL tables, so the whole query
// is raw rather than half Prisma. One round trip: Supabase is in Tokyo and
// Vercel is not, so each extra hop costs roughly 160ms before any work
// happens.
const SQL = `
WITH cyc AS MATERIALIZED (
  SELECT c.id, c."cycleNumber", c."totalMembers", c."poolAmount"
    FROM "Cycle" c
   WHERE c."schemeId" = $2::text
     AND c.status = 'ACTIVE'::"CycleStatus"
   ORDER BY c."cycleNumber" DESC
   LIMIT 1
)
SELECT
  ws.id                                         AS "schemeId",
  ws."name"                                     AS "schemeName",
  ws."schemeType"::text                         AS "schemeType",
  ws."status"::text                             AS "schemeStatus",
  ws."groupId"                                  AS "groupId",
  g."name"                                      AS "groupName",
  g.currency::text                              AS currency,
  ws."isContributory"                           AS "isContributory",
  ws."isRotating"                               AS "isRotating",
  ws."contributionAmount"                       AS "contributionAmount",
  ws."contributionFrequency"                    AS "contributionFrequency",

  EXISTS (
    SELECT 1 FROM "SchemeMember" sm
     WHERE sm."schemeId" = ws.id
       AND sm."userId"   = $1::text
       AND sm."status" <> 'EXITED'::"MemberStatus"
  )                                             AS "isSchemeMember",

  EXISTS (
    SELECT 1 FROM "GroupMember" gm
     WHERE gm."groupId" = ws."groupId"
       AND gm."userId"  = $1::text
       AND gm."status" <> 'EXITED'::"MemberStatus"
  )                                             AS "isGroupMember",

  -- Position comes from the roster, which is the single authoritative
  -- source. Reading it from PayoutSchedule as well would be two answers
  -- to one question, and they would eventually disagree.
  (SELECT sm."payoutPosition" FROM "SchemeMember" sm
    WHERE sm."schemeId" = ws.id
      AND sm."userId"   = $1::text
    LIMIT 1)                                    AS "myPosition",

  (SELECT id             FROM cyc)              AS "cycleId",
  (SELECT "cycleNumber"  FROM cyc)              AS "cycleNumber",
  (SELECT "totalMembers" FROM cyc)              AS "totalMembers",
  (SELECT "poolAmount"   FROM cyc)              AS "poolAmount",

  (SELECT COALESCE(SUM(co."amountPaid"), 0) FROM "Contribution" co
    WHERE co."cycleId" = (SELECT id FROM cyc)
      AND co."userId"  = $1::text)              AS "totalPaid",

  (SELECT COUNT(*)::int FROM "Contribution" co
    WHERE co."cycleId" = (SELECT id FROM cyc)
      AND co."userId"  = $1::text
      AND co.status IN ('PAID'::"ContributionStatus",
                        'PRE_PAID'::"ContributionStatus"))
                                                AS "monthsPaid",

  (SELECT COALESCE(json_agg(p ORDER BY p."monthNumber"), '[]'::json)
     FROM (
       SELECT co."monthNumber", co."dueDate", co."amountDue", co."amountPaid",
              co.status::text AS status, co."paidAt",
              co."paymentMethod"::text AS "paymentMethod"
         FROM "Contribution" co
        WHERE co."cycleId" = (SELECT id FROM cyc)
          AND co."userId"  = $1::text
        ORDER BY co."monthNumber"
     ) p
  )                                             AS contributions,

  (SELECT COALESCE(json_agg(r ORDER BY r."monthNumber"), '[]'::json)
     FROM (
       SELECT ps."monthNumber", ps."scheduledDate", ps."payoutAmount",
              ps.status::text AS status, ps."recipientId",
              u."fullName" AS "recipientName"
         FROM "PayoutSchedule" ps
         LEFT JOIN "User" u ON u.id = ps."recipientId"
        WHERE ps."cycleId" = (SELECT id FROM cyc)
        ORDER BY ps."monthNumber"
     ) r
  )                                             AS rotation

FROM "WindfallScheme" ws
JOIN "Group" g ON g.id = ws."groupId"
WHERE ws.id = $2::text
  AND g."deletedAt" IS NULL
`

export async function GET(req: NextRequest) {
  const t0 = Date.now()

  try {
    const claims = await getClaimsFromRequest(req)
    if (!claims) return unauthorized()

    const schemeId = new URL(req.url).searchParams.get('schemeId')
    if (!schemeId) {
      return NextResponse.json(
        { success: false, error: 'schemeId is required' },
        { status: 400 }
      )
    }

    const rows = await prisma.$queryRawUnsafe<Row[]>(SQL, claims.id, schemeId)
    const dbRow = rows[0]

    if (!dbRow || !dbRow.schemeId) {
      return NextResponse.json(
        { success: false, error: 'Scheme not found' },
        { status: 404 }
      )
    }

    const isStaff = SUPER_ROLES.includes(claims.role)

    // A staff viewer is NOT silently shown an empty passbook. The old route
    // let admins through and then queried their own contributions, so a
    // SYSTEM_ADMIN outside the group saw a blank ledger that looked like
    // missing data rather than a scope boundary. Staff get an explicit
    // reason instead, until a "view as member" path exists.
    if (!dbRow.isSchemeMember) {
      if (isStaff) {
        return NextResponse.json({
          success: true,
          data: {
            view: null,
            unavailable: {
              reason: 'NOT_ENROLLED_STAFF',
              message: 'A passbook belongs to a member. You are not enrolled in this scheme, so there is no passbook of yours to show.',
            },
          },
        })
      }

      // A group member who has not been assigned to this scheme is a
      // normal, expected state — admins assign per scheme. It is not a
      // permission failure, so it must not read like one.
      if (dbRow.isGroupMember) {
        return NextResponse.json({
          success: true,
          data: {
            view: null,
            unavailable: {
              reason: 'NOT_ENROLLED',
              message: 'You are not in this scheme yet. Your group admin can add you.',
            },
          },
        })
      }

      return forbidden('You are not a member of this group')
    }

    const grammar = grammarFor(dbRow.schemeType || '')

    if (!GRAMMAR_READY[grammar]) {
      return NextResponse.json({
        success: true,
        data: {
          view: null,
          unavailable: {
            reason: 'GRAMMAR_NOT_BUILT',
            grammar,
            message: `${dbRow.schemeName} keeps a ${grammar === 'REPAYMENT' ? 'repayment' : 'stake'} book, which is not built yet.`,
          },
        },
      })
    }

    if (!dbRow.isContributory) {
      return NextResponse.json({
        success: true,
        data: {
          view: null,
          unavailable: {
            reason: 'NOT_CONTRIBUTORY',
            message: `${dbRow.schemeName} has no contribution schedule, so it keeps no passbook.`,
          },
        },
      })
    }

    const num = (v: unknown) => Number(v ?? 0)
    const contributions = Array.isArray(dbRow.contributions) ? dbRow.contributions : []
    const rotationRaw = Array.isArray(dbRow.rotation) ? dbRow.rotation : []

    const rotation: RotationInput[] = rotationRaw.map(r => ({
      monthNumber: r.monthNumber,
      scheduledDate: r.scheduledDate,
      payoutAmount: r.payoutAmount,
      status: r.status,
      recipientName: r.recipientName,
      isMe: r.recipientId === claims.id,
    }))

    const view = buildView(
      {
        id: dbRow.schemeId,
        name: dbRow.schemeName || 'Scheme',
        schemeType: dbRow.schemeType || '',
        groupName: dbRow.groupName || '',
        currency: dbRow.currency || 'USD',
        isContributory: Boolean(dbRow.isContributory),
        isRotating: Boolean(dbRow.isRotating),
        contributionAmount: dbRow.contributionAmount === null
          ? null
          : num(dbRow.contributionAmount),
        contributionFrequency: dbRow.contributionFrequency,
      },
      dbRow.cycleId
        ? {
            id: dbRow.cycleId,
            cycleNumber: num(dbRow.cycleNumber),
            totalMembers: num(dbRow.totalMembers),
            poolAmount: num(dbRow.poolAmount),
          }
        : null,
      contributions,
      rotation,
      {
        position: dbRow.myPosition,
        totalPaid: num(dbRow.totalPaid),
        monthsPaid: num(dbRow.monthsPaid),
      }
    )

    console.log('GET /api/schemes/passbook db_ms=', Date.now() - t0)

    // An empty ledger is NOT an error. A scheme with no cycle yet is where
    // every group starts, and the screen renders it as an invitation with a
    // next action. Returning 404 here would turn a normal state into a
    // failure the member cannot act on.
    return NextResponse.json({
      success: true,
      data: {
        view,
        unavailable: null,
        hasCycle: Boolean(dbRow.cycleId),
      },
    })
  } catch (e: any) {
    console.error('GET /api/schemes/passbook error:', e?.message)
    return NextResponse.json(
      { success: false, error: 'Failed to load passbook' },
      { status: 500 }
    )
  }
}
