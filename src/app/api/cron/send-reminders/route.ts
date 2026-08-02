// src/app/api/cron/send-reminders/route.ts
// Daily reminder sweep.
//
// Phase 4d. THIS IS WHAT UNBLOCKS PHASE 5 — the expiry sweep is only
// defensible once members have been warned.
//
// ── WHAT IT SENDS ────────────────────────────────────────────
//   Community Membership   T-30, T-7, T-1, expiry day, grace end
//   Group subscription     past_due, cancelled  → GROUP ADMIN ONLY
//
// ── SUPPRESSION ──────────────────────────────────────────────
// Entitlement is resolved at SEND time, so a member who renewed since
// the last run simply never gets the next reminder. Members exempt
// under rule 3b and staff are skipped entirely — reminding someone
// about a fee they are not being charged is worse than silence.
//
// ── IDEMPOTENCY ──────────────────────────────────────────────
// Every send carries a dedupeKey of the form
//   membership:<userId>:<templateId>:<expiryDate>:<milestone>
// backed by a unique index. Re-running the cron on the same day, or
// Vercel retrying a timeout, sends nothing twice.
//
// ── AUTH ─────────────────────────────────────────────────────
// Same pattern as expire-memberships: CRON_SECRET bearer, timing-safe.
// Requires '/api/cron' in API_PUBLIC in middleware.ts — the secret
// check below is the real gate.
//
// ── SCHEDULE (vercel.json) ───────────────────────────────────
//   { "crons": [
//       { "path": "/api/cron/send-reminders",     "schedule": "0 8 * * *" },
//       { "path": "/api/cron/expire-memberships", "schedule": "0 2 * * *" }
//   ] }
// Reminders run BEFORE the expiry sweep in the day, so nobody is
// expired in the morning and warned in the afternoon.

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'
import { notify, membershipTemplateFor } from '@/lib/notifications'
import { resolveEntitlement } from '@/lib/entitlement'
import { EXPIRY_GRACE_DAYS } from '@/lib/community-membership'

export const dynamic = 'force-dynamic'

/** Days before expiry that get a reminder. */
const MILESTONES = [30, 7, 1]

/** Safety ceiling per run, so one sweep cannot run away. */
const MAX_PER_RUN = 500

const CHANNELS = ['EMAIL', 'SMS', 'IN_APP'] as const

function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function authorise(req: NextRequest): NextResponse | null {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    console.error('cron/send-reminders: CRON_SECRET not set')
    return NextResponse.json({ success: false, error: 'Cron not configured' }, { status: 500 })
  }
  const header = req.headers.get('authorization') || ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!provided || !secretsMatch(provided, expected)) {
    return NextResponse.json({ success: false, error: 'Unauthorised' }, { status: 401 })
  }
  return null
}

type MembershipRow = {
  userId: string
  expiresAt: Date
  currency: string
  amountPaid: string | null
  autoRenew: boolean
  cancelAtPeriodEnd: boolean
  stripeSubscriptionId: string | null
  fullName: string | null
  email: string | null
  phone: string | null
}

/**
 * Memberships whose expiry falls exactly N days from today.
 *
 * Date-level comparison, not timestamp: a member expiring at 23:00 and
 * one expiring at 01:00 on the same day are both "7 days out". Anchored
 * to UTC so the boundary does not drift with server timezone.
 */
async function dueAt(days: number): Promise<MembershipRow[]> {
  return prisma.$queryRawUnsafe<MembershipRow[]>(
    `
    SELECT cm."userId", cm."expiresAt", cm."currency", cm."amountPaid",
           cm."autoRenew", cm."cancelAtPeriodEnd", cm."stripeSubscriptionId",
           u."fullName", u."email", u."phone"
    FROM "CommunityMembership" cm
    JOIN "User" u ON u.id = cm."userId" AND u."deletedAt" IS NULL
    WHERE cm."status" = 'ACTIVE'
      AND (cm."expiresAt" AT TIME ZONE 'UTC')::date
          = ((now() AT TIME ZONE 'UTC')::date + ($1::int))
    ORDER BY cm."expiresAt"
    LIMIT ${MAX_PER_RUN}
    `,
    days
  )
}

/** Memberships that lapsed exactly one grace period ago. */
async function graceEnding(): Promise<MembershipRow[]> {
  return prisma.$queryRawUnsafe<MembershipRow[]>(
    `
    SELECT cm."userId", cm."expiresAt", cm."currency", cm."amountPaid",
           cm."autoRenew", cm."cancelAtPeriodEnd", cm."stripeSubscriptionId",
           u."fullName", u."email", u."phone"
    FROM "CommunityMembership" cm
    JOIN "User" u ON u.id = cm."userId" AND u."deletedAt" IS NULL
    WHERE cm."status" IN ('ACTIVE', 'EXPIRED')
      AND (cm."expiresAt" AT TIME ZONE 'UTC')::date
          = ((now() AT TIME ZONE 'UTC')::date - ($1::int))
    ORDER BY cm."expiresAt"
    LIMIT ${MAX_PER_RUN}
    `,
    EXPIRY_GRACE_DAYS
  )
}

