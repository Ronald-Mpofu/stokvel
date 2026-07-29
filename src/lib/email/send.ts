// src/lib/email/send.ts
//
// Shared email transport. Previously sendViaResend lived as a private
// function inside src/app/api/invitations/route.ts, so no other route
// could send email — which is why forgot-password still had a TODO.
//
// Everything that sends email should import from here. One transport,
// one place to change providers, one place to add retries or logging.

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export type SendEmailArgs = {
  to: string
  subject: string
  html: string
  text?: string
}

/**
 * Base URL for links inside emails.
 *
 * IMPORTANT: do not derive this from the request. On Vercel, a request
 * may arrive at a preview deployment URL, and a reset link pointing at
 * a preview build will not work for the recipient. Set
 * NEXT_PUBLIC_APP_URL to your canonical domain.
 */
export function appUrl(fallbackOrigin?: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL
  if (configured) return configured.replace(/\/+$/, '')
  if (fallbackOrigin) return fallbackOrigin.replace(/\/+$/, '')
  return 'https://thecommunitydeals.com'
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

/**
 * Send an email via Resend. Throws on failure — callers decide whether
 * that should surface to the user.
 */
export async function sendEmail({ to, subject, html, text }: SendEmailArgs): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('Email not configured — add RESEND_API_KEY to environment variables')

  const from = process.env.FROM_EMAIL || 'Windfall Community Deals <noreply@thecommunitydeals.com>'

  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ from, to: [to], subject, html, text: text || undefined }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({} as any))
    throw new Error(err?.message || `Email provider error (${res.status})`)
  }
}

// ── Shared branded layout ─────────────────────────────────────
// Matches the invitation email so all platform mail looks consistent.

const TEAL = '#0F6E56'
const NAVY = '#0D2137'

export function emailLayout(opts: {
  icon: string
  heading: string
  body: string
  footer?: string
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:system-ui,sans-serif">
  <div style="max-width:560px;margin:40px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">

    <div style="background:linear-gradient(135deg,${NAVY},${TEAL});padding:32px 40px;text-align:center">
      <div style="font-size:28px;margin-bottom:8px">${opts.icon}</div>
      <h1 style="color:white;font-size:22px;font-weight:700;margin:0">Windfall Community Deals</h1>
      <p style="color:rgba(255,255,255,0.7);font-size:13px;margin:6px 0 0">${opts.heading}</p>
    </div>

    <div style="padding:36px 40px">
      ${opts.body}
    </div>

    <div style="background:#F8FAFC;padding:20px 40px;border-top:1px solid #E2E8F0;text-align:center">
      <p style="font-size:11px;color:#94A3B8;margin:0">
        ${opts.footer || 'This is an automated message from Windfall Community Deals.'}
      </p>
    </div>
  </div>
</body>
</html>`
}

export function emailButton(href: string, label: string): string {
  return `
      <div style="text-align:center;margin-bottom:28px">
        <a href="${href}"
          style="display:inline-block;background:linear-gradient(135deg,${NAVY},${TEAL});color:white;text-decoration:none;padding:14px 36px;border-radius:10px;font-size:15px;font-weight:600;letter-spacing:0.02em">
          ${label}
        </a>
      </div>
      <p style="font-size:12px;color:#94A3B8;text-align:center;margin:0 0 4px">Or copy this link:</p>
      <p style="font-size:11px;color:${TEAL};text-align:center;word-break:break-all;margin:0">
        <a href="${href}" style="color:${TEAL}">${href}</a>
      </p>`
}
