// src/app/api/groups/schemes/route.ts
//
// Every scheme in a group, with the caller's standing in each — in ONE
// query.
//
// GET /api/groups/schemes?groupId=xxx
//
// This is what the mobile group screen loads. It answers the only question
// a member opens the app to ask: where do I stand? Six schemes, one round
// trip, and the client derives nothing.
//
// WHY ONE QUERY AND NOT SIX
//   The obvious build is a call per scheme. That is six round trips to
//   Supabase before the screen paints, and on a metered connection six
//   sets of headers. LATERAL joins let one statement carry the active
//   cycle, the caller's contribution aggregate and their next due row for
//   every scheme at once.
//
// WHO MAY ACT
//   canManage is resolved here from GroupMember.role and Group.adminUserId,
//   in the same statement as everything else. The hub uses it to decide
//   whether a not-enrolled card reads "Ask your admin" or offers a create
//   action. It is a display hint only — every write endpoint re-authorises.
//
// PAYLOAD DISCIPLINE
//   Returns display strings and one number per card. No fee percentages,
//   no other members' contributions, no scheme config beyond what a card
//   shows.

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'
import { getClaimsFromRequest, unauthorized, forbidden, SUPER_ROLES } from '@/lib/auth'
import { grammarFor, GRAMMAR_READY } from '@/lib/passbook/build'

export const dynamic = 'force-dynamic'

type SchemeRow = {
  id: string
  name: string
  schemeType: string
  schemeStatus: string
  isContributory: boolean
  isRotating: boolean
  contributionAmount: string | null
  contributionFrequency: string | null
  payoutPosition: number | null
  enrolled: boolean
  cycleId: string | null
  cycleNumber: number | null
  totalMembers: number | null
  poolAmount: string | null
  totalPaid: string | null
  monthsPaid: number | null
  monthsTotal: number | null
  nextDueAmount: string | null
  nextDueDate: string | null
}

type Row = {
  groupName: string | null
  currency: string | null
  city: string | null
  country: string | null
  memberCount: number | null
  isGroupMember: boolean | null
  isGroupManager: boolean | null
  schemes: SchemeRow[] | null
}

