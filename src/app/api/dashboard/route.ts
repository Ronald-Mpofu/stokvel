// src/app/api/dashboard/route.ts
// GET — everything the Overview tab needs in ONE request.
// All aggregates run in parallel via Promise.all; no N+1, no per-widget calls.
// Role scoping (BR 1 & 4): SYSTEM_ADMIN / NATIONAL_ADMIN / AUDITOR see
// platform-wide totals; everyone else sees totals ONLY for groups they
// manage (creator, or ACTIVE GROUP_ADMIN member role).
// NOTE: sums span groups regardless of currency — fine while testing in one
// currency; revisit with ExchangeRate conversion when groups go multi-currency.

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'
import { getSessionFromRequest, unauthorized } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const SEES_ALL = ['SYSTEM_ADMIN', 'NATIONAL_ADMIN', 'AUDITOR']

// SQL fragment resolving the caller's manageable group IDs ($1 = userId).
// Used as: WHERE ... AND <column> IN (SCOPED_GROUPS)
const SCOPED_GROUPS = `(
  SELECT g2."id" FROM "Group" g2
  WHERE g2."deletedAt" IS NULL AND (
    g2."adminUserId" = $1
    OR EXISTS (
      SELECT 1 FROM "GroupMember" gm
      WHERE gm."groupId" = g2."id"
        AND gm."userId"  = $1
        AND gm."role"    = 'GROUP_ADMIN'
        AND gm."status"  = 'ACTIVE'
    )
  )
)`

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req)
    if (!session) return unauthorized()

    const scoped = !SEES_ALL.includes(session.role)
    const params = scoped ? [session.id] : []

    // Per-query scope fragments (empty string when unscoped)
    const sGroup    = scoped ? `AND "id" IN ${SCOPED_GROUPS}` : ''
    const sGroupCol = scoped ? `AND "groupId" IN ${SCOPED_GROUPS}` : ''
    const sCycle    = scoped ? `AND "cycleId" IN (SELECT "id" FROM "Cycle" WHERE "groupId" IN ${SCOPED_GROUPS})` : ''
    const sAudit    = scoped ? `WHERE a."groupId" IN ${SCOPED_GROUPS}` : ''
    const sSched    = scoped ? `AND c."groupId" IN ${SCOPED_GROUPS}` : ''

    const [
      groupAgg,
      memberAgg,
      cycleAgg,
      payoutAgg,
      revenueAgg,
      loanAgg,
      contributionAgg,
      recentActivity,
      payoutSchedule,
    ] = await Promise.all([
      // Active groups + escrow + insurance in one pass
      prisma.$queryRawUnsafe(
        `SELECT COUNT(*) FILTER (WHERE "status" = 'ACTIVE')::int AS "activeGroups",
                COALESCE(SUM("escrowBalance"), 0)                AS "escrowBalance",
                COALESCE(SUM("insurancePoolBalance"), 0)         AS "insurancePool"
         FROM "Group" WHERE "deletedAt" IS NULL ${sGroup}`, ...params
      ),
      prisma.$queryRawUnsafe(
        `SELECT COUNT(DISTINCT "userId")::int AS "totalMembers"
         FROM "GroupMember" WHERE "status" = 'ACTIVE' ${sGroupCol}`, ...params
      ),
      prisma.$queryRawUnsafe(
        `SELECT COALESCE(SUM("poolAmount"), 0) AS "monthlyPool"
         FROM "Cycle" WHERE "status" = 'ACTIVE' ${sGroupCol}`, ...params
      ),
      prisma.$queryRawUnsafe(
        `SELECT COUNT(*) FILTER (WHERE "status" = 'COMPLETED')::int AS "payoutsCompleted",
                COALESCE(SUM("amount") FILTER (WHERE "status" = 'COMPLETED'), 0) AS "paidOut"
         FROM "Payout" WHERE 1=1 ${sCycle}`, ...params
      ),
      prisma.$queryRawUnsafe(
        `SELECT COALESCE(SUM("amount"), 0) AS "platformRevenue"
         FROM "Transaction" WHERE "type" = 'FEE' AND "status" = 'COMPLETED' ${sGroupCol}`, ...params
      ),
      prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS "activeLoans"
         FROM "Loan" WHERE "status" IN ('ACTIVE', 'DISBURSED') ${sGroupCol}`, ...params
      ),
      prisma.$queryRawUnsafe(
        `SELECT COALESCE(SUM("amountPaid"), 0) AS "totalCollected"
         FROM "Contribution" WHERE 1=1 ${sCycle}`, ...params
      ),
      // Latest real activity from the audit log
      prisma.$queryRawUnsafe(
        `SELECT a."action", a."description", a."createdAt", u."fullName"
         FROM "AuditLog" a
         LEFT JOIN "User" u ON u."id" = a."userId"
         ${sAudit}
         ORDER BY a."createdAt" DESC
         LIMIT 6`, ...params
      ),
      // Current active cycle's schedule (empty array when no cycle exists)
      prisma.$queryRawUnsafe(
        `SELECT ps."monthNumber", ps."scheduledDate", ps."payoutAmount",
                ps."status", u."fullName" AS "recipientName", g."name" AS "groupName"
         FROM "PayoutSchedule" ps
         JOIN "Cycle" c  ON c."id" = ps."cycleId" AND c."status" = 'ACTIVE'
         JOIN "Group" g  ON g."id" = c."groupId"
         JOIN "User"  u  ON u."id" = ps."recipientId"
         WHERE 1=1 ${sSched}
         ORDER BY ps."scheduledDate" ASC
         LIMIT 12`, ...params
      ),
    ])

    const g = (groupAgg as any[])[0] || {}
    const m = (memberAgg as any[])[0] || {}
    const c = (cycleAgg as any[])[0] || {}
    const p = (payoutAgg as any[])[0] || {}
    const r = (revenueAgg as any[])[0] || {}
    const l = (loanAgg as any[])[0] || {}
    const co = (contributionAgg as any[])[0] || {}

    return NextResponse.json({
      success: true,
      data: {
        stats: {
          activeGroups: Number(g.activeGroups || 0),
          totalMembers: Number(m.totalMembers || 0),
          escrowBalance: Number(g.escrowBalance || 0),
          insurancePool: Number(g.insurancePool || 0),
          monthlyPool: Number(c.monthlyPool || 0),
          payoutsCompleted: Number(p.payoutsCompleted || 0),
          platformRevenue: Number(r.platformRevenue || 0),
          activeLoans: Number(l.activeLoans || 0),
        },
        escrowHealth: {
          totalCollected: Number(co.totalCollected || 0),
          paidOut: Number(p.paidOut || 0),
          heldInEscrow: Number(g.escrowBalance || 0),
          insurancePool: Number(g.insurancePool || 0),
        },
        recentActivity: (recentActivity as any[]).map(a => ({
          action: a.action,
          description: a.description || `${a.action} by ${a.fullName || 'system'}`,
          createdAt: a.createdAt,
        })),
        payoutSchedule: (payoutSchedule as any[]).map(s => ({
          monthNumber: s.monthNumber,
          scheduledDate: s.scheduledDate,
          amount: Number(s.payoutAmount),
          status: s.status,
          recipientName: s.recipientName,
          groupName: s.groupName,
        })),
      },
    })
  } catch (e: any) {
    console.error('GET /api/dashboard error:', e?.message)
    return NextResponse.json({ success: false, error: 'Failed to load dashboard data' }, { status: 500 })
  }
}
