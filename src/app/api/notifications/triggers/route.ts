// src/app/api/notifications/triggers/route.ts
// Called by a cron job (e.g. daily at 8am)
// Scans for due/overdue contributions and sends reminders

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'
import { sendNotification, templates } from '@/lib/notifications/engine'

export async function POST(req: NextRequest) {
  // Protect with a secret key
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET || 'stokvel-cron-2025'
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { trigger } = await req.json()
    const results: Record<string, number> = {}

    if (trigger === 'CONTRIBUTION_REMINDERS' || trigger === 'ALL') {
      results.contributionReminders = await runContributionReminders()
    }
    if (trigger === 'QUEUE_CHECKS' || trigger === 'ALL') {
      results.queueChecks = await runQueueChecks()
    }
    if (trigger === 'PAYOUT_REMINDERS' || trigger === 'ALL') {
      results.payoutReminders = await runPayoutReminders()
    }

    return NextResponse.json({ success: true, data: results })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── Also allow GET for manual testing ────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const trigger = searchParams.get('trigger') || 'ALL'
  const results: Record<string, any> = {}

  try {
    if (trigger === 'CONTRIBUTION_REMINDERS' || trigger === 'ALL') {
      results.contributionReminders = await runContributionReminders()
    }
    if (trigger === 'QUEUE_CHECKS' || trigger === 'ALL') {
      results.queueChecks = await runQueueChecks()
    }
    if (trigger === 'PAYOUT_REMINDERS' || trigger === 'ALL') {
      results.payoutReminders = await runPayoutReminders()
    }
    return NextResponse.json({ success: true, data: results })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── Contribution reminders ────────────────────────────────────
async function runContributionReminders(): Promise<number> {
  const now    = new Date()
  const today  = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const in3    = new Date(today); in3.setDate(today.getDate() + 3)
  let sent = 0

  // Get all active groups with their members
  const groups = await prisma.group.findMany({
    where:   { status: 'ACTIVE' },
    include: {
      members: {
        where:   { status: 'ACTIVE' },
        include: { user: { select: { id: true, fullName: true, email: true, phone: true } } },
      },
    },
  })

  for (const group of groups) {
    const day      = group.contributionDay || 1
    const dueDate  = new Date(now.getFullYear(), now.getMonth(), day)
    if (dueDate <= today) dueDate.setMonth(dueDate.getMonth() + 1)

    const daysUntil = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    const dueDateStr = dueDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })

    for (const member of group.members) {
      // Check if we already sent this reminder today (avoid duplicates)
      const alreadySent = await prisma.notification.count({
        where: {
          userId:    member.userId,
          createdAt: { gte: today },
          body:      { contains: group.name },
          channel:   'IN_APP',
        },
      })
      if (alreadySent > 0) continue

      let tmpl: { subject: string; body: string } | null = null

      if (daysUntil === 3) {
        tmpl = templates.contributionReminder3Day(
          member.user.fullName, group.name,
          Number(group.contributionAmount), group.currency, dueDateStr
        )
      } else if (daysUntil === 0) {
        tmpl = templates.contributionDueToday(
          member.user.fullName, group.name,
          Number(group.contributionAmount), group.currency
        )
      } else if (daysUntil < 0) {
        const daysLate = Math.abs(daysUntil)
        if (daysLate <= 7) { // Only remind for the first 7 days overdue
          tmpl = templates.contributionOverdue(
            member.user.fullName, group.name,
            Number(group.contributionAmount), group.currency, daysLate
          )
        }
      }

      if (tmpl) {
        await sendNotification({
          userId:   member.userId,
          type:     daysUntil === 0 ? 'CONTRIBUTION_REMINDER_DUE_TODAY'
                  : daysUntil > 0  ? 'CONTRIBUTION_REMINDER_3DAY'
                  : 'CONTRIBUTION_OVERDUE',
          subject:  tmpl.subject,
          body:     tmpl.body,
          channels: ['IN_APP', 'EMAIL', 'SMS'],
          metadata: { groupId: group.id, daysUntil, amount: Number(group.contributionAmount) },
        })
        sent++
      }
    }
  }

  return sent
}

// ── Queue status checks ───────────────────────────────────────
async function runQueueChecks(): Promise<number> {
  let sent = 0

  // Find entries that changed status recently (last 24h) — notify member
  const recentUpdates = await (prisma as any).assetQueueEntry.findMany({
    where: {
      updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      status:    { in: ['FUNDING', 'SOURCING', 'ORDERED', 'DELIVERED'] },
    },
    include: {
      user:  { select: { id: true, fullName: true } },
      asset: { select: { name: true } },
    },
  }).catch(() => [])

  for (const entry of recentUpdates as any[]) {
    // Check if we already notified for this status
    const alreadySent = await prisma.notification.count({
      where: {
        userId:    entry.userId,
        body:      { contains: entry.asset.name },
        metadata:  { path: ['status'], equals: entry.status },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    })
    if (alreadySent > 0) continue

    const tmpl = templates.queueAdvanced(
      entry.user.fullName, entry.asset.name, entry.position, entry.status
    )

    await sendNotification({
      userId:   entry.userId,
      type:     entry.status === 'DELIVERED' ? 'QUEUE_DELIVERED' : 'QUEUE_ADVANCED',
      subject:  tmpl.subject,
      body:     tmpl.body,
      channels: ['IN_APP', 'EMAIL'],
      metadata: { assetId: entry.assetId, status: entry.status, position: entry.position },
    })
    sent++
  }

  return sent
}

// ── Payout reminders ──────────────────────────────────────────
async function runPayoutReminders(): Promise<number> {
  let sent = 0
  const now     = new Date()
  const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  const upcomingPayouts = await (prisma as any).payoutSchedule.findMany({
    where: {
      status:        'SCHEDULED',
      scheduledDate: { gte: now, lte: in7days },
    },
    include: {
      cycle: {
        include: { group: { select: { name: true, currency: true } } },
      },
    },
  }).catch(() => [])

  for (const payout of upcomingPayouts as any[]) {
    const user = await prisma.user.findUnique({
      where:  { id: payout.recipientId },
      select: { id: true, fullName: true },
    })
    if (!user) continue

    const alreadySent = await prisma.notification.count({
      where: {
        userId:    payout.recipientId,
        metadata:  { path: ['payoutId'], equals: payout.id },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    })
    if (alreadySent > 0) continue

    const tmpl = templates.payoutReleased(
      user.fullName, payout.cycle.group.name,
      Number(payout.payoutAmount), payout.cycle.group.currency
    )

    await sendNotification({
      userId:   payout.recipientId,
      type:     'PAYOUT_SCHEDULED',
      subject:  `🏆 Your payout from ${payout.cycle.group.name} is scheduled in 7 days`,
      body:     `Hi ${user.fullName.split(' ')[0]},\n\nYour payout of ${payout.cycle.group.currency === 'USD' ? '$' : payout.cycle.group.currency}${Number(payout.payoutAmount).toFixed(2)} from ${payout.cycle.group.name} is scheduled for ${new Date(payout.scheduledDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.\n\nMake sure your payment details are up to date.`,
      channels: ['IN_APP', 'EMAIL'],
      metadata: { payoutId: payout.id, groupId: payout.cycle.groupId },
    })
    sent++
  }

  return sent
}
