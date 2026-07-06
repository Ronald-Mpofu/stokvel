// src/lib/notifications/engine.ts
// Core notification engine — creates records, sends email/SMS

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

export interface NotificationPayload {
  userId:   string
  type:     NotificationType
  subject:  string
  body:     string
  html?:    string
  channels: ('EMAIL' | 'SMS' | 'IN_APP')[]
  metadata?: Record<string, any>
}

// ── Send a notification ───────────────────────────────────────
export async function sendNotification(payload: NotificationPayload): Promise<{ sent: string[]; failed: string[] }> {
  const user = await prisma.user.findUnique({
    where:  { id: payload.userId },
    select: { id: true, fullName: true, email: true, phone: true },
  })
  if (!user) return { sent: [], failed: ['user_not_found'] }

  const sent:   string[] = []
  const failed: string[] = []

  for (const channel of payload.channels) {
    // Create notification record
    const notif = await prisma.notification.create({
      data: {
        userId:     payload.userId,
        channel:    channel as any,
        status:     'PENDING',
        subject:    payload.subject,
        body:       payload.body,
        metadata:   payload.metadata || {},
      },
    })

    try {
      if (channel === 'EMAIL' && user.email) {
        await sendEmail({
          to:      user.email,
          subject: payload.subject,
          html:    payload.html || textToHtml(payload.body, payload.subject),
          text:    payload.body,
        })
        await prisma.notification.update({
          where: { id: notif.id },
          data:  { status: 'SENT', sentAt: new Date() },
        })
        sent.push('EMAIL')
      }

      else if (channel === 'SMS' && user.phone) {
        await sendSMS({ to: user.phone, message: payload.body })
        await prisma.notification.update({
          where: { id: notif.id },
          data:  { status: 'SENT', sentAt: new Date() },
        })
        sent.push('SMS')
      }

      else if (channel === 'IN_APP') {
        // IN_APP is just stored in the DB — already created above
        await prisma.notification.update({
          where: { id: notif.id },
          data:  { status: 'DELIVERED', sentAt: new Date(), deliveredAt: new Date() },
        })
        sent.push('IN_APP')
      }
    } catch (e: any) {
      console.error(`Notification ${channel} failed for user ${payload.userId}:`, e.message)
      await prisma.notification.update({
        where: { id: notif.id },
        data:  { status: 'FAILED', failedAt: new Date(), failReason: e.message },
      })
      failed.push(channel)
    }
  }

  return { sent, failed }
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
    console.log(`[DEV — no RESEND_API_KEY] Email not configured. Would send to ${to}: ${subject}`)
    return
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

// ── SMS sender ────────────────────────────────────────────────
async function sendSMS({ to, message }: { to: string; message: string }) {
  const apiKey   = process.env.AT_API_KEY
  const username = process.env.AT_USERNAME

  if (!apiKey || !username) {
    console.log(`[DEV] SMS not configured. Would send to ${to}: ${message}`)
    return
  }

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
