// src/app/api/portal/route.ts
// Single endpoint that returns everything a member needs for their portal
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    const section = searchParams.get('section') || 'overview'

    if (!userId) return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 })

    // ── User profile ───────────────────────────────────────────
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, fullName: true, email: true, phone: true,
        city: true, country: true, kycStatus: true, tier: true,
        reputationScore: true, status: true, createdAt: true,
      },
    })
    if (!user) return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 })

    // ── Group memberships ─────────────────────────────────────
    const memberships = await prisma.groupMember.findMany({
      where: { userId, status: 'ACTIVE' },
      include: {
        group: {
          select: {
            id: true, name: true, currency: true, contributionAmount: true,
            contributionDay: true, maxMembers: true, status: true,
            payoutStrategy: true, escrowBalance: true,
            _count: { select: { members: true } },
          },
        },
      },
    })

    if (section === 'overview') {
      // ── Contributions summary ──────────────────────────────
      const contributions = await prisma.contribution.findMany({
        where:   { userId },
        include: { group: { select: { name: true, currency: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      })

      const totalContributed = await prisma.contribution.aggregate({
        where:  { userId, status: 'COMPLETED' },
        _sum:   { amount: true },
      })

      // ── Upcoming contributions ─────────────────────────────
      const now = new Date()
      const upcoming = memberships.map(m => {
        const day  = m.group.contributionDay || 1
        const next = new Date(now.getFullYear(), now.getMonth(), day)
        if (next <= now) next.setMonth(next.getMonth() + 1)
        return {
          groupId:    m.groupId,
          groupName:  m.group.name,
          currency:   m.group.currency,
          amount:     Number(m.group.contributionAmount),
          dueDate:    next,
          daysUntil:  Math.ceil((next.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
        }
      })

      // ── Payout positions ───────────────────────────────────
      const payoutSchedules = await prisma.payoutSchedule.findMany({
        where:   { userId },
        include: { cycle: { include: { group: { select: { name: true, currency: true } } } } },
        orderBy: { position: 'asc' },
      })

      // ── Assets ────────────────────────────────────────────
      const assetOwnerships = await prisma.assetOwnership.findMany({
        where:   { userId },
        include: { asset: { select: { id: true, name: true, type: true, status: true, currentValue: true, incomeGenerated: true, group: { select: { currency: true } } } } },
      })

      const queueEntries = await prisma.assetQueueEntry.findMany({
        where:   { userId, status: { not: 'SKIPPED' } },
        include: { asset: { select: { id: true, name: true, type: true, unitCost: true, group: { select: { name: true, currency: true } } } } },
        orderBy: { position: 'asc' },
      })

      // ── Income received ───────────────────────────────────
      const incomeShares = await prisma.assetIncomeShare.findMany({
        where:   { userId },
        include: { income: { select: { type: true, incomeDate: true, asset: { select: { name: true } } } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      })

      const totalIncome = await prisma.assetIncomeShare.aggregate({
        where: { userId },
        _sum:  { shareAmount: true },
      })

      return NextResponse.json({
        success: true,
        data: {
          user,
          memberships: memberships.map(m => ({
            groupId:      m.groupId,
            groupName:    m.group.name,
            role:         m.role,
            joinedAt:     m.joinedAt,
            currency:     m.group.currency,
            contribution: Number(m.group.contributionAmount),
            memberCount:  m.group._count.members,
            maxMembers:   m.group.maxMembers,
            escrowBalance: Number(m.group.escrowBalance),
            payoutStrategy: m.group.payoutStrategy,
            groupStatus:  m.group.status,
          })),
          summary: {
            totalContributed: Number(totalContributed._sum.amount || 0),
            totalGroups:      memberships.length,
            totalAssets:      assetOwnerships.length,
            totalIncome:      Number(totalIncome._sum.shareAmount || 0),
          },
          recentContributions: contributions.map(c => ({
            id:         c.id,
            groupName:  c.group.name,
            currency:   c.group.currency,
            amount:     Number(c.amount),
            status:     c.status,
            createdAt:  c.createdAt,
          })),
          upcomingContributions: upcoming.sort((a, b) => a.daysUntil - b.daysUntil),
          payoutPositions: payoutSchedules.map(p => ({
            id:          p.id,
            groupName:   p.cycle.group.name,
            currency:    p.cycle.group.currency,
            position:    p.position,
            status:      p.status,
            payoutAmount: Number(p.payoutAmount),
            scheduledDate: p.scheduledDate,
            cycleNumber: p.cycle.cycleNumber,
          })),
          assetOwnerships: assetOwnerships.map(o => ({
            assetId:      o.assetId,
            assetName:    o.asset.name,
            assetType:    o.asset.type,
            assetStatus:  o.asset.status,
            currency:     o.asset.group.currency,
            ownershipPct: Number(o.ownershipPct),
            contributed:  Number(o.amountContributed),
            currentValue: Number(o.asset.currentValue || 0),
            myValue:      Number(o.asset.currentValue || 0) * Number(o.ownershipPct) / 100,
          })),
          queueEntries: queueEntries.map(q => ({
            assetId:      q.assetId,
            assetName:    q.asset.name,
            assetType:    q.asset.type,
            groupName:    q.asset.group.name,
            currency:     q.asset.group.currency,
            position:     q.position,
            status:       q.status,
            targetAmount: Number(q.targetAmount),
            raisedAmount: Number(q.raisedAmount),
            fundingPct:   Math.min(100, Math.round(Number(q.raisedAmount) / Math.max(1, Number(q.targetAmount)) * 100)),
            deliveredAt:  q.deliveredAt,
            serialNumber: q.serialNumber,
          })),
          recentIncome: incomeShares.map(s => ({
            id:           s.id,
            assetName:    s.income.asset?.name,
            type:         s.income.type,
            shareAmount:  Number(s.shareAmount),
            ownershipPct: Number(s.ownershipPct),
            status:       s.status,
            incomeDate:   s.income.incomeDate,
          })),
        },
      })
    }

    // ── Contributions section ──────────────────────────────────
    if (section === 'contributions') {
      const contributions = await prisma.contribution.findMany({
        where:   { userId },
        include: { group: { select: { name: true, currency: true } } },
        orderBy: { createdAt: 'desc' },
      })
      const byStatus = {
        completed: contributions.filter(c => c.status === 'COMPLETED').length,
        pending:   contributions.filter(c => c.status === 'PENDING').length,
        late:      contributions.filter(c => c.status === 'LATE').length,
      }
      return NextResponse.json({
        success: true,
        data: {
          contributions: contributions.map(c => ({
            id: c.id, groupName: c.group.name, currency: c.group.currency,
            amount: Number(c.amount), status: c.status,
            paymentMethod: c.paymentMethod, reference: c.reference,
            dueDate: c.dueDate, createdAt: c.createdAt,
          })),
          byStatus,
          totalPaid: contributions.filter(c => c.status === 'COMPLETED').reduce((s, c) => s + Number(c.amount), 0),
        },
      })
    }

    // ── Documents section ─────────────────────────────────────
    if (section === 'documents') {
      const [certificates, incomeShares] = await Promise.all([
        prisma.assetQueueEntry.findMany({
          where:   { userId, status: 'DELIVERED' },
          include: { asset: { select: { name: true, type: true } } },
        }),
        prisma.assetIncomeShare.findMany({
          where:   { userId },
          include: { income: { select: { type: true, incomeDate: true, description: true, asset: { select: { name: true } } } } },
          orderBy: { createdAt: 'desc' },
        }),
      ])
      return NextResponse.json({
        success: true,
        data: {
          handoverCertificates: certificates.map(e => ({
            entryId:     e.id,
            assetName:   e.asset.name,
            assetType:   e.asset.type,
            deliveredAt: e.deliveredAt,
            serialNumber: e.serialNumber,
          })),
          incomeStatements: incomeShares.map(s => ({
            id:          s.id,
            assetName:   s.income.asset?.name,
            type:        s.income.type,
            description: s.income.description,
            shareAmount: Number(s.shareAmount),
            status:      s.status,
            incomeDate:  s.income.incomeDate,
          })),
        },
      })
    }

    return NextResponse.json({ success: false, error: 'Unknown section' }, { status: 400 })
  } catch (e: any) {
    console.error('Portal API error:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
