// src/lib/notifications/engine.ts
// Core notification engine — creates records, sends email/SMS.
//
// Version 2.0 — dedupe, group scoping, membership types.
//
// ── BACKWARDS COMPATIBLE ─────────────────────────────────────
// sendNotification() keeps its exact v1 signature and return shape.
// Every new field on NotificationPayload is optional, so existing
// callers compile and behave identically. Only two behaviours change,
// both bug fixes described below.
//
// ── WHAT CHANGED ─────────────────────────────────────────────
// 1. DEDUPE. v1 inserted unconditionally. A daily reminder cron plus
//    Vercel's retry-on-failure means the same member gets the same
//    "your membership expires" email twice. Supplying dedupeKey now
//    claims a row via a unique index; a second attempt returns
//    `deduped` and contacts nobody.
//
//    Callers that omit dedupeKey behave exactly as before.
//
// 2. NO MORE FALSE 'SENT'. v1's email and SMS senders returned quietly
//    when their API key was absent, and the caller then marked the
//    notification SENT. An unconfigured platform produced a database
//    full of delivered messages nobody received — and a reminder sweep
//    would report healthy numbers while sending nothing. They now
//    throw NotConfiguredError, so the row is marked FAILED with a
//    reason. Development still prints the message to the console.
//
// 3. groupId and templateId are persisted, so group-scoped notices can
//    be listed per group and dedupe keys stay readable.
//
// ── SMS CONFIGURATION ────────────────────────────────────────
// Standardised on AT_API_KEY / AT_USERNAME — used by this file and by
// /api/invitations. src/lib/notifications/sms.ts reads a different set
// (AFRICASTALKING_*) and is redundant; delete it once nothing imports
// it.
//
// AT_USERNAME=sandbox selects the sandbox endpoint, which is Africa's
// Talking' own convention.
//
// COVERAGE: Africa's Talking does not meaningfully cover Australia.
// AU numbers will need a second provider; until then SMS to +61 fails
// at the provider and is recorded as FAILED.

import prisma from '@/lib/prisma/client'

// ── Types ─────────────────────────────────────────────────────
export type NotificationType =
  | 'CONTRIBUTION_REMINDER_3DAY'
  | 'CONTRIBUTION_REMINDER_DUE_TODAY'
  | 'CONTRIBUTION_OVERDUE'
  | 'PAYOUT_RELEASED'
  | 'PAYOUT_SCHEDULED'
  | 'QUEUE_ADVANCED'
  | 'QUEUE_DELIVERED'
  | 'ASSET_FUNDED'
  | 'INVITATION_ACCEPTED'
  | 'KYC_APPROVED'
  | 'KYC_REJECTED'
  | 'ANNOUNCEMENT'
  | 'WELCOME'
  // Added v2 — Community Membership and group subscription lifecycle.
  | 'MEMBERSHIP_RENEWAL_AUTO'
  | 'MEMBERSHIP_ENDING'
  | 'MEMBERSHIP_ACTION_REQUIRED'
  | 'MEMBERSHIP_GRACE_ENDING'
  | 'GROUP_SUBSCRIPTION_PAST_DUE'
  | 'GROUP_SUBSCRIPTION_CANCELLED'

export type NotificationChannelName = 'EMAIL' | 'SMS' | 'IN_APP'

export interface NotificationPayload {
  userId:   string
  type:     NotificationType
  subject:  string
  body:     string
  html?:    string
  channels: NotificationChannelName[]
  metadata?: Record<string, any>

  // ── Added v2, all optional ──────────────────────────────────
  /**
   * Send-exactly-once key. Combined with the channel and enforced by a
   * unique index, so a re-run or a provider retry cannot double-send.
   * Omit for one-off, user-triggered messages.
   */
  dedupeKey?: string
  /** Group-scoped notices — powers per-group listing. */
  groupId?: string | null
  /** Overrides the stored template id. Defaults to `type`. */
  templateId?: string
  /** Skip the User lookup when the caller already has these. */
  email?: string | null
  phone?: string | null
  fullName?: string | null
  /** Per-channel body override. Falls back to `body`. */
  smsBody?: string
}

export class NotConfiguredError extends Error {
  constructor(channel: string, vars: string) {
    super(`${channel} is not configured. Set ${vars}.`)
    this.name = 'NotConfiguredError'
  }
}

export type SendResult = {
  sent: string[]
  failed: string[]
  /** True when at least one channel was suppressed as a duplicate. */
  deduped?: boolean
}

// ── Row creation ──────────────────────────────────────────────
// Raw SQL because dedupeKey and groupId are not in the Prisma model.
// Returns null when the dedupeKey has already been claimed.
async function createRow(
  payload: NotificationPayload,
  channel: NotificationChannelName,
  body: string
): Promise<string | null> {
  const templateId = payload.templateId || payload.type
  const dedupeKey = payload.dedupeKey ? `${payload.dedupeKey}:${channel}` : null

  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `
    INSERT INTO "Notification"
      ("id", "userId", "groupId", "channel", "status", "subject", "body",
       "templateId", "dedupeKey", "metadata", "createdAt")
    VALUES
      (gen_random_uuid()::text, $1, $2, $3::"NotificationChannel",
       'PENDING'::"NotificationStatus", $4, $5, $6, $7, $8::jsonb, now())
    ON CONFLICT ("dedupeKey") DO NOTHING
    RETURNING "id"
    `,
    payload.userId,
    payload.groupId ?? null,
    channel,
    payload.subject,
    body,
    templateId,
    dedupeKey,
    JSON.stringify(payload.metadata || {})
  )

  return rows?.[0]?.id ?? null
}

