// src/app/api/contributions/summary/route.ts
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const groupId = searchParams.get('groupId')

    // Get active cycles
    const cycles = await prisma.cycle.findMany({
      where: groupId ? { groupId, status: 'ACTIVE' } : { status: 'ACTIVE' },
      include: { group: { select: { name: true, currency: true, contributionAmount: true } } },
    })

    if (cycles.length === 0) {
      return NextResponse.json({ success: true, data: { cycles: [], totals: { due: 0, paid: 0, outstanding: 0, defaulted: 0, members: 0 } } })
    }

    const cycleIds = cycles.map(c => c.id)

    // Aggregate contributions
    const [statusCounts, recentPayments, upcomingDue] = await Promise.all([
      prisma.contribution.groupBy({
        by: ['status', 'cycleId'],
        where: { cycleId: { in: cycleIds } },
        _count: { status: true },
        _sum:   { amountDue: true, amountPaid: true },
      }),
      prisma.contribution.findMany({
        where: { cycleId: { in: cycleIds }, status: 'PAID', paidAt: { not: null } },
        include: { user: { select: { fullName: true } }, cycle: { select: { group: { select: { name: true, currency: true } } } } },
        orderBy: { paidAt: 'desc' },
        take: 10,
      }),
      prisma.contribution.findMany({
        where: {
          cycleId: { in: cycleIds },
          status: { in: ['PENDING', 'LATE', 'FAILED'] },
          dueDate: { lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
        },
        include: { user: { select: { fullName: true, phone: true } }, cycle: { select: { group: { select: { name: true, currency: true } } } } },
        orderBy: { dueDate: 'asc' },
        take: 20,
      }),
    ])

    // Compute totals
    const totals = statusCounts.reduce((acc, s) => {
      acc.due      += Number(s._sum.amountDue || 0)
      acc.paid     += Number(s._sum.amountPaid || 0)
      if (s.status === 'DEFAULTED') acc.defaulted += s._count.status
      acc.members  += s._count.status
      return acc
    }, { due: 0, paid: 0, outstanding: 0, defaulted: 0, members: 0 })
    totals.outstanding = totals.due - totals.paid

    return NextResponse.json({
      success: true,
      data: {
        cycles: cycles.map(c => ({
          id: c.id, cycleNumber: c.cycleNumber, groupName: c.group.name, currency: c.group.currency,
          contributionAmount: Number(c.group.contributionAmount), poolAmount: Number(c.poolAmount),
          totalMembers: c.totalMembers, startDate: c.startDate, endDate: c.endDate,
        })),
        statusBreakdown: statusCounts.map(s => ({
          status: s.status, count: s._count.status,
          totalDue: Number(s._sum.amountDue || 0), totalPaid: Number(s._sum.amountPaid || 0),
        })),
        recentPayments: recentPayments.map(p => ({
          id: p.id, memberName: p.user.fullName, amount: Number(p.amountPaid),
          currency: p.cycle.group.currency, groupName: p.cycle.group.name,
          paidAt: p.paidAt, monthNumber: p.monthNumber,
        })),
        upcomingDue: upcomingDue.map(c => ({
          id: c.id, memberName: c.user.fullName, phone: c.user.phone,
          amountDue: Number(c.amountDue), currency: c.cycle.group.currency,
          groupName: c.cycle.group.name, dueDate: c.dueDate, status: c.status, monthNumber: c.monthNumber,
        })),
        totals,
      },
    })
  } catch (error) {
    console.error('GET /api/contributions/summary error:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch summary' }, { status: 500 })
  }
}
