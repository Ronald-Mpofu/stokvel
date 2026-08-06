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
// NOTE ON CONTRIBUTION AMOUNT — removed deliberately (do not re-add).
// Contribution terms belong to the Windfall Scheme, not the Group.
// Group.contributionAmount is a vestigial column, and quoting it here
// told invitees they owed a monthly sum merely for joining a group.
// Joining a group commits you to nothing; scheme terms arrive in the
// scheme introduction email, sent when a scheme is activated.
// contributionAmount and currency are still accepted so existing
// callers keep compiling, but they are not rendered.
export async function sendInvitationEmail(opts: {
  to: string
  inviteeName?: string
  inviterName: string
  groupName: string
  contributionAmount?: number
  currency?: string
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
    <p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 20px">
      Accepting costs you nothing and commits you to nothing. Groups run savings
      schemes that members choose to join separately, and you'll receive the full
      terms of any scheme before it starts.
    </p>

    <!-- Group summary card -->
    <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:16px 20px;margin:0 0 24px">
      <table style="width:100%;font-size:13px;color:#166534">
        <tr><td style="padding:4px 0;color:#64748B">Group</td><td style="padding:4px 0;font-weight:600;text-align:right">${opts.groupName}</td></tr>
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

// ── Scheme introduction email ─────────────────────────────────
// Sent to every member of a Windfall Scheme when the scheme is ACTIVATED.
//
// WHY ACTIVATION AND NOT CREATION
//   At creation a pool sits in SETUP: no payout positions exist, no
//   contribution schedules have been written, and the admin may still
//   change the amount, add members, or delete it. Activation is the
//   point at which the terms become real and irreversible — and the
//   only point at which a rotating member's position can be stated.
//
// Every figure here is passed in already resolved. This function does
// no arithmetic and no database access, so it cannot disagree with the
// records the caller has just written.
export async function sendSchemeIntroductionEmail(opts: {
  to: string
  memberName: string
  schemeName: string
  groupName: string
  currency: string
  startDate: Date
  isRotating: boolean
  contributionAmount: number
  contributionFrequency: string      // WEEKLY | FORTNIGHTLY | MONTHLY
  cycleCount: number
  potPerCycle: number
  maturityDate?: Date | null         // maturity pools only
  payoutStrategy?: string | null     // rotating pools only
  payoutPosition?: number | null     // this member's position
  payoutDate?: Date | null           // when this member is paid
  members: { fullName: string; position?: number | null }[]
  notes?: string | null
  allowLoans: boolean
  interestRatePa?: number | null     // decimal, e.g. 0.24
  maxLoanAmount?: number | null      // resolved currency amount
}): Promise<SendResult> {

  const money = (n: number) =>
    `${opts.currency} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const date = (d: Date | null | undefined) =>
    d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'

  const cadence = (f: string) =>
    f === 'WEEKLY' ? 'Weekly' : f === 'FORTNIGHTLY' ? 'Fortnightly' : 'Monthly'

  const strategyLabel = (sVal?: string | null) =>
    sVal === 'RANDOM'     ? 'Random draw'
    : sVal === 'GROUP_VOTE' ? 'Group vote'
    : sVal === 'SENIORITY'  ? 'Seniority — longest-standing member first'
    : '—'

  const row = (label: string, value: string) => `
        <tr>
          <td style="padding:7px 0;color:#64748B;font-size:13px;vertical-align:top">${label}</td>
          <td style="padding:7px 0;font-weight:600;font-size:13px;text-align:right;color:#0D2137">${value}</td>
        </tr>`

  // Rotating pools pay each member once; the schedule is the rotation.
  // Maturity pools pay out on one date at the end of the term.
  const scheduleRows = opts.isRotating
    ? row('Payout strategy', strategyLabel(opts.payoutStrategy)) +
      row('Rotation length', `${opts.cycleCount} ${opts.cycleCount === 1 ? 'cycle' : 'cycles'}`)
    : row('Maturity date', date(opts.maturityDate)) +
      row('Contribution cycles', `${opts.cycleCount}`)

  // The member's own position is the thing they will look for first, so
  // it gets its own panel rather than a table row.
  const positionPanel = (opts.isRotating && opts.payoutPosition)
    ? `
    <div style="background:#0F6E56;border-radius:10px;padding:18px 20px;margin:0 0 22px;text-align:center">
      <div style="color:#9FE1CB;font-size:12px;margin:0 0 4px">Your position in the rotation</div>
      <div style="color:#ffffff;font-size:30px;font-weight:700;line-height:1.1">#${opts.payoutPosition}</div>
      <div style="color:#9FE1CB;font-size:13px;margin:6px 0 0">
        You receive ${money(opts.potPerCycle)}${opts.payoutDate ? ` on ${date(opts.payoutDate)}` : ''}
      </div>
    </div>`
    : ''

  const loanRows = opts.allowLoans
    ? row('Loans', 'Available to members') +
      (opts.interestRatePa != null ? row('Interest rate', `${(opts.interestRatePa * 100).toFixed(1)}% per year`) : '') +
      (opts.maxLoanAmount  != null ? row('Maximum loan', money(opts.maxLoanAmount)) : '')
    : row('Loans', 'Not available in this scheme')

  const memberList = opts.members.length
    ? opts.members.map(m => `
        <tr>
          <td style="padding:5px 0;font-size:13px;color:#374151">
            ${m.position ? `<span style="display:inline-block;min-width:22px;color:#0F6E56;font-weight:700">${m.position}.</span>` : '• '}${m.fullName}
          </td>
        </tr>`).join('')
    : `<tr><td style="padding:5px 0;font-size:13px;color:#94A3B8">No members listed</td></tr>`

  const notesBlock = opts.notes
    ? `
    <div style="background:#FFFBEB;border-left:4px solid #D97706;border-radius:0 8px 8px 0;padding:13px 16px;margin:0 0 22px">
      <div style="font-size:12px;font-weight:700;color:#92400E;margin:0 0 4px">Notes from your group admin</div>
      <div style="font-size:13px;color:#78350F;line-height:1.6">${opts.notes}</div>
    </div>`
    : ''

  const html = wrap(`
    <h2 style="color:#0D2137;font-size:18px;margin:0 0 6px">${opts.schemeName} has started</h2>
    <p style="color:#94A3B8;font-size:13px;margin:0 0 18px">${opts.groupName}</p>

    <p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 20px">
      Dear ${opts.memberName}, you are enrolled in this scheme. Below are the full
      terms as agreed by your group. Keep this email — it is your record of what
      was set at the start.
    </p>

    ${positionPanel}

    <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:6px 18px;margin:0 0 22px">
      <table style="width:100%;border-collapse:collapse">
        ${row('Scheme', opts.schemeName)}
        ${row('Starts', date(opts.startDate))}
        ${row('Your contribution', `${money(opts.contributionAmount)} ${cadence(opts.contributionFrequency).toLowerCase()}`)}
        ${row('Pot per cycle', money(opts.potPerCycle))}
        ${scheduleRows}
        ${loanRows}
      </table>
    </div>

    ${notesBlock}

    <div style="margin:0 0 22px">
      <div style="font-size:13px;font-weight:700;color:#0D2137;margin:0 0 8px">
        Members in this scheme (${opts.members.length})
      </div>
      <div style="background:#ffffff;border:1px solid #E2E8F0;border-radius:10px;padding:10px 16px">
        <table style="width:100%;border-collapse:collapse">${memberList}</table>
      </div>
    </div>

    <div style="text-align:center;margin:0 0 8px">
      <a href="${APP_URL}/portal"
        style="display:inline-block;padding:14px 36px;background:#0F6E56;color:#ffffff;text-decoration:none;border-radius:10px;font-size:15px;font-weight:600">
        View in your portal →
      </a>
    </div>
    <p style="color:#94A3B8;font-size:12px;text-align:center;margin:12px 0 0">
      The pot figure is based on ${opts.members.length} ${opts.members.length === 1 ? 'member' : 'members'} at launch
      and changes if membership changes.
    </p>
  `)

  return sendEmail({
    to:      opts.to,
    subject: `${opts.schemeName} has started — your scheme details`,
    html,
  })
}
