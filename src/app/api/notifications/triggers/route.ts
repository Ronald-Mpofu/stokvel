// src/app/api/notifications/triggers/route.ts
// Scans for due/overdue contributions, queue changes and upcoming
// payouts, and sends reminders. Called by a cron.
//
// Version 2.0 — security + a dead branch fixed.
//
// ── WHAT v1 DID ──────────────────────────────────────────────
// 1. CRON_SECRET fell back to the literal 'stokvel-cron-2025', which is
//    in git history. With the env var unset, anyone knowing that string
//    could fire the whole sweep.
//
// 2. GET had NO authentication — the comment said "allow GET for manual
//    testing". Any authenticated user could call ?trigger=ALL and send
//    email AND SMS to every member of every active group. Africa's
//    Talking bills per message, so that is uncapped spend, not just
//    noise.
//
// 3. The comparison was a plain !==, which leaks the secret through
//    response timing.
//
// 4. OVERDUE REMINDERS NEVER FIRED. dueDate is rolled forward a month
//    whenever it is not in the future, BEFORE daysUntil is computed —
//    so daysUntil could never be negative and the `daysUntil < 0`
//    branch was unreachable. Overdue members were never chased.
//
// 5. Duplicate suppression used `body contains <group name>`, an
//    unindexed LIKE scan that also mis-fires whenever two groups share
//    a word. Replaced with dedupeKey, enforced by a unique index.
//
// ── RELATIONSHIP TO /api/cron/send-reminders ─────────────────
// Deliberately separate. This one is about GROUP activity — money owed
// between members. send-reminders is about PLATFORM billing — the
// Community Membership and group subscription. Different owners,
// different failure modes, and keeping them apart means a bug in one
// cannot silence the other.

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'
import { sendNotification, templates } from '@/lib/notifications/engine'

export const dynamic = 'force-dynamic'

function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Same gate for GET and POST. No development bypass: a route that
 * spends money on SMS does not get a convenience lane.
 */
function authorise(req: NextRequest): NextResponse | null {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    console.error('notifications/triggers: CRON_SECRET not set')
    return NextResponse.json({ success: false, error: 'Cron not configured' }, { status: 500 })
  }
  const header = req.headers.get('authorization') || ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!provided || !secretsMatch(provided, expected)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

async function runTriggers(trigger: string) {
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
  return results
}

export async function POST(req: NextRequest) {
  const authErr = authorise(req)
  if (authErr) return authErr
  try {
    const body = await req.json().catch(() => ({} as any))
    const results = await runTriggers(body?.trigger || 'ALL')
    console.log('[cron] notification triggers:', JSON.stringify(results))
    return NextResponse.json({ success: true, data: results })
  } catch (e: any) {
    console.error('POST /api/notifications/triggers error:', e?.message)
    return NextResponse.json({ success: false, error: 'Trigger run failed' }, { status: 500 })
  }
}

// GET is kept for manual runs but is NO LONGER open — same secret.
export async function GET(req: NextRequest) {
  const authErr = authorise(req)
  if (authErr) return authErr
  try {
    const { searchParams } = new URL(req.url)
    const results = await runTriggers(searchParams.get('trigger') || 'ALL')
    console.log('[cron] notification triggers (GET):', JSON.stringify(results))
    return NextResponse.json({ success: true, data: results })
  } catch (e: any) {
    console.error('GET /api/notifications/triggers error:', e?.message)
    return NextResponse.json({ success: false, error: 'Trigger run failed' }, { status: 500 })
  }
}

/** UTC day stamp — the dedupe granularity for daily reminders. */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