// ── Send a notification ───────────────────────────────────────
export async function sendNotification(payload: NotificationPayload): Promise<SendResult> {
  let recipient: { fullName: string | null; email: string | null; phone: string | null }

  // Use supplied contact details when the caller already loaded them —
  // a batch of 500 should not run 500 extra User queries.
  if (payload.email !== undefined || payload.phone !== undefined) {
    recipient = {
      fullName: payload.fullName ?? null,
      email: payload.email ?? null,
      phone: payload.phone ?? null,
    }
  } else {
    const user = await prisma.user.findUnique({
      where:  { id: payload.userId },
      select: { id: true, fullName: true, email: true, phone: true },
    })
    if (!user) return { sent: [], failed: ['user_not_found'] }
    recipient = { fullName: user.fullName, email: user.email, phone: user.phone }
  }

  const sent:   string[] = []
  const failed: string[] = []
  let deduped = false

  for (const channel of payload.channels) {
    // Skip channels with no destination rather than recording a failure
    // — a member with no phone number has not failed at anything.
    if (channel === 'EMAIL' && !recipient.email) continue
    if (channel === 'SMS' && !recipient.phone) continue

    const body = channel === 'SMS' ? (payload.smsBody || payload.body) : payload.body

    let notifId: string | null
    try {
      notifId = await createRow(payload, channel, body)
    } catch (e: any) {
      console.error(`Notification row failed for ${payload.userId}:`, e?.message)
      failed.push(channel)
      continue
    }

    // Already claimed on an earlier run. Silence is correct.
    if (!notifId) { deduped = true; continue }

    try {
      if (channel === 'EMAIL') {
        await sendEmail({
          to:      recipient.email as string,
          subject: payload.subject,
          html:    payload.html || textToHtml(payload.body, payload.subject),
          text:    payload.body,
        })
        await prisma.notification.update({
          where: { id: notifId },
          data:  { status: 'SENT', sentAt: new Date() },
        })
        sent.push('EMAIL')
      }

      else if (channel === 'SMS') {
        await sendSMS({ to: recipient.phone as string, message: body })
        await prisma.notification.update({
          where: { id: notifId },
          data:  { status: 'SENT', sentAt: new Date() },
        })
        sent.push('SMS')
      }

      else if (channel === 'IN_APP') {
        // Nothing to transmit — the row IS the delivery.
        await prisma.notification.update({
          where: { id: notifId },
          data:  { status: 'DELIVERED', sentAt: new Date(), deliveredAt: new Date() },
        })
        sent.push('IN_APP')
      }
    } catch (e: any) {
      console.error(`Notification ${channel} failed for user ${payload.userId}:`, e?.message)
      await prisma.notification.update({
        where: { id: notifId },
        data:  {
          status: 'FAILED',
          failedAt: new Date(),
          failReason: String(e?.message || 'send failed').slice(0, 500),
        },
      })
      failed.push(channel)
    }
  }

  return { sent, failed, deduped }
}

// ── Send to multiple users ────────────────────────────────────
export async function sendBulkNotifications(payloads: NotificationPayload[]) {
  const results = await Promise.allSettled(payloads.map(sendNotification))
  return results
}

// ── Email sender (Resend) ─────────────────────────────────────
async function sendEmail({ to, subject, html, text }: { to: string; subject: string; html: string; text: string }) {
  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey) {
    // v1 returned here and the caller marked the row SENT. Log for
    // development, then THROW so the row is recorded as FAILED — an
    // email nobody received must never read as delivered.
    console.log(`[DEV — no RESEND_API_KEY] Would send to ${to}: ${subject}\n${text}`)
    throw new NotConfiguredError('Email', 'RESEND_API_KEY')
  }

  const from = process.env.FROM_EMAIL || 'Windfall Community Deals <noreply@thecommunitydeals.com>'

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({} as any))
    throw new Error(err?.message || `Email provider error (${res.status})`)
  }
}