// $1 = userId, $2 = groupId
//
// Scheme order is fixed by schemeType rather than by name or created date,
// so the hub does not reshuffle itself between visits. Muscle memory is
// worth more than alphabetical tidiness on a screen opened weekly.
const SQL = `
SELECT
  g.name                                        AS "groupName",
  g.currency::text                              AS currency,
  g.city                                        AS city,
  g.country                                     AS country,

  (SELECT count(*)::int FROM "GroupMember" gm
    WHERE gm."groupId" = g.id
      AND gm.status <> 'EXITED'::"MemberStatus")  AS "memberCount",

  EXISTS (
    SELECT 1 FROM "GroupMember" gm
     WHERE gm."groupId" = g.id
       AND gm."userId"  = $1::text
       AND gm.status <> 'EXITED'::"MemberStatus"
  )                                             AS "isGroupMember",

  -- Whether the caller may create and configure schemes in this group.
  -- Resolved server-side and never accepted from the client: the create
  -- endpoints re-authorise independently, but the hub must not offer an
  -- action a member cannot perform.
  (
    EXISTS (
      SELECT 1 FROM "GroupMember" gm
       WHERE gm."groupId" = g.id
         AND gm."userId"  = $1::text
         AND gm.status <> 'EXITED'::"MemberStatus"
         AND gm.role IN ('GROUP_ADMIN'::"UserRole", 'TREASURER'::"UserRole")
    )
    OR g."adminUserId" = $1::text
  )                                             AS "isGroupManager",

  (SELECT COALESCE(json_agg(s ORDER BY s.sort_order, s.name), '[]'::json)
     FROM (
       SELECT
         ws.id,
         ws.name,
         ws."schemeType"::text                  AS "schemeType",
         ws.status::text                        AS "schemeStatus",
         ws."isContributory"                    AS "isContributory",
         ws."isRotating"                        AS "isRotating",
         ws."contributionAmount"                AS "contributionAmount",
         ws."contributionFrequency"             AS "contributionFrequency",
         sm."payoutPosition"                    AS "payoutPosition",
         (sm.id IS NOT NULL)                    AS enrolled,
         cyc.id                                 AS "cycleId",
         cyc."cycleNumber"                      AS "cycleNumber",
         cyc."totalMembers"                     AS "totalMembers",
         cyc."poolAmount"                       AS "poolAmount",
         agg."totalPaid"                        AS "totalPaid",
         agg."monthsPaid"                       AS "monthsPaid",
         agg."monthsTotal"                      AS "monthsTotal",
         nd."amountDue"                         AS "nextDueAmount",
         nd."dueDate"                           AS "nextDueDate",
         CASE ws."schemeType"::text
           WHEN 'SAVINGS_POOL' THEN 1
           WHEN 'GROCERY_CLUB' THEN 2
           WHEN 'ASSETS'       THEN 3
           WHEN 'PROPERTY'     THEN 4
           WHEN 'INVESTMENT'   THEN 5
           WHEN 'LOANS'        THEN 6
           ELSE 7
         END                                    AS sort_order

       FROM "WindfallScheme" ws

       LEFT JOIN "SchemeMember" sm
              ON sm."schemeId" = ws.id
             AND sm."userId"   = $1::text
             AND sm.status <> 'EXITED'::"MemberStatus"

       LEFT JOIN LATERAL (
         SELECT c.id, c."cycleNumber", c."totalMembers", c."poolAmount"
           FROM "Cycle" c
          WHERE c."schemeId" = ws.id
            AND c.status = 'ACTIVE'::"CycleStatus"
          ORDER BY c."cycleNumber" DESC
          LIMIT 1
       ) cyc ON true

       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(co."amountPaid"), 0)              AS "totalPaid",
                count(*) FILTER (
                  WHERE co.status IN ('PAID'::"ContributionStatus",
                                      'PRE_PAID'::"ContributionStatus")
                )::int                                         AS "monthsPaid",
                count(*)::int                                  AS "monthsTotal"
           FROM "Contribution" co
          WHERE co."cycleId" = cyc.id
            AND co."userId"  = $1::text
       ) agg ON true

       -- The next thing the member owes in this scheme. WAIVED is excluded
       -- alongside the paid statuses: a waived month is settled, and
       -- surfacing it as due would send a member to pay something the
       -- group already forgave.
       LEFT JOIN LATERAL (
         SELECT co."amountDue", co."dueDate"
           FROM "Contribution" co
          WHERE co."cycleId" = cyc.id
            AND co."userId"  = $1::text
            AND co.status NOT IN ('PAID'::"ContributionStatus",
                                  'PRE_PAID'::"ContributionStatus",
                                  'WAIVED'::"ContributionStatus")
          ORDER BY co."monthNumber"
          LIMIT 1
       ) nd ON true

       WHERE ws."groupId" = g.id
     ) s
  )                                             AS schemes

FROM "Group" g
WHERE g.id = $2::text
  AND g."deletedAt" IS NULL
`

// Scheme types with a mobile create sheet built. A card only offers the
// create action when its type appears here, so an admin is never shown a
// button that opens nothing. Add a type as its sheet ships.
const MOBILE_CREATE_READY = new Set(['GROCERY_CLUB'])

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function dayMonth(value: string | null): string {
  if (!value) return ''
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return ''
  return `${dt.getUTCDate()} ${MONTHS_SHORT[dt.getUTCMonth()]}`
}

