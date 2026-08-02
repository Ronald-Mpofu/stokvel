// src/app/api/members/route.ts
// Version 2.1 — entitlement alignment + correctness pass.
//
// ⚠ PREREQUISITE — DO NOT DEPLOY WITHOUT THIS
//   MemberStatus in schema.prisma is missing PENDING, which EXISTS in
//   the database (confirmed via pg_enum). Prisma validates enum values
//   when DESERIALISING results, so any query returning a PENDING row
//   throws "Value 'PENDING' not found in enum 'MemberStatus'".
//
//   Add PENDING to the MemberStatus enum in schema.prisma and run
//   `npx prisma generate`. No migration — the database already has it.
//
//   Until that is done, ?status=ALL and ?status=PENDING will 500.
//
// WHAT CHANGED FROM v1
//   1. BUG: added `export const dynamic = 'force-dynamic'`. Without it
//      Vercel can serve a cached roster after someone joins or exits.
//
//   2. ENTITLEMENT ALIGNMENT: status accepts a comma-separated list
//      plus three named sets. The default is unchanged (ACTIVE only),
//      so no existing caller is affected.
//
//      Entitlement counts ACTIVE, SUSPENDED and DEFAULTED toward group
//      size — a disciplined member still counts, so suspending one
//      person cannot shrink a group below minMembers and cascade a
//      lockout onto everyone else. This route defaulted to ACTIVE only,
//      so an admin saw "3 members" while the system treated the group
//      as having 5.
//
//   3. BUG: an invalid status string went into the Prisma where clause
//      and threw a 500. Now validated and rejected with a 400.
//
//   4. Members of soft-deleted groups are no longer returned. If any
//      caller depends on the old behaviour, remove the
//      `group: { deletedAt: null }` line.
//
// QUERY PARAMS
//   ?groupId=<uuid>              scope to one group
//   ?status=ACTIVE               single status (default)
//   ?status=ACTIVE,SUSPENDED     explicit list
//   ?status=COUNTING             the entitlement counting set
//   ?status=APPLICANTS           PENDING only — join requests awaiting review
//   ?status=ALL                  every status, PENDING included

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'

export const dynamic = 'force-dynamic'

/**
 * Mirrors the MemberStatus enum IN THE DATABASE (pg_enum), which
 * includes PENDING. schema.prisma must be brought into line — see the
 * prerequisite note above.
 */
const VALID_STATUSES = [
  'ACTIVE',
  'SUSPENDED',
  'DEFAULTED',
  'EXITED',
  'BLACKLISTED',
  'PENDING',
] as const

/**
 * The statuses that count toward group size for entitlement.
 *
 * PENDING is deliberately EXCLUDED: a join request awaiting approval is
 * not yet a member, and letting pending applicants push a group over
 * minMembers would reopen the shell-group arbitrage the size check
 * exists to close.
 *
 * Identical to QUALIFYING_MEMBER_STATUSES in src/lib/entitlement and
 * COUNTING_MEMBER_STATUSES in src/lib/group-entitlement. If you change
 * this set, change it in all three — and in migration 1b's backfill.
 */
const COUNTING_STATUSES = ['ACTIVE', 'SUSPENDED', 'DEFAULTED']

/** Join requests awaiting a decision — the discover/approval queue. */
const APPLICANT_STATUSES = ['PENDING']

type StatusFilter =
  | { ok: true; statuses: string[] | null; label: string }
  | { ok: false; error: string }

function parseStatusParam(raw: string | null): StatusFilter {
  const value = (raw || 'ACTIVE').trim().toUpperCase()

  if (value === 'ALL') return { ok: true, statuses: null, label: 'ALL' }
  if (value === 'COUNTING') {
    return { ok: true, statuses: COUNTING_STATUSES, label: 'COUNTING' }
  }
  if (value === 'APPLICANTS') {
    return { ok: true, statuses: APPLICANT_STATUSES, label: 'APPLICANTS' }
  }

  const requested = value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  if (!requested.length) return { ok: true, statuses: ['ACTIVE'], label: 'ACTIVE' }

  const invalid = requested.filter(
    s => !VALID_STATUSES.includes(s as (typeof VALID_STATUSES)[number])
  )
  if (invalid.length) {
    return {
      ok: false,
      error:
        `Invalid status ${invalid.join(', ')}. ` +
        `Valid values: ${VALID_STATUSES.join(', ')}, COUNTING, APPLICANTS, ALL.`,
    }
  }

  // De-duplicate so ?status=ACTIVE,ACTIVE does not widen the IN clause.
  const statuses = Array.from(new Set(requested))
  return { ok: true, statuses, label: statuses.join(',') }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const groupId = searchParams.get('groupId')

    const parsed = parseStatusParam(searchParams.get('status'))
    if (!parsed.ok) {
      return NextResponse.json(
        { success: false, error: parsed.error },
        { status: 400 }
      )
    }

    // Single status stays an equality test rather than a one-element IN,
    // so the common case keeps using idx_groupmember_groupid_status
    // exactly as it did before.
    const where: any = {}
    if (parsed.statuses) {
      where.status =
        parsed.statuses.length === 1
          ? parsed.statuses[0]
          : { in: parsed.statuses }
    }
    if (groupId) where.groupId = groupId

    // Exclude members of soft-deleted groups. See note 4 in the header.
    where.group = { deletedAt: null }

    const members = await prisma.groupMember.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            tier: true,
            reputationScore: true,
            kycStatus: true,
          },
        },
        group: { select: { name: true, currency: true } },
      },
      orderBy: { user: { fullName: 'asc' } },
    })

    return NextResponse.json({
      success: true,
      data: members.map(m => ({
        id: m.user.id,
        memberId: m.id,
        fullName: m.user.fullName,
        email: m.user.email,
        phone: m.user.phone,
        tier: m.user.tier,
        reputationScore: Number(m.user.reputationScore),
        kycStatus: m.user.kycStatus,
        role: m.role,
        status: m.status,
        payoutPosition: m.payoutPosition,
        totalContributed: Number(m.totalContributed),
        groupId: m.groupId,
        groupName: m.group.name,
        joinedAt: m.joinedAt,
      })),
      // Additive. Callers reading only `data` are unaffected.
      meta: {
        total: members.length,
        statuses: parsed.statuses ?? 'ALL',
        filter: parsed.label,
        countsTowardEntitlement:
          parsed.statuses !== null &&
          parsed.statuses.every(s => COUNTING_STATUSES.includes(s)),
      },
    })
  } catch (error: any) {
    // A "not found in enum" message here means schema.prisma is behind
    // the database — see the prerequisite note at the top of this file.
    console.error('GET /api/members error:', error?.message)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch members' },
      { status: 500 }
    )
  }
}