// ── SMS sender (Africa's Talking) ─────────────────────────────
async function sendSMS({ to, message }: { to: string; message: string }) {
  const apiKey   = process.env.AT_API_KEY
  const username = process.env.AT_USERNAME

  if (!apiKey || !username) {
    console.log(`[DEV] SMS not configured. Would send to ${to}: ${message}`)
    throw new NotConfiguredError('SMS', 'AT_API_KEY and AT_USERNAME')
  }

  // Africa's Talking' own convention: the sandbox account is literally
  // named "sandbox".
  const isSandbox = username === 'sandbox'
  const baseUrl   = isSandbox
    ? 'https://api.sandbox.africastalking.com'
    : 'https://api.africastalking.com'

  const res = await fetch(`${baseUrl}/version1/messaging`, {
    method:  'POST',
    headers: { 'apiKey': apiKey, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body:    new URLSearchParams({ username, to, message }).toString(),
  })

  if (!res.ok) throw new Error(`SMS API error: ${await res.text()}`)
}

// ── Email HTML wrapper ────────────────────────────────────────
export function textToHtml(body: string, title: string): string {
  const TEAL = '#0F6E56'; const NAVY = '#0D2137'
  const lines = body.split('\n').map(l =>
    l.trim() ? `<p style="margin:0 0 10px;font-size:14px;color:#374151;line-height:1.6">${l}</p>` : '<br>'
  ).join('')

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:system-ui,sans-serif">
  <div style="max-width:560px;margin:40px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,${NAVY},${TEAL});padding:28px 36px;text-align:center">
      <div style="font-size:24px;margin-bottom:6px">🔄</div>
      <h1 style="color:white;font-size:18px;font-weight:700;margin:0">${title}</h1>
    </div>
    <div style="padding:28px 36px">${lines}</div>
    <div style="background:#F8FAFC;padding:16px 36px;border-top:1px solid #E2E8F0;text-align:center">
      <p style="font-size:11px;color:#94A3B8;margin:0">Windfall Community Deals · You're receiving this because you're a member.</p>
    </div>
  </div>
</body></html>`
}

// ── Notification template builders ───────────────────────────
export const templates = {

  contributionReminder3Day(member: string, group: string, amount: number, currency: string, dueDate: string) {
    const curr = currency === 'USD' ? '$' : currency
    return {
      subject: `Reminder: Your ${group} contribution of ${curr}${amount} is due in 3 days`,
      body: `Hi ${member.split(' ')[0]},\n\nThis is a friendly reminder that your monthly contribution of ${curr}${amount} to ${group} is due on ${dueDate}.\n\nPlease ensure funds are available to avoid late penalties.\n\nThank you for being a valued member.`,
    }
  },

  contributionDueToday(member: string, group: string, amount: number, currency: string) {
    const curr = currency === 'USD' ? '$' : currency
    return {
      subject: `⚠️ Your ${group} contribution of ${curr}${amount} is due TODAY`,
      body: `Hi ${member.split(' ')[0]},\n\nYour monthly contribution of ${curr}${amount} to ${group} is due today.\n\nPlease make your payment immediately to avoid late fees.\n\nThank you.`,
    }
  },

  contributionOverdue(member: string, group: string, amount: number, currency: string, daysLate: number) {
    const curr = currency === 'USD' ? '$' : currency
    return {
      subject: `❌ OVERDUE: Your ${group} contribution is ${daysLate} day${daysLate !== 1 ? 's' : ''} late`,
      body: `Hi ${member.split(' ')[0]},\n\nYour contribution of ${curr}${amount} to ${group} is now ${daysLate} day${daysLate !== 1 ? 's' : ''} overdue.\n\nLate fees may apply as per the group rules. Please make your payment immediately.\n\nIf you're experiencing difficulties, please contact your group administrator.`,
    }
  },

  payoutReleased(member: string, group: string, amount: number, currency: string) {
    const curr = currency === 'USD' ? '$' : currency
    return {
      subject: `🎉 Your payout of ${curr}${amount} from ${group} has been released!`,
      body: `Hi ${member.split(' ')[0]},\n\nGreat news! Your payout of ${curr}${amount} from ${group} has been released and is on its way to you.\n\nPlease check your registered payment method for the funds.\n\nCongratulations!`,
    }
  },

  queueAdvanced(member: string, asset: string, position: number, status: string) {
    const statusMsg: Record<string, string> = {
      FUNDING:   'is now in the funding stage. Members are contributing towards your unit.',
      SOURCING:  'is fully funded! We are now sourcing your unit.',
      ORDERED:   'has been ordered. Your unit is on its way.',
      DELIVERED: 'has been delivered to you! Please check your handover certificate.',
    }
    return {
      subject: `📦 Update on your ${asset} — ${status.replace('_', ' ')}`,
      body: `Hi ${member.split(' ')[0]},\n\nYour Round Robin position (#${position}) for ${asset} ${statusMsg[status] || `has been updated to ${status}.`}\n\nLog in to your member portal to view the latest details.`,
    }
  },

  welcome(member: string, group: string, contribution: number, currency: string) {
    const curr = currency === 'USD' ? '$' : currency
    return {
      subject: `Welcome to ${group} on Windfall Community Deals! 🎉`,
      body: `Hi ${member.split(' ')[0]},\n\nWelcome to ${group}! You're now an official member.\n\nYour monthly contribution is ${curr}${contribution}. Your first payment will be collected on the group's regular collection date.\n\nLog in to your member portal to track your contributions, payout position, and more.\n\nWe're glad to have you!`,
    }
  },

  announcement(member: string, group: string, title: string, message: string) {
    return {
      subject: `📢 ${group}: ${title}`,
      body: `Hi ${member.split(' ')[0]},\n\n${message}\n\n— ${group} Administration`,
    }
  },
}