function num(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

export async function GET(req: NextRequest) {
  const t0 = Date.now()

  try {
    const claims = await getClaimsFromRequest(req)
    if (!claims) return unauthorized()

    const groupId = new URL(req.url).searchParams.get('groupId')
    if (!groupId) {
      return NextResponse.json(
        { success: false, error: 'groupId is required' },
        { status: 400 }
      )
    }

    const rows = await prisma.$queryRawUnsafe<Row[]>(SQL, claims.id, groupId)
    const d = rows[0]

    if (!d) {
      return NextResponse.json(
        { success: false, error: 'Group not found' },
        { status: 404 }
      )
    }

    if (!d.isGroupMember && !SUPER_ROLES.includes(claims.role)) {
      return forbidden('You are not a member of this group')
    }

    const canManage =
      Boolean(d.isGroupManager) || SUPER_ROLES.includes(claims.role)

    const now = new Date()
    const raw = Array.isArray(d.schemes) ? d.schemes : []

    let holdings = 0
    let dueNow = 0

    const schemes = raw.map(s => {
      const grammar = grammarFor(s.schemeType)
      const ready = GRAMMAR_READY[grammar]
      const paid = num(s.totalPaid)
      const monthsPaid = num(s.monthsPaid)
      const monthsTotal = num(s.monthsTotal)
      const nextDue = s.nextDueAmount === null ? null : num(s.nextDueAmount)
      const dueDate = s.nextDueDate ? new Date(s.nextDueDate) : null
      const overdue = Boolean(dueDate && !Number.isNaN(dueDate.getTime()) && dueDate < now)

      if (s.enrolled) {
        holdings += paid
        if (overdue && nextDue) dueNow += nextDue
      }

      // Every card reports exactly one state, decided here rather than by
      // the screen. The order matters: not enrolled is checked first,
      // because a member who is not in a scheme does not care that its
      // book is unbuilt.
      let state:
        | 'NOT_ENROLLED'
        | 'NOT_AVAILABLE'
        | 'NO_LEDGER'
        | 'NOT_STARTED'
        | 'ACTIVE' = 'ACTIVE'

      if (!s.enrolled) state = 'NOT_ENROLLED'
      else if (!ready) state = 'NOT_AVAILABLE'
      else if (!s.isContributory) state = 'NO_LEDGER'
      else if (!s.cycleId) state = 'NOT_STARTED'

      // subtitle and trailing text are display strings. The client draws
      // them as given — it must not need the numbers behind them.
      let subtitle = ''
      let trailing = ''

      switch (state) {
        case 'NOT_ENROLLED':
          subtitle = 'Not enrolled'
          // "Ask your admin" is addressed to a member. Shown to the person
          // who IS the admin it is a dead end — they are the one who would
          // be asked. Managers get the action instead.
          trailing = canManage
            ? (MOBILE_CREATE_READY.has(s.schemeType) ? 'Set up' : 'Not set up')
            : 'Ask your admin'
          break
        case 'NOT_AVAILABLE':
          subtitle = grammar === 'REPAYMENT' ? 'Repayment book' : 'Stake statement'
          trailing = 'Coming soon'
          break
        case 'NO_LEDGER':
          subtitle = 'No contribution schedule'
          trailing = 'No passbook'
          break
        case 'NOT_STARTED':
          subtitle = s.contributionAmount ? '' : 'Ready to start'
          trailing = 'Not started'
          break
        default: {
          // No money in this string. The amount travels as a number in
          // contributionAmount below and the card formats it with the
          // group's currency — otherwise an AUD group reads "150 monthly".
          const bits: string[] = []
          if (s.cycleNumber) bits.push(`Cycle ${s.cycleNumber}`)
          if (s.isRotating && s.payoutPosition) bits.push(`position ${s.payoutPosition}`)
          subtitle = bits.join(' · ')
          trailing = dueDate
            ? `Due ${dayMonth(s.nextDueDate)}`
            : `${monthsPaid} of ${monthsTotal} paid`
        }
      }

      return {
        id: s.id,
        name: s.name,
        schemeType: s.schemeType,
        grammar,
        state,
        enrolled: s.enrolled,
        // Only a scheme with a readable book is worth opening. The hub
        // greys the rest rather than letting a member tap into a dead end.
        openable: state === 'ACTIVE' || state === 'NOT_STARTED',
        // The admin affordance for this card, or null. CREATE means the
        // group has no instance of this scheme yet — or the manager is not
        // in the one it has — and the mobile sheet can make one.
        adminAction:
          canManage && !s.enrolled && MOBILE_CREATE_READY.has(s.schemeType)
            ? 'CREATE'
            : null,
        subtitle,
        trailing,
        // Terms as numbers, appended to the subtitle by the card. Sent for
        // every state that has them, so a not-yet-started scheme can still
        // show what it will cost.
        contributionAmount: s.contributionAmount === null ? null : num(s.contributionAmount),
        contributionFrequency: s.contributionFrequency,
        amount: state === 'ACTIVE' ? paid : null,
        overdue,
        monthsPaid,
        monthsTotal,
      }
    })

    console.log('GET /api/groups/schemes db_ms=', Date.now() - t0)

    return NextResponse.json({
      success: true,
      data: {
        group: {
          id: groupId,
          name: d.groupName,
          currency: d.currency ?? 'USD',
          city: d.city,
          country: d.country,
          memberCount: num(d.memberCount),
        },
        // Drives the admin affordances on the hub. The client uses this for
        // display only — /api/grocery re-checks with requireGroupManager.
        canManage,
        // Holdings and what is owed are kept apart on purpose. Netting
        // them into a single figure is how a member comes to believe a
        // loan is savings.
        totals: {
          holdings,
          dueNow,
          schemesEnrolled: schemes.filter(s => s.enrolled).length,
          schemesTotal: schemes.length,
        },
        schemes,
      },
    })
  } catch (e: any) {
    console.error('GET /api/groups/schemes error:', e?.message)
    return NextResponse.json(
      { success: false, error: 'Failed to load schemes' },
      { status: 500 }
    )
  }
}
