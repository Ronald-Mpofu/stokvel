// src/app/api/groups/passbook/route.ts
//
// Everything the mobile group screen needs, in ONE query.
//
// GET /api/groups/passbook?groupId=xxx
//
// Returns the caller's own contribution history for the group's active
// cycle, their position in the rotation, and who receives when. This is
// the member-facing view — a member sees their own passbook, not
// everyone's.
//
// PAYLOAD DISCIPLINE: this returns only fields the screen renders.
// Users on metered data pay for every byte; a list view has no business
// shipping platformFeePct.

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'
import { getClaimsFromRequest, unauthorized, forbidden, SUPER_ROLES } from '@/lib/auth'

export const dynamic = 'force-dynamic'

type PassbookRow = {
  monthNumber: number
  dueDate: string
  amountDue: string
  amountPaid: string
  status: string
  paidAt: string | null
  paymentMethod: string | null
}

type RotationRow = {
  monthNumber: number
  scheduledDate: string
  payoutAmount: string
  status: string
  recipientId: string
  recipientName: string | null
}

type Row = {
  groupName: string | null
  currency: string | null
  groupStatus: string | null
  contributionAmount: string | null
  isMember: boolean | null
  cycleId: string | null
  cycleNumber: number | null
  cycleStart: string | null
  cycleEnd: string | null
  totalMembers: number | null
  poolAmount: string | null
  myPosition: number | null
  totalPaid: string | null
  monthsPaid: number | null
  passbook: PassbookRow[] | null
  rotation: RotationRow[] | null
}

// $1 = userId, $2 = groupId
const SQL = `
WITH cyc AS MATERIALIZED (
  SELECT c.id, c."cycleNumber", c."startDate", c."endDate",
         c."totalMembers", c."poolAmount"
  FROM "Cycle" c
  WHERE c."groupId" = $2::text
    AND c.status = 'ACTIVE'::"CycleStatus"
  ORDER BY c."cycleNumber" DESC
  LIMIT 1
)
SELECT
  g.name                                        AS "groupName",
  g.currency::text                              AS currency,
  g.status::text                                AS "groupStatus",
  g."contributionAmount"                        AS "contributionAmount",

  EXISTS (
    SELECT 1 FROM "GroupMember" m
     WHERE m."groupId" = g.id
       AND m."userId"  = $1::text
       AND m.status <> 'EXITED'::"MemberStatus"
  )                                             AS "isMember",

  (SELECT id           FROM cyc)                AS "cycleId",
  (SELECT "cycleNumber" FROM cyc)               AS "cycleNumber",
  (SELECT "startDate"  FROM cyc)                AS "cycleStart",
  (SELECT "endDate"    FROM cyc)                AS "cycleEnd",
  (SELECT "totalMembers" FROM cyc)              AS "totalMembers",
  (SELECT "poolAmount" FROM cyc)                AS "poolAmount",

  (SELECT ps."monthNumber" FROM "PayoutSchedule" ps
    WHERE ps."cycleId" = (SELECT id FROM cyc)
      AND ps."recipientId" = $1::text
    LIMIT 1)                                    AS "myPosition",

  (SELECT COALESCE(SUM(co."amountPaid"), 0) FROM "Contribution" co
    WHERE co."cycleId" = (SELECT id FROM cyc)
      AND co."userId"  = $1::text)              AS "totalPaid",

  (SELECT COUNT(*)::int FROM "Contribution" co
    WHERE co."cycleId" = (SELECT id FROM cyc)
      AND co."userId"  = $1::text
      AND co.status IN ('PAID'::"ContributionStatus",
                        'PRE_PAID'::"ContributionStatus"))  AS "monthsPaid",

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
  )                                             AS passbook,

  (SELECT COALESCE(json_agg(r ORDER BY r."monthNumber"), '[]'::json)
     FROM (
       SELECT ps."monthNumber", ps."scheduledDate", ps."payoutAmount",
              ps.status::text AS status,
              ps."recipientId", u."fullName" AS "recipientName"
         FROM "PayoutSchedule" ps
         LEFT JOIN "User" u ON u.id = ps."recipientId"
        WHERE ps."cycleId" = (SELECT id FROM cyc)
        ORDER BY ps."monthNumber"
     ) r
  )                                             AS rotation

FROM "Group" g
WHERE g.id = $2::text
  AND g."deletedAt" IS NULL
`

export async function GET(req: NextRequest) {
  const t0 = Date.now()

  try {
    const claims = await getClaimsFromRequest(req)
    if (!claims) return unauthorized()

    const groupId = new URL(req.url).searchParams.get('groupId')
    if (!groupId) {
      return NextResponse.json({ success: false, error: 'groupId is required' }, { status: 400 })
    }

    const rows = await prisma.$queryRawUnsafe<Row[]>(SQL, claims.id, groupId)
    const d = rows[0]

    if (!d) {
      return NextResponse.json({ success: false, error: 'Group not found' }, { status: 404 })
    }

    // Membership is resolved in the same query, so authorisation costs no
    // extra round trip. A member sees their own passbook; staff roles can
    // view any group.
    if (!d.isMember && !SUPER_ROLES.includes(claims.role)) {
      return forbidden('You are not a member of this group')
    }

    const num = (v: unknown) => Number(v ?? 0)
    const passbook = Array.isArray(d.passbook) ? d.passbook : []
    const rotation = Array.isArray(d.rotation) ? d.rotation : []

    console.log('GET /api/groups/passbook db_ms=', Date.now() - t0)

    return NextResponse.json({
      success: true,
      data: {
        group: {
          id: groupId,
          name: d.groupName,
          currency: d.currency ?? 'USD',
          status: d.groupStatus,
          contributionAmount: num(d.contributionAmount),
        },

        // null when the group has no active cycle. That is the NORMAL
        // state for a newly created group, not an error — the screen
        // must treat it as a first-class empty state with a next action,
        // never as a failure.
        cycle: d.cycleId
          ? {
              id: d.cycleId,
              number: d.cycleNumber,
              startDate: d.cycleStart,
              endDate: d.cycleEnd,
              totalMembers: num(d.totalMembers),
              poolAmount: num(d.poolAmount),
            }
          : null,

        me: {
          userId: claims.id,
          position: d.myPosition,               // null = not in the rotation yet
          totalPaid: num(d.totalPaid),
          monthsPaid: num(d.monthsPaid),
          monthsTotal: passbook.length,
        },

        passbook: passbook.map(p => ({
          monthNumber: p.monthNumber,
          dueDate: p.dueDate,
          amountDue: Number(p.amountDue),
          amountPaid: Number(p.amountPaid),
          status: p.status,
          paidAt: p.paidAt,
          paymentMethod: p.paymentMethod,
        })),

        rotation: rotation.map(r => ({
          monthNumber: r.monthNumber,
          scheduledDate: r.scheduledDate,
          amount: Number(r.payoutAmount),
          status: r.status,
          recipientName: r.recipientName,
          isMe: r.recipientId === claims.id,
        })),
      },
    })
  } catch (e: any) {
    console.error('GET /api/groups/passbook error:', e?.message)
    return NextResponse.json(
      { success: false, error: 'Failed to load passbook' },
      { status: 500 }
    )
  }
}