function isoDay(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10)
}

async function runMembershipReminders(): Promise<{ sent: number; suppressed: number; failed: number }> {
  let sent = 0, suppressed = 0, failed = 0

  const batches: { rows: MembershipRow[]; milestone: string; forceTemplate?: string }[] = []
  for (const d of MILESTONES) {
    batches.push({ rows: await dueAt(d), milestone: `T${d}` })
  }
  batches.push({ rows: await dueAt(0), milestone: 'T0' })
  batches.push({
    rows: await graceEnding(),
    milestone: 'GRACE_END',
    forceTemplate: 'membership_grace_ending',
  })

  for (const batch of batches) {
    for (const m of batch.rows) {
      try {
        // Resolved here, not when the batch was built — someone who
        // joined a group or renewed since the last run drops out.
        const ent = await resolveEntitlement(m.userId)
        if (ent.reasons.includes('STAFF_ROLE')) { suppressed++; continue }
        if (ent.qualifyingGroupIds.length > 0) { suppressed++; continue }

        const templateId =
          batch.forceTemplate ??
          membershipTemplateFor({
            autoRenew: m.autoRenew,
            cancelAtPeriodEnd: m.cancelAtPeriodEnd,
            stripeSubscriptionId: m.stripeSubscriptionId,
          })

        const res = await notify({
          userId: m.userId,
          templateId,
          dedupeKey: `membership:${m.userId}:${templateId}:${isoDay(m.expiresAt)}:${batch.milestone}`,
          channels: [...CHANNELS],
          email: m.email,
          phone: m.phone,
          data: {
            fullName: m.fullName,
            expiresAt: m.expiresAt,
            currency: m.currency,
            amount: m.amountPaid ? Number(m.amountPaid) : null,
          },
        })

        if (res.sent.length) sent++
        if (res.failed.length) failed++
      } catch (e: any) {
        failed++
        console.error('cron/send-reminders membership error:', m.userId, e?.message)
      }
    }
  }

  return { sent, suppressed, failed }
}

type GroupSubRow = {
  groupId: string
  groupName: string
  status: string
  adminUserId: string
  fullName: string | null
  email: string | null
  phone: string | null
}

/**
 * Group subscription problems — GROUP ADMIN ONLY.
 *
 * Members are deliberately not messaged. They cannot fix their group's
 * billing, and a mass email about someone else's card would cause more
 * alarm than it resolves. Members see the state in-app instead.
 */
async function runGroupSubscriptionNotices(): Promise<{ sent: number; failed: number }> {
  let sent = 0, failed = 0

  const rows = await prisma.$queryRawUnsafe<GroupSubRow[]>(
    `
    SELECT g."id" AS "groupId", g."name" AS "groupName",
           ps."status", g."adminUserId",
           u."fullName", u."email", u."phone"
    FROM "PlatformSubscription" ps
    JOIN "Group" g ON g.id = ps."groupId" AND g."deletedAt" IS NULL
    JOIN "User" u ON u.id = g."adminUserId" AND u."deletedAt" IS NULL
    WHERE ps."groupId" IS NOT NULL
      AND ps."status" IN ('past_due', 'canceled')
    LIMIT ${MAX_PER_RUN}
    `
  )

  for (const r of rows) {
    try {
      const templateId =
        r.status === 'past_due'
          ? 'group_subscription_past_due'
          : 'group_subscription_cancelled'

      // Keyed to the day, so a persistent past_due nudges once daily
      // rather than once ever — but never twice in a day.
      const day = new Date().toISOString().slice(0, 10)

      const res = await notify({
        userId: r.adminUserId,
        templateId,
        dedupeKey: `groupsub:${r.groupId}:${templateId}:${day}`,
        channels: [...CHANNELS],
        groupId: r.groupId,
        email: r.email,
        phone: r.phone,
        data: { fullName: r.fullName, groupName: r.groupName },
      })

      if (res.sent.length) sent++
      if (res.failed.length) failed++
    } catch (e: any) {
      failed++
      console.error('cron/send-reminders group error:', r.groupId, e?.message)
    }
  }

  return { sent, failed }
}

export async function GET(req: NextRequest) {
  const authErr = authorise(req)
  if (authErr) return authErr

  const started = Date.now()
  try {
    const membership = await runMembershipReminders()
    const groups = await runGroupSubscriptionNotices()

    // Logged unconditionally, including zeros — an absent log line means
    // the cron did not fire, which is different from a quiet day.
    console.log(
      `[cron] send-reminders: membership sent=${membership.sent} ` +
      `suppressed=${membership.suppressed} failed=${membership.failed}; ` +
      `groups sent=${groups.sent} failed=${groups.failed}; ` +
      `${Date.now() - started}ms`
    )

    return NextResponse.json({
      success: true,
      data: { membership, groups, ranAt: new Date().toISOString() },
    })
  } catch (e: any) {
    console.error('cron/send-reminders error:', e?.message)
    return NextResponse.json({ success: false, error: 'Reminder sweep failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  return GET(req)
}
