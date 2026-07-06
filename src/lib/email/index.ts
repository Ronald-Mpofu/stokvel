// src/lib/email/index.ts
// Central email utility — Resend + branded templates for thecommunitydeals.com

const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL     = process.env.FROM_EMAIL || 'Windfall Community Deals <noreply@thecommunitydeals.com>'
const APP_URL        = process.env.NEXT_PUBLIC_APP_URL || 'https://www.thecommunitydeals.com'

type SendResult = { success: boolean; error?: string; id?: string }

// ── Core send function ────────────────────────────────────────
export async function sendEmail(opts: {
  to: string
  subject: string
  html: string
  text?: string
}): Promise<SendResult> {
  if (!RESEND_API_KEY) {
    console.log(`[EMAIL SKIPPED — no RESEND_API_KEY] To: ${opts.to} | Subject: ${opts.subject}`)
    return { success: false, error: 'Email provider not configured (RESEND_API_KEY missing)' }
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from:    FROM_EMAIL,
        to:      [opts.to],
        subject: opts.subject,
        html:    opts.html,
        text:    opts.text || opts.html.replace(/<[^>]+>/g, ''),
      }),
    })

    const data = await res.json()
    if (!res.ok) {
      console.error('Resend error:', data)
      return { success: false, error: data?.message || 'Email send failed' }
    }
    return { success: true, id: data.id }
  } catch (e: any) {
    console.error('Email network error:', e)
    return { success: false, error: e.message }
  }
}

// ── Branded HTML wrapper ──────────────────────────────────────
function wrap(bodyHtml: string): string {
  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px">

    <!-- Header -->
    <div style="background:#0D2137;border-radius:14px 14px 0 0;padding:28px 24px;text-align:center">
      <div style="font-size:32px;margin-bottom:8px">🔄</div>
      <h1 style="color:#ffffff;font-size:20px;margin:0;font-weight:700">Windfall Community Deals</h1>
      <p style="color:#9FE1CB;font-size:12px;margin:6px 0 0">Your community. Your savings. Your future.</p>
    </div>

    <!-- Body -->
    <div style="background:#ffffff;padding:32px 28px;border:1px solid #E2E8F0;border-top:none">
      ${bodyHtml}
    </div>

    <!-- Footer -->
    <div style="background:#F1F5F9;border-radius:0 0 14px 14px;padding:18px 24px;text-align:center;border:1px solid #E2E8F0;border-top:none">
      <p style="color:#94A3B8;font-size:11px;margin:0;line-height:1.6">
        Windfall Community Deals · <a href="${APP_URL}" style="color:#0F6E56;text-decoration:none">thecommunitydeals.com</a><br/>
        This email was sent to you by a group administrator. If you weren't expecting it, you can safely ignore it.
      </p>
    </div>

  </div>
</body>
</html>`
}

// ── Invitation email ──────────────────────────────────────────
export async function sendInvitationEmail(opts: {
  to: string
  inviteeName?: string
  inviterName: string
  groupName: string
  contributionAmount: number
  currency: string
  token: string
  expiresAt?: Date
}): Promise<SendResult> {
  const inviteUrl = `${APP_URL}/invite/${opts.token}`
  const greeting  = opts.inviteeName ? `Dear ${opts.inviteeName},` : 'Hello,'
  const expiryNote = opts.expiresAt
    ? `<p style="color:#94A3B8;font-size:12px;margin:16px 0 0">This invitation expires on ${opts.expiresAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.</p>`
    : ''

  const html = wrap(`
    <h2 style="color:#0D2137;font-size:18px;margin:0 0 16px">You're invited to join ${opts.groupName} 🎉</h2>
    <p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 12px">${greeting}</p>
    <p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 20px">
      <strong>${opts.inviterName}</strong> has invited you to join
      <strong>${opts.groupName}</strong> on Windfall Community Deals —
      a secure platform for community savings, group loans, and collective asset ownership.
    </p>

    <!-- Group summary card -->
    <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:16px 20px;margin:0 0 24px">
      <table style="width:100%;font-size:13px;color:#166534">
        <tr><td style="padding:4px 0;color:#64748B">Group</td><td style="padding:4px 0;font-weight:600;text-align:right">${opts.groupName}</td></tr>
        <tr><td style="padding:4px 0;color:#64748B">Contribution</td><td style="padding:4px 0;font-weight:600;text-align:right">${opts.currency} ${opts.contributionAmount.toLocaleString()} / cycle</td></tr>
        <tr><td style="padding:4px 0;color:#64748B">Invited by</td><td style="padding:4px 0;font-weight:600;text-align:right">${opts.inviterName}</td></tr>
      </table>
    </div>

    <!-- CTA button -->
    <div style="text-align:center;margin:0 0 8px">
      <a href="${inviteUrl}"
        style="display:inline-block;padding:14px 36px;background:#0F6E56;color:#ffffff;text-decoration:none;border-radius:10px;font-size:15px;font-weight:600">
        Accept Invitation →
      </a>
    </div>
    <p style="color:#94A3B8;font-size:12px;text-align:center;margin:12px 0 0">
      Or copy this link into your browser:<br/>
      <a href="${inviteUrl}" style="color:#0F6E56;word-break:break-all">${inviteUrl}</a>
    </p>
    ${expiryNote}
  `)

  return sendEmail({
    to:      opts.to,
    subject: `${opts.inviterName} invited you to join ${opts.groupName} on Windfall`,
    html,
  })
}

// ── Welcome email (after invitation accepted) ─────────────────
export async function sendWelcomeEmail(opts: {
  to: string
  fullName: string
  groupName: string
}): Promise<SendResult> {
  const html = wrap(`
    <h2 style="color:#0D2137;font-size:18px;margin:0 0 16px">Welcome to ${opts.groupName}! 🎉</h2>
    <p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 12px">Dear ${opts.fullName},</p>
    <p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 20px">
      Your membership in <strong>${opts.groupName}</strong> is confirmed.
      You can now access your Member Portal to view your contributions,
      payout position, and group activity.
    </p>
    <div style="text-align:center;margin:0 0 8px">
      <a href="${APP_URL}/portal"
        style="display:inline-block;padding:14px 36px;background:#0F6E56;color:#ffffff;text-decoration:none;border-radius:10px;font-size:15px;font-weight:600">
        Open Member Portal →
      </a>
    </div>
  `)

  return sendEmail({
    to:      opts.to,
    subject: `Welcome to ${opts.groupName} — you're in! 🎉`,
    html,
  })
}
