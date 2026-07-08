// src/app/api/dashboard/route.ts
// GET — everything the Overview tab needs in ONE request.
// All aggregates run in parallel via Promise.all; no N+1, no per-widget calls.
// NOTE: sums span groups regardless of currency — fine while testing in one
// currency; revisit with ExchangeRate conversion when groups go multi-currency.

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  try {
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
         FROM "Group" WHERE "deletedAt" IS NULL`
      ),
      prisma.$queryRawUnsafe(
        `SELECT COUNT(DISTINCT "userId")::int AS "totalMembers"
         FROM "GroupMember" WHERE "status" = 'ACTIVE'`
      ),
      prisma.$queryRawUnsafe(
        `SELECT COALESCE(SUM("poolAmount"), 0) AS "monthlyPool"
         FROM "Cycle" WHERE "status" = 'ACTIVE'`
      ),
      prisma.$queryRawUnsafe(
        `SELECT COUNT(*) FILTER (WHERE "status" = 'COMPLETED')::int AS "payoutsCompleted",
                COALESCE(SUM("amount") FILTER (WHERE "status" = 'COMPLETED'), 0) AS "paidOut"
         FROM "Payout"`
      ),
      prisma.$queryRawUnsafe(
        `SELECT COALESCE(SUM("amount"), 0) AS "platformRevenue"
         FROM "Transaction" WHERE "type" = 'FEE' AND "status" = 'COMPLETED'`
      ),
      prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS "activeLoans"
         FROM "Loan" WHERE "status" IN ('ACTIVE', 'DISBURSED')`
      ),
      prisma.$queryRawUnsafe(
        `SELECT COALESCE(SUM("amountPaid"), 0) AS "totalCollected"
         FROM "Contribution"`
      ),
      // Latest real activity from the audit log
      prisma.$queryRawUnsafe(
        `SELECT a."action", a."description", a."createdAt", u."fullName"
         FROM "AuditLog" a
         LEFT JOIN "User" u ON u."id" = a."userId"
         ORDER BY a."createdAt" DESC
         LIMIT 6`
      ),
      // Current active cycle's schedule (empty array when no cycle exists)
      prisma.$queryRawUnsafe(
        `SELECT ps."monthNumber", ps."scheduledDate", ps."payoutAmount",
                ps."status", u."fullName" AS "recipientName", g."name" AS "groupName"
         FROM "PayoutSchedule" ps
         JOIN "Cycle" c  ON c."id" = ps."cycleId" AND c."status" = 'ACTIVE'
         JOIN "Group" g  ON g."id" = c."groupId"
         JOIN "User"  u  ON u."id" = ps."recipientId"
         ORDER BY ps."scheduledDate" ASC
         LIMIT 12`
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
