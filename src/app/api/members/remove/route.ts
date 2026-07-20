// src/app/api/members/remove/route.ts
//
// Group Admin removes a member from a group.
//
// FINANCIAL-INTEGRITY RULE
// A member CANNOT be removed if they have ANY transaction under the group,
// across every Windfall Scheme. "Transaction" is read broadly:
//   • the unified Transaction ledger (groupId + userId)   — covers all schemes
//   • paid cycle Contributions
//   • Payouts received / in-flight
//   • Asset shared-ownership stakes + round-robin queue funding
//   • Property stakes
//   • Investment allocations
//   • Loans where money moved + loan repayments paid
//
// Removal is a SOFT remove: GroupMember.status → EXITED (auditable, reversible
// by re-inviting). The group owner is never removable.
//
// Endpoints:
//   GET    ?groupId=...            → { blockedUserIds: string[] }  (UI: disable buttons)
//   DELETE ?groupId=...&userId=... → soft-remove one member

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'
import { getSessionFromRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

async function sql(query: string, params: any[] = []) {
  return prisma.$queryRawUnsafe(query, ...params) as Promise<any[]>
}
async function exec(query: string, params: any[] = []) {
  return prisma.$executeRawUnsafe(query, ...params)
}

// ── Members with a financial footprint under a group ─────────────
// One UNION over every scheme, keyed by $1 = groupId. Returns userIds.
// Enum-column comparisons against string literals are cast implicitly
// by Postgres, so no explicit ::"Enum" casts are required here.
const BLOCKED_USERS_SQL = `
  SELECT DISTINCT uid FROM (
    SELECT t."userId" AS uid
      FROM "Transaction" t
     WHERE t."groupId" = $1 AND t."userId" IS NOT NULL
       AND t.status NOT IN ('FAILED','REVERSED','CANCELLED')
    UNION
    SELECT c."userId"
      FROM "Contribution" c
      JOIN "Cycle" cy ON cy.id = c."cycleId"
     WHERE cy."groupId" = $1 AND c."amountPaid" > 0
    UNION
    SELECT p."recipientId"
      FROM "Payout" p
      JOIN "Cycle" cy ON cy.id = p."cycleId"
     WHERE cy."groupId" = $1
       AND (p.status IN ('PROCESSING','COMPLETED','HELD') OR p."preEscrowCollected" > 0)
    UNION
    SELECT ao."userId"
      FROM "AssetOwnership" ao
      JOIN "Asset" a ON a.id = ao."assetId"
     WHERE a."groupId" = $1 AND ao."amountContributed" > 0
    UNION
    SELECT aq."userId"
      FROM "AssetQueueEntry" aq
      JOIN "Asset" a ON a.id = aq."assetId"
     WHERE a."groupId" = $1 AND aq."raisedAmount" > 0
    UNION
    SELECT ps."userId"
      FROM "PropertyStake" ps
      JOIN "PropertyGroup" pg ON pg.id = ps."propertyGroupId"
     WHERE pg."groupId" = $1 AND ps."totalContributed" > 0
    UNION
    SELECT ia."userId"
      FROM "InvestmentAllocation" ia
      JOIN "InvestmentPortfolio" ip ON ip.id = ia."portfolioId"
     WHERE ip."groupId" = $1 AND ia."amountContributed" > 0
    UNION
    SELECT l."borrowerId"
      FROM "Loan" l
     WHERE l."groupId" = $1
       AND l.status IN ('DISBURSED','ACTIVE','SETTLED','DEFAULTED')
    UNION
    SELECT l."borrowerId"
      FROM "LoanRepayment" lr
      JOIN "Loan" l ON l.id = lr."loanId"
     WHERE l."groupId" = $1 AND lr."amountPaid" > 0
  ) s
  WHERE uid IS NOT NULL
`

// Single-user version of the same guard: $1 = groupId, $2 = userId.
const HAS_FINANCIALS_SQL = `
  SELECT EXISTS (
    SELECT 1 FROM "Transaction" t
      WHERE t."groupId" = $1 AND t."userId" = $2
        AND t.status NOT IN ('FAILED','REVERSED','CANCELLED')
    UNION ALL
    SELECT 1 FROM "Contribution" c
      JOIN "Cycle" cy ON cy.id = c."cycleId"
      WHERE cy."groupId" = $1 AND c."userId" = $2 AND c."amountPaid" > 0
    UNION ALL
    SELECT 1 FROM "Payout" p
      JOIN "Cycle" cy ON cy.id = p."cycleId"
      WHERE cy."groupId" = $1 AND p."recipientId" = $2
        AND (p.status IN ('PROCESSING','COMPLETED','HELD') OR p."preEscrowCollected" > 0)
    UNION ALL
    SELECT 1 FROM "AssetOwnership" ao
      JOIN "Asset" a ON a.id = ao."assetId"
      WHERE a."groupId" = $1 AND ao."userId" = $2 AND ao."amountContributed" > 0
    UNION ALL
    SELECT 1 FROM "AssetQueueEntry" aq
      JOIN "Asset" a ON a.id = aq."assetId"
      WHERE a."groupId" = $1 AND aq."userId" = $2 AND aq."raisedAmount" > 0
    UNION ALL
    SELECT 1 FROM "PropertyStake" ps
      JOIN "PropertyGroup" pg ON pg.id = ps."propertyGroupId"
      WHERE pg."groupId" = $1 AND ps."userId" = $2 AND ps."totalContributed" > 0
    UNION ALL
    SELECT 1 FROM "InvestmentAllocation" ia
      JOIN "InvestmentPortfolio" ip ON ip.id = ia."portfolioId"
      WHERE ip."groupId" = $1 AND ia."userId" = $2 AND ia."amountContributed" > 0
    UNION ALL
    SELECT 1 FROM "Loan" l
      WHERE l."groupId" = $1 AND l."borrowerId" = $2
        AND l.status IN ('DISBURSED','ACTIVE','SETTLED','DEFAULTED')
    UNION ALL
    SELECT 1 FROM "LoanRepayment" lr
      JOIN "Loan" l ON l.id = lr."loanId"
      WHERE l."groupId" = $1 AND l."borrowerId" = $2 AND lr."amountPaid" > 0
  ) AS has_financials
`

// Caller must be a platform admin, the group owner, or an ACTIVE GROUP_ADMIN
// of this group. Returns { ok, adminUserId } or null when the group is gone.
async function authoriseManager(groupId: string, session: { id: string; role: string }) {
  const seesAll = ['SYSTEM_ADMIN', 'NATIONAL_ADMIN'].includes(session.role)
  const rows = await sql(
    `SELECT g."adminUserId",
            EXISTS (
              SELECT 1 FROM "GroupMember" gm
               WHERE gm."groupId" = $1 AND gm."userId" = $2
                 AND gm.role = 'GROUP_ADMIN' AND gm.status = 'ACTIVE'
            ) AS "isGroupAdmin"
       FROM "Group" g
      WHERE g.id = $1 AND g."deletedAt" IS NULL`,
    [groupId, session.id]
  )
  if (!rows.length) return null
  const adminUserId: string = rows[0].adminUserId
  const ok = seesAll || adminUserId === session.id || rows[0].isGroupAdmin === true
  return { ok, adminUserId }
}

// ── GET — blocked (non-removable) member ids for a group ─────────
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req)
    if (!session) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }
    const groupId = new URL(req.url).searchParams.get('groupId')
    if (!groupId) {
      return NextResponse.json({ success: false, error: 'groupId required' }, { status: 400 })
    }

    // AUDITOR may view; managers may view. Anyone else scoped out.
    const seesAll = ['SYSTEM_ADMIN', 'NATIONAL_ADMIN', 'AUDITOR'].includes(session.role)
    if (!seesAll) {
      const auth = await authoriseManager(groupId, session)
      if (!auth) return NextResponse.json({ success: false, error: 'Group not found' }, { status: 404 })
      if (!auth.ok) return NextResponse.json({ success: false, error: 'Not permitted' }, { status: 403 })
    }

    const rows = await sql(BLOCKED_USERS_SQL, [groupId])
    const blockedUserIds = rows.map((r: any) => r.uid).filter(Boolean)
    return NextResponse.json({ success: true, data: { blockedUserIds } })
  } catch (e: any) {
    console.error('GET /api/members/remove error:', e?.message)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── DELETE — soft-remove a member from a group ──────────────────
export async function DELETE(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req)
    if (!session) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }
    // AUDITOR is read-only.
    if (session.role === 'AUDITOR') {
      return NextResponse.json({ success: false, error: 'Auditors cannot remove members' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const groupId = searchParams.get('groupId')
    const userId  = searchParams.get('userId')
    const reason  = searchParams.get('reason') || 'Removed by group admin'
    if (!groupId || !userId) {
      return NextResponse.json({ success: false, error: 'groupId and userId are required' }, { status: 400 })
    }

    // Permission
    const auth = await authoriseManager(groupId, session)
    if (!auth) return NextResponse.json({ success: false, error: 'Group not found' }, { status: 404 })
    if (!auth.ok) return NextResponse.json({ success: false, error: 'Not permitted to manage this group' }, { status: 403 })

    // The group owner is never removable.
    if (userId === auth.adminUserId) {
      return NextResponse.json({ success: false, error: 'The group owner cannot be removed' }, { status: 400 })
    }

    // Must be an existing, non-exited membership.
    const memberRows = await sql(
      `SELECT gm.id, gm.status, u."fullName"
         FROM "GroupMember" gm
         JOIN "User" u ON u.id = gm."userId"
        WHERE gm."groupId" = $1 AND gm."userId" = $2`,
      [groupId, userId]
    )
    if (!memberRows.length) {
      return NextResponse.json({ success: false, error: 'Member not found in this group' }, { status: 404 })
    }
    if (memberRows[0].status === 'EXITED') {
      return NextResponse.json({ success: false, error: 'Member has already been removed' }, { status: 400 })
    }
    const memberName: string = memberRows[0].fullName || 'Member'

    // ── FINANCIAL-INTEGRITY GUARD ─────────────────────────────
    const guard = await sql(HAS_FINANCIALS_SQL, [groupId, userId])
    if (guard[0]?.has_financials === true) {
      return NextResponse.json({
        success: false,
        blocked: true,
        error: `${memberName} has transactions under this group and cannot be removed.`,
      }, { status: 409 })
    }

    // ── Soft-remove ───────────────────────────────────────────
    const updated = await sql(
      `UPDATE "GroupMember"
          SET status       = 'EXITED'::"MemberStatus",
              "exitedAt"   = NOW(),
              "exitReason" = $3,
              "updatedAt"  = NOW()
        WHERE "groupId" = $1 AND "userId" = $2
          AND status <> 'EXITED'::"MemberStatus"
      RETURNING id`,
      [groupId, userId, reason]
    )
    if (!updated.length) {
      return NextResponse.json({ success: false, error: 'Member could not be removed' }, { status: 400 })
    }

    // Drop dangling treasurer/secretary references to the removed member.
    await exec(
      `UPDATE "Group"
          SET "treasurerId" = CASE WHEN "treasurerId" = $2 THEN NULL ELSE "treasurerId" END,
              "secretaryId" = CASE WHEN "secretaryId" = $2 THEN NULL ELSE "secretaryId" END,
              "updatedAt"   = NOW()
        WHERE id = $1`,
      [groupId, userId]
    )

    await prisma.auditLog.create({
      data: {
        userId:      session.id,
        groupId,
        action:      'DELETE',
        entityType:  'GroupMember',
        entityId:    updated[0].id,
        description: `${memberName} removed from group`,
      } as any,
    })

    return NextResponse.json({ success: true, message: `${memberName} has been removed from the group` })
  } catch (e: any) {
    console.error('DELETE /api/members/remove error:', e?.message)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