// ── Contribution reminders ────────────────────────────────────
async function runContributionReminders(): Promise<number> {
  const now = new Date()
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const day = today()
  let sent = 0

  const groups = await prisma.group.findMany({
    where:   { status: 'ACTIVE', deletedAt: null },
    include: {
      members: {
        where:   { status: 'ACTIVE' },
        include: { user: { select: { id: true, fullName: true, email: true, phone: true } } },
      },
    },
  })

  for (const group of groups) {
    const contribDay = group.contributionDay || 1

    // BUG FIX: v1 rolled dueDate into next month whenever it was not in
    // the future, then computed daysUntil from that — so the value was
    // never negative and overdue members were never chased.
    //
    // THIS month's due date is now evaluated as-is. Only when it is more
    // than a week past do we look ahead to next month, which keeps the
    // overdue window meaningful without chasing people forever.
    const thisMonthDue = new Date(now.getFullYear(), now.getMonth(), contribDay)
    const daysSinceDue = Math.round(
      (midnight.getTime() - thisMonthDue.getTime()) / 86_400_000
    )

    let dueDate: Date
    let daysUntil: number
    if (daysSinceDue > 7) {
      // Far enough past that this month is settled — look forward.
      dueDate = new Date(now.getFullYear(), now.getMonth() + 1, contribDay)
      daysUntil = Math.round((dueDate.getTime() - midnight.getTime()) / 86_400_000)
    } else {
      dueDate = thisMonthDue
      daysUntil = -daysSinceDue
    }

    const dueDateStr = dueDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })

    for (const member of group.members) {
      let tmpl: { subject: string; body: string } | null = null
      let type: any = null
      let milestone = ''

      if (daysUntil === 3) {
        tmpl = templates.contributionReminder3Day(
          member.user.fullName, group.name,
          Number(group.contributionAmount), group.currency, dueDateStr
        )
        type = 'CONTRIBUTION_REMINDER_3DAY'
        milestone = 'T3'
      } else if (daysUntil === 0) {
        tmpl = templates.contributionDueToday(
          member.user.fullName, group.name,
          Number(group.contributionAmount), group.currency
        )
        type = 'CONTRIBUTION_REMINDER_DUE_TODAY'
        milestone = 'T0'
      } else if (daysUntil < 0) {
        const daysLate = Math.abs(daysUntil)
        if (daysLate <= 7) {
          tmpl = templates.contributionOverdue(
            member.user.fullName, group.name,
            Number(group.contributionAmount), group.currency, daysLate
          )
          type = 'CONTRIBUTION_OVERDUE'
          milestone = `LATE${daysLate}`
        }
      }

      if (!tmpl) continue

      // Replaces v1's `body contains <group name>` LIKE scan. Enforced
      // by a unique index, so a re-run sends nothing twice.
      const res = await sendNotification({
        userId:   member.userId,
        type,
        subject:  tmpl.subject,
        body:     tmpl.body,
        channels: ['IN_APP', 'EMAIL', 'SMS'],
        groupId:  group.id,
        dedupeKey: `contribution:${group.id}:${member.userId}:${milestone}:${day}`,
        email:    member.user.email,
        phone:    member.user.phone,
        fullName: member.user.fullName,
        metadata: { groupId: group.id, daysUntil, amount: Number(group.contributionAmount) },
      })
      if (res.sent.length) sent++
    }
  }

  return sent
}

// ── Queue status checks ───────────────────────────────────────
async function runQueueChecks(): Promise<number> {
  let sent = 0

  const recentUpdates = await (prisma as any).assetQueueEntry.findMany({
    where: {
      updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      status:    { in: ['FUNDING', 'SOURCING', 'ORDERED', 'DELIVERED'] },
    },
    include: {
      user:  { select: { id: true, fullName: true, email: true, phone: true } },
      asset: { select: { name: true } },
    },
  }).catch(() => [])

  for (const entry of recentUpdates as any[]) {
    const tmpl = templates.queueAdvanced(
      entry.user.fullName, entry.asset.name, entry.position, entry.status
    )

    // Keyed to the entry AND its status, so each stage notifies exactly
    // once no matter how often the sweep runs.
    const res = await sendNotification({
      userId:   entry.userId,
      type:     entry.status === 'DELIVERED' ? 'QUEUE_DELIVERED' : 'QUEUE_ADVANCED',
      subject:  tmpl.subject,
      body:     tmpl.body,
      channels: ['IN_APP', 'EMAIL'],
      dedupeKey: `queue:${entry.id}:${entry.status}`,
      email:    entry.user.email,
      phone:    entry.user.phone,
      fullName: entry.user.fullName,
      metadata: { assetId: entry.assetId, status: entry.status, position: entry.position },
    })
    if (res.sent.length) sent++
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
      cycle: { include: { group: { select: { name: true, currency: true } } } },
    },
  }).catch(() => [])

  for (const payout of upcomingPayouts as any[]) {
    const user = await prisma.user.findUnique({
      where:  { id: payout.recipientId },
      select: { id: true, fullName: true, email: true, phone: true },
    })
    if (!user) continue

    const symbol = payout.cycle.group.currency === 'USD' ? '$' : payout.cycle.group.currency
    const amount = Number(payout.payoutAmount).toFixed(2)
    const when = new Date(payout.scheduledDate).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric',
    })

    // v1 built a templates.payoutReleased() here and then discarded it,
    // inlining the text below. The dead call is removed — and
    // payoutReleased was the wrong template anyway: this payout is
    // SCHEDULED, not released, so telling a member their money was on
    // its way a week early would have been actively misleading.
    const res = await sendNotification({
      userId:   payout.recipientId,
      type:     'PAYOUT_SCHEDULED',
      subject:  `🏆 Your payout from ${payout.cycle.group.name} is scheduled in 7 days`,
      body:
        `Hi ${user.fullName.split(' ')[0]},\n\n` +
        `Your payout of ${symbol}${amount} from ${payout.cycle.group.name} is scheduled ` +
        `for ${when}.\n\nMake sure your payment details are up to date.`,
      channels: ['IN_APP', 'EMAIL'],
      groupId:  payout.cycle.groupId,
      dedupeKey: `payout-scheduled:${payout.id}`,
      email:    user.email,
      phone:    user.phone,
      fullName: user.fullName,
      metadata: { payoutId: payout.id, groupId: payout.cycle.groupId },
    })
    if (res.sent.length) sent++
  }

  return sent
}
