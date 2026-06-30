// src/app/api/portal/route.ts
// Defensive version — wraps every new-model query in try/catch
// so the portal loads even if db:generate hasn't been re-run
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'

async function safeQuery<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn() } catch { return fallback }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const userId  = searchParams.get('userId')
    const section = searchParams.get('section') || 'overview'

    if (!userId) return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 })

    // ── User ──────────────────────────────────────────────────
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, fullName: true, email: true, phone: true,
        city: true, country: true, kycStatus: true, tier: true,
        reputationScore: true, status: true, createdAt: true,
      },
    })
    if (!user) return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 })

    // ── Memberships ───────────────────────────────────────────
    const memberships = await safeQuery(() => prisma.groupMember.findMany({
      where: { userId, status: 'ACTIVE' },
      include: {
        group: {
          select: {
            id: true, name: true, currency: true,
            contributionAmount: true, contributionDay: true,
            maxMembers: true, status: true, payoutStrategy: true,
            escrowBalance: true,
            _count: { select: { members: true } },
          },
        },
      },
    }), [])

    if (section === 'overview') {
      // Transactions — exists in original schema
      const transactions = await safeQuery(() => prisma.transaction.findMany({
        where:   { userId, type: 'CONTRIBUTION' },
        orderBy: { createdAt: 'desc' },
        take:    10,
        select: {
          id: true, amount: true, currency: true, status: true,
          paymentMethod: true, reference: true, description: true,
          groupId: true, createdAt: true,
        },
      }), [])

      const totalAgg = await safeQuery(() => prisma.transaction.aggregate({
        where: { userId, type: 'CONTRIBUTION', status: 'COMPLETED' },
        _sum:  { amount: true },
      }), { _sum: { amount: null } })

      // Payout schedules — new model, may not exist in client
      const payoutSchedules = await safeQuery(() => (prisma as any).payoutSchedule.findMany({
        where:   { recipientId: userId },
        include: {
          cycle: {
            select: {
              cycleNumber: true,
              group: { select: { name: true, currency: true } },
            },
          },
        },
        orderBy: { monthNumber: 'asc' },
      }), [])

      // Asset ownerships — new model
      const assetOwnerships = await safeQuery(() => (prisma as any).assetOwnership.findMany({
        where:   { userId },
        include: {
          asset: {
            select: {
              id: true, name: true, type: true, status: true,
              currentValue: true, incomeGenerated: true,
              group: { select: { currency: true } },
            },
          },
        },
      }), [])

      // Queue entries — new model
      const queueEntries = await safeQuery(() => (prisma as any).assetQueueEntry.findMany({
        where:   { userId, status: { not: 'SKIPPED' } },
        include: {
          asset: {
            select: {
              id: true, name: true, type: true, unitCost: true,
              group: { select: { name: true, currency: true } },
            },
          },
        },
        orderBy: { position: 'asc' },
      }), [])

      // Income shares — new model
      const incomeShares = await safeQuery(() => (prisma as any).assetIncomeShare.findMany({
        where:   { userId },
        include: {
          income: {
            select: {
              type: true, incomeDate: true, description: true,
              asset: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take:    5,
      }), [])

      const totalIncome = await safeQuery(() => (prisma as any).assetIncomeShare.aggregate({
        where: { userId },
        _sum:  { shareAmount: true },
      }), { _sum: { shareAmount: null } })

      // Group name map for transactions
      const groupIds = [...new Set((transactions as any[]).map((t: any) => t.groupId).filter(Boolean))]
      const groups   = groupIds.length > 0
        ? await safeQuery(() => prisma.group.findMany({
            where:  { id: { in: groupIds as string[] } },
            select: { id: true, name: true, currency: true },
          }), [])
        : []
      const groupMap = Object.fromEntries((groups as any[]).map((g: any) => [g.id, g]))

      // Upcoming contributions
      const now = new Date()
      const upcoming = (memberships as any[]).map((m: any) => {
        const day  = m.group.contributionDay || 1
        const next = new Date(now.getFullYear(), now.getMonth(), day)
        if (next <= now) next.setMonth(next.getMonth() + 1)
        return {
          groupId:   m.groupId,
          groupName: m.group.name,
          currency:  m.group.currency,
          amount:    Number(m.group.contributionAmount),
          dueDate:   next,
          daysUntil: Math.ceil((next.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
        }
      })

      return NextResponse.json({
        success: true,
        data: {
          user,
          memberships: (memberships as any[]).map((m: any) => ({
            groupId:        m.groupId,
            groupName:      m.group.name,
            role:           m.role,
            joinedAt:       m.joinedAt,
            currency:       m.group.currency,
            contribution:   Number(m.group.contributionAmount),
            memberCount:    m.group._count.members,
            maxMembers:     m.group.maxMembers,
            escrowBalance:  Number(m.group.escrowBalance),
            payoutStrategy: m.group.payoutStrategy,
            groupStatus:    m.group.status,
          })),
          summary: {
            totalContributed: Number((totalAgg as any)._sum?.amount || 0),
            totalGroups:      memberships.length,
            totalAssets:      assetOwnerships.length,
            totalIncome:      Number((totalIncome as any)._sum?.shareAmount || 0),
          },
          recentContributions: (transactions as any[]).map((t: any) => ({
            id:        t.id,
            groupName: groupMap[t.groupId]?.name || 'Unknown Group',
            currency:  t.currency,
            amount:    Number(t.amount),
            status:    t.status,
            reference: t.reference,
            description: t.description,
            createdAt: t.createdAt,
          })),
          upcomingContributions: upcoming.sort((a: any, b: any) => a.daysUntil - b.daysUntil),
          payoutPositions: (payoutSchedules as any[]).map((p: any) => ({
            id:            p.id,
            groupName:     p.cycle?.group?.name || '—',
            currency:      p.cycle?.group?.currency || 'USD',
            position:      p.monthNumber,
            status:        p.status,
            payoutAmount:  Number(p.payoutAmount),
            scheduledDate: p.scheduledDate,
            cycleNumber:   p.cycle?.cycleNumber,
          })),
          assetOwnerships: (assetOwnerships as any[]).map((o: any) => ({
            assetId:      o.assetId,
            assetName:    o.asset?.name || '—',
            assetType:    o.asset?.type || 'OTHER',
            assetStatus:  o.asset?.status || '—',
            currency:     o.asset?.group?.currency || 'USD',
            ownershipPct: Number(o.ownershipPct),
            contributed:  Number(o.amountContributed),
            currentValue: Number(o.asset?.currentValue || 0),
            myValue:      Number(o.asset?.currentValue || 0) * Number(o.ownershipPct) / 100,
          })),
          queueEntries: (queueEntries as any[]).map((q: any) => ({
            assetId:      q.assetId,
            assetName:    q.asset?.name || '—',
            assetType:    q.asset?.type || 'OTHER',
            groupName:    q.asset?.group?.name || '—',
            currency:     q.asset?.group?.currency || 'USD',
            position:     q.position,
            status:       q.status,
            targetAmount: Number(q.targetAmount),
            raisedAmount: Number(q.raisedAmount),
            fundingPct:   Math.min(100, Math.round(
              Number(q.raisedAmount) / Math.max(1, Number(q.targetAmount)) * 100
            )),
            deliveredAt:  q.deliveredAt,
            serialNumber: q.serialNumber,
          })),
          recentIncome: (incomeShares as any[]).map((s: any) => ({
            id:           s.id,
            assetName:    s.income?.asset?.name || '—',
            type:         s.income?.type || '—',
            description:  s.income?.description || '—',
            shareAmount:  Number(s.shareAmount),
            ownershipPct: Number(s.ownershipPct),
            status:       s.status,
            incomeDate:   s.income?.incomeDate,
          })),
        },
      })
    }

    // ── CONTRIBUTIONS ─────────────────────────────────────────
    if (section === 'contributions') {
      const transactions = await safeQuery(() => prisma.transaction.findMany({
        where:   { userId, type: 'CONTRIBUTION' },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, amount: true, currency: true, status: true,
          paymentMethod: true, reference: true, description: true,
          groupId: true, createdAt: true,
        },
      }), [])

      const groupIds = [...new Set((transactions as any[]).map((t: any) => t.groupId).filter(Boolean))]
      const groups   = groupIds.length > 0
        ? await safeQuery(() => prisma.group.findMany({
            where:  { id: { in: groupIds as string[] } },
            select: { id: true, name: true, currency: true },
          }), [])
        : []
      const groupMap = Object.fromEntries((groups as any[]).map((g: any) => [g.id, g]))

      const byStatus = {
        completed: (transactions as any[]).filter((t: any) => t.status === 'COMPLETED').length,
        pending:   (transactions as any[]).filter((t: any) => t.status === 'PENDING').length,
        failed:    (transactions as any[]).filter((t: any) => t.status === 'FAILED').length,
      }

      return NextResponse.json({
        success: true,
        data: {
          contributions: (transactions as any[]).map((t: any) => ({
            id:            t.id,
            groupName:     groupMap[t.groupId]?.name || 'Unknown Group',
            currency:      t.currency,
            amount:        Number(t.amount),
            status:        t.status,
            paymentMethod: t.paymentMethod,
            reference:     t.reference,
            description:   t.description,
            createdAt:     t.createdAt,
          })),
          byStatus,
          totalPaid: (transactions as any[])
            .filter((t: any) => t.status === 'COMPLETED')
            .reduce((s: number, t: any) => s + Number(t.amount), 0),
        },
      })
    }

    // ── DOCUMENTS ─────────────────────────────────────────────
    if (section === 'documents') {
      const [certificates, incomeShares] = await Promise.all([
        safeQuery(() => (prisma as any).assetQueueEntry.findMany({
          where:   { userId, status: 'DELIVERED' },
          include: { asset: { select: { name: true, type: true } } },
        }), []),
        safeQuery(() => (prisma as any).assetIncomeShare.findMany({
          where:   { userId },
          include: {
            income: {
              select: {
                type: true, incomeDate: true, description: true,
                asset: { select: { name: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }), []),
      ])

      return NextResponse.json({
        success: true,
        data: {
          handoverCertificates: (certificates as any[]).map((e: any) => ({
            entryId:      e.id,
            assetName:    e.asset?.name || '—',
            assetType:    e.asset?.type || 'OTHER',
            deliveredAt:  e.deliveredAt,
            serialNumber: e.serialNumber,
          })),
          incomeStatements: (incomeShares as any[]).map((s: any) => ({
            id:          s.id,
            assetName:   s.income?.asset?.name || '—',
            type:        s.income?.type || '—',
            description: s.income?.description || '—',
            shareAmount: Number(s.shareAmount),
            status:      s.status,
            incomeDate:  s.income?.incomeDate,
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
