// src/lib/notifications/index.ts
// Community Membership and group subscription messaging.
//
// Phase 4c.
//
// ── RELATIONSHIP TO engine.ts ────────────────────────────────
// This is a THIN layer. engine.ts owns transport, the Notification
// row, dedupe, the branded HTML wrapper and retry state. Nothing here
// talks to Resend or Africa's Talking directly — that would be a second
// transport to keep in sync, which is how the platform ended up with
// two SMS senders reading different environment variables.
//
// This module owns exactly one thing: what a membership message SAYS.
//
// ── THE THREE VOICES ─────────────────────────────────────────
// Most members are on a Stripe subscription with auto-renew, so they
// are not being ASKED to do anything — Stripe charges the card. Telling
// them to "renew now" is wrong and generates support tickets. The
// template is therefore chosen from membership STATE, not from the
// calendar:
//
//   AUTO_RENEW  informational — "renews on X for Y, nothing to do"
//   ENDING      neutral       — "access ends X, restart any time"
//   ACTION      the only real call to action — no subscription on file,
//                               so a human has to actually pay
//
// ── DEDUPE ───────────────────────────────────────────────────
// Every caller MUST supply a dedupeKey. The reminder cron runs daily
// and Vercel retries failures, so "send exactly once" cannot depend on
// the cron running exactly once. The unique index behind dedupeKey is
// what actually guarantees it.

import { sendNotification, type NotificationType } from './engine'

export type Channel = 'EMAIL' | 'SMS' | 'IN_APP'

export type NotifyInput = {
  userId: string
  templateId: string
  /** Must be unique for this exact message. See module note. */
  dedupeKey: string
  channels: Channel[]
  data: Record<string, any>
  groupId?: string | null
  /** Supplied by batch callers to avoid a User lookup per recipient. */
  email?: string | null
  phone?: string | null
}

export type NotifyResult = {
  sent: Channel[]
  skipped: Channel[]
  failed: { channel: Channel; error: string }[]
  deduped: boolean
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

function money(currency: string, amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return ''
  return `${currency} ${Number(amount).toFixed(2)}`
}

function dateLong(iso: string | Date | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

/**
 * Choose the variant from membership state.
 *
 * The calendar decides WHEN a reminder goes out; this decides WHAT it
 * says. A member whose card renews automatically must never be told to
 * take action.
 */
export function membershipTemplateFor(m: {
  autoRenew: boolean
  cancelAtPeriodEnd: boolean
  stripeSubscriptionId: string | null
}): 'membership_renewal_auto' | 'membership_ending' | 'membership_action_required' {
  if (m.cancelAtPeriodEnd || !m.autoRenew) return 'membership_ending'
  if (m.stripeSubscriptionId) return 'membership_renewal_auto'
  // No subscription on file — bank transfer or mobile money. A human
  // has to actually pay, so this is the one real call to action.
  return 'membership_action_required'
}

/** Maps a template id onto the engine's NotificationType. */
const TYPE_FOR: Record<string, NotificationType> = {
  membership_renewal_auto:      'MEMBERSHIP_RENEWAL_AUTO',
  membership_ending:            'MEMBERSHIP_ENDING',
  membership_action_required:   'MEMBERSHIP_ACTION_REQUIRED',
  membership_grace_ending:      'MEMBERSHIP_GRACE_ENDING',
  group_subscription_past_due:  'GROUP_SUBSCRIPTION_PAST_DUE',
  group_subscription_cancelled: 'GROUP_SUBSCRIPTION_CANCELLED',
}

export type Rendered = { subject: string; body: string; smsBody: string }

/**
 * Templates as functions, not database rows: they need the conditional
 * logic above, and a template table would push that into strings where
 * it cannot be reviewed or tested.
 */
export function render(templateId: string, d: Record<string, any>): Rendered {
  const name = String(d.fullName || 'there').split(' ')[0]
  const when = dateLong(d.expiresAt)
  const amount = money(d.currency || 'USD', d.amount)
  const membershipUrl = `${APP_URL}/dashboard/membership`
  const payUrl = `${APP_URL}/dashboard/join-fee`
  const groupsUrl = `${APP_URL}/dashboard/groups`
  const g = d.groupName || 'your group'

  switch (templateId) {
    case 'membership_renewal_auto':
      return {
        subject: `Your Community Membership renews on ${when}`,
        body:
          `Hi ${name},\n\n` +
          `Your Windfall Community Membership renews automatically on ${when}` +
          (amount ? ` for ${amount}` : '') + `.\n\n` +
          `You don't need to do anything — we'll charge the card you have on file.\n\n` +
          `If you'd rather it didn't renew, you can turn that off any time before then:\n` +
          `${membershipUrl}`,
        smsBody:
          `Windfall: your Community Membership renews automatically on ${when}` +
          (amount ? ` for ${amount}` : '') + `. No action needed.`,
      }

    case 'membership_ending':
      return {
        subject: `Your Community Membership ends on ${when}`,
        body:
          `Hi ${name},\n\n` +
          `Your Windfall Community Membership is set to end on ${when} and won't renew.\n\n` +
          `You keep full access and can still see groups advertising for new members right ` +
          `up until then — nothing changes before that date.\n\n` +
          `Changed your mind? You can restart it any time before ${when}:\n${membershipUrl}`,
        smsBody:
          `Windfall: your Community Membership ends ${when}. You keep access until then. ` +
          `Restart: ${membershipUrl}`,
      }

    case 'membership_action_required':
      return {
        subject: `Action needed: your Community Membership expires on ${when}`,
        body:
          `Hi ${name},\n\n` +
          `Your Windfall Community Membership expires on ${when}, and there's no automatic ` +
          `payment set up on your account.\n\n` +
          `To keep seeing groups advertising for new members, renew here:\n${payUrl}\n\n` +
          `If it lapses you'll still see your own records and statements — you just won't be ` +
          `able to make new contributions or see group adverts until it's renewed.`,
        smsBody:
          `Windfall: your Community Membership expires ${when}. Renew to keep access: ${payUrl}`,
      }

    case 'membership_grace_ending':
      return {
        subject: `Your Community Membership has expired`,
        body:
          `Hi ${name},\n\n` +
          `Your Windfall Community Membership expired on ${when}.\n\n` +
          `You can still sign in and see everything about your own money — contributions, ` +
          `stakes, loan balances and statements are all still there. What's paused is making ` +
          `new contributions and seeing groups advertising for members.\n\n` +
          `Renew whenever you're ready:\n${payUrl}`,
        smsBody:
          `Windfall: your Community Membership expired ${when}. Your records are safe. ` +
          `Renew: ${payUrl}`,
      }

    case 'group_subscription_past_due':
      return {
        subject: `Payment issue on ${g}`,
        body:
          `Hi ${name},\n\n` +
          `The monthly subscription payment for ${g} didn't go through.\n\n` +
          `We'll retry automatically over the next two weeks, so this often resolves itself. ` +
          `If the card has changed, updating it now avoids any interruption for your members.\n\n` +
          `${groupsUrl}`,
        smsBody:
          `Windfall: the subscription payment for ${g} failed. We'll retry — you may want to ` +
          `check the card: ${groupsUrl}`,
      }

    case 'group_subscription_cancelled':
      return {
        subject: `${g} has been paused`,
        body:
          `Hi ${name},\n\n` +
          `The subscription for ${g} has ended, so the group is now paused.\n\n` +
          `Nothing has been deleted. All contributions, loans, stakes and history are intact, ` +
          `and members can still see their own records. What's paused is new activity.\n\n` +
          `Reactivating takes one payment:\n${groupsUrl}`,
        smsBody:
          `Windfall: ${g} is paused because its subscription ended. No data lost. ` +
          `Reactivate: ${groupsUrl}`,
      }

    default:
      return {
        subject: d.subject || 'Windfall Community Deals',
        body: d.body || '',
        smsBody: d.body || '',
      }
  }
}

/**
 * Send one membership or subscription notification.
 *
 * Never throws — one bad address must not abort a batch of 500.
 * Delegates transport, dedupe and row state to engine.sendNotification.
 */
export async function notify(input: NotifyInput): Promise<NotifyResult> {
  const result: NotifyResult = { sent: [], skipped: [], failed: [], deduped: false }

  try {
    const r = render(input.templateId, input.data)

    const res = await sendNotification({
      userId: input.userId,
      type: TYPE_FOR[input.templateId] || 'ANNOUNCEMENT',
      templateId: input.templateId,
      subject: r.subject,
      body: r.body,
      smsBody: r.smsBody,
      channels: input.channels,
      dedupeKey: input.dedupeKey,
      groupId: input.groupId ?? null,
      email: input.email,
      phone: input.phone,
      fullName: input.data?.fullName ?? null,
      metadata: input.data || {},
    })

    result.sent = res.sent as Channel[]
    result.deduped = !!res.deduped
    result.failed = (res.failed || []).map(c => ({
      channel: c as Channel,
      error: 'send failed — see Notification.failReason',
    }))
    result.skipped = input.channels.filter(
      c => !result.sent.includes(c) && !result.failed.some(f => f.channel === c)
    )
  } catch (e: any) {
    console.error('notify error:', input.templateId, e?.message)
    result.failed = input.channels.map(c => ({ channel: c, error: e?.message || 'notify failed' }))
  }

  return result
}

// Re-exported so callers need only one import.
export { sendNotification, textToHtml, templates } from './engine'
export type { NotificationType, NotificationPayload } from './engine'
