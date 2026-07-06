// src/app/api/invitations/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'
import bcrypt from 'bcryptjs'

const sendSchema = z.object({
  groupId:         z.string().uuid(),
  invitedById:     z.string().uuid(),
  email:           z.string().email().optional().or(z.literal('')),
  phone:           z.string().optional(),
  fullName:        z.string().optional(),
  role:            z.string().default('MEMBER'),
  channel:         z.enum(['EMAIL','SMS','BOTH']).default('BOTH'),
  personalMessage: z.string().optional(),
})

const acceptSchema = z.object({
  token:     z.string().uuid(),
  fullName:  z.string().min(2),
  phone:     z.string().min(7),
  password:  z.string().min(8),
  nationalId: z.string().optional(),
  city:      z.string().optional(),
  country:   z.string().optional(),
  agreedToTerms: z.boolean().refine(v => v, 'Must agree to terms'),
})

// ── GET — fetch invitations for a group ───────────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const groupId  = searchParams.get('groupId')
    const token    = searchParams.get('token')

    // Single invitation lookup by token (public — for the invite page)
    if (token) {
      const inv = await prisma.memberInvitation.findUnique({
        where:   { token },
        include: { group: { select: { name: true, description: true, currency: true, contributionAmount: true, maxMembers: true, country: true, region: true, _count: { select: { members: true } } } },
                   invitedBy: { select: { fullName: true } } },
      })
      if (!inv) return NextResponse.json({ success: false, error: 'Invitation not found. The link may be invalid.' }, { status: 404 })

      const now = new Date()
      if (inv.status === 'ACCEPTED') return NextResponse.json({ success: false, error: 'This invitation has already been accepted.', code: 'ALREADY_ACCEPTED' }, { status: 410 })
      if (inv.status === 'CANCELLED') return NextResponse.json({ success: false, error: 'This invitation has been cancelled by the group administrator.', code: 'CANCELLED' }, { status: 410 })
      if (inv.expiresAt < now || inv.status === 'EXPIRED') {
        await prisma.memberInvitation.update({ where: { token }, data: { status: 'EXPIRED' } })
        return NextResponse.json({ success: false, error: 'This invitation has expired. Please ask the group admin to send a new one.', code: 'EXPIRED' }, { status: 410 })
      }

      return NextResponse.json({
        success: true,
        data: {
          id:              inv.id,
          token:           inv.token,
          groupName:       inv.group.name,
          groupDescription: inv.group.description,
          currency:        inv.group.currency,
          contributionAmount: Number(inv.group.contributionAmount),
          memberCount:     inv.group._count.members,
          maxMembers:      inv.group.maxMembers,
          country:         inv.group.country,
          region:          inv.group.region,
          invitedByName:   inv.invitedBy.fullName,
          fullName:        inv.fullName,
          email:           inv.email,
          phone:           inv.phone,
          personalMessage: inv.personalMessage,
          expiresAt:       inv.expiresAt,
          role:            inv.role,
          daysLeft:        Math.ceil((inv.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
        },
      })
    }

    // List invitations for a group
    if (!groupId) return NextResponse.json({ success: false, error: 'groupId required' }, { status: 400 })

    const invitations = await prisma.memberInvitation.findMany({
      where:   { groupId },
      include: { invitedBy: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({
      success: true,
      data: invitations.map(formatInvitation),
      summary: {
        total:    invitations.length,
        pending:  invitations.filter(i => i.status === 'PENDING').length,
        accepted: invitations.filter(i => i.status === 'ACCEPTED').length,
        expired:  invitations.filter(i => ['EXPIRED','CANCELLED'].includes(i.status)).length,
      },
    })
  } catch (e: any) {
    console.error('GET /api/invitations error:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── POST — send invitation or accept ─────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (body.action === 'ACCEPT') return handleAccept(body)
    if (body.action === 'CANCEL') return handleCancel(body)
    if (body.action === 'RESEND') return handleResend(body)

    // Default: send new invitation
    const data = sendSchema.parse(body)

    if (!data.email && !data.phone) {
      return NextResponse.json({ success: false, error: 'At least one of email or phone is required.' }, { status: 400 })
    }

    // Check if already invited and pending
    const existing = await prisma.memberInvitation.findFirst({
      where: {
        groupId: data.groupId,
        email:   data.email || undefined,
        status:  'PENDING',
      },
    })
    if (existing) {
      return NextResponse.json({ success: false, error: `An active invitation already exists for ${data.email || data.phone}. Use Resend to send another reminder.` }, { status: 409 })
    }

    // Check if already a member
    if (data.email) {
      const existingUser = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } })
      if (existingUser) {
        const membership = await prisma.groupMember.findFirst({ where: { groupId: data.groupId, userId: existingUser.id } })
        if (membership) return NextResponse.json({ success: false, error: `${data.email} is already a member of this group.` }, { status: 409 })
      }
    }

    // Get group details for the email/SMS content
    const group = await prisma.group.findUnique({
      where:   { id: data.groupId },
      select:  { name: true, contributionAmount: true, currency: true, maxMembers: true },
    })
    if (!group) return NextResponse.json({ success: false, error: 'Group not found' }, { status: 404 })

    const inviter = await prisma.user.findUnique({ where: { id: data.invitedById }, select: { fullName: true } })
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

    const invitation = await prisma.memberInvitation.create({
      data: {
        groupId:         data.groupId,
        invitedById:     data.invitedById,
        email:           data.email?.toLowerCase() || null,
        phone:           data.phone || null,
        fullName:        data.fullName || null,
        role:            data.role,
        channel:         data.channel,
        personalMessage: data.personalMessage || null,
        expiresAt,
      },
    })

    // Build invitation URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const inviteUrl = `${baseUrl}/invite/${invitation.token}`

    // Send notifications
    const results = { email: false, sms: false, errors: [] as string[] }

    if (['EMAIL','BOTH'].includes(data.channel) && data.email) {
      try {
        await sendInvitationEmail({
          to:              data.email,
          inviteUrl,
          groupName:       group.name,
          inviterName:     inviter?.fullName || 'Group Administrator',
          memberName:      data.fullName,
          contribution:    Number(group.contributionAmount),
          currency:        group.currency,
          personalMessage: data.personalMessage,
          expiresAt,
        })
        await prisma.memberInvitation.update({ where: { id: invitation.id }, data: { emailSentAt: new Date() } })
        results.email = true
      } catch (e: any) {
        console.error('Email send error:', e.message)
        results.errors.push(`Email: ${e.message}`)
      }
    }

    if (['SMS','BOTH'].includes(data.channel) && data.phone) {
      try {
        await sendInvitationSMS({
          to:          data.phone,
          inviteUrl,
          groupName:   group.name,
          inviterName: inviter?.fullName || 'Admin',
          contribution: Number(group.contributionAmount),
          currency:    group.currency,
        })
        await prisma.memberInvitation.update({ where: { id: invitation.id }, data: { smsSentAt: new Date() } })
        results.sms = true
      } catch (e: any) {
        console.error('SMS send error:', e.message)
        results.errors.push(`SMS: ${e.message}`)
      }
    }

    const sentVia = [results.email && 'email', results.sms && 'SMS'].filter(Boolean).join(' and ')
    const message = sentVia
      ? `Invitation sent via ${sentVia} to ${data.fullName || data.email || data.phone}`
      : `Invitation created. ${results.errors.length > 0 ? 'Note: ' + results.errors.join('; ') : 'Copy the link to share manually.'}`

    return NextResponse.json({
      success: true,
      data: {
        id:        invitation.id,
        token:     invitation.token,
        inviteUrl,
        emailSent: results.email,
        smsSent:   results.sms,
        errors:    results.errors,
      },
      message,
    }, { status: 201 })

  } catch (e: any) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: e.errors.map(x => x.message).join('; ') }, { status: 400 })
    }
    console.error('POST /api/invitations error:', e)
    return NextResponse.json({ success: false, error: e.message || 'Failed to send invitation' }, { status: 500 })
  }
}

// ── Accept invitation ─────────────────────────────────────────
async function handleAccept(body: any): Promise<NextResponse> {
  try {
    const data = acceptSchema.parse(body)

    const inv = await prisma.memberInvitation.findUnique({
      where:   { token: data.token },
      include: { group: { select: { id: true, name: true, contributionAmount: true, currency: true, country: true } } },
    })

    if (!inv)                    return NextResponse.json({ success: false, error: 'Invitation not found.' }, { status: 404 })
    if (inv.status === 'ACCEPTED') return NextResponse.json({ success: false, error: 'This invitation has already been accepted.' }, { status: 410 })
    if (inv.status === 'CANCELLED') return NextResponse.json({ success: false, error: 'This invitation was cancelled.' }, { status: 410 })
    if (inv.expiresAt < new Date()) return NextResponse.json({ success: false, error: 'This invitation has expired.' }, { status: 410 })

    // Check email not already registered
    if (inv.email) {
      const existing = await prisma.user.findUnique({ where: { email: inv.email } })
      if (existing) return NextResponse.json({ success: false, error: `An account with ${inv.email} already exists. Please log in instead.`, code: 'EMAIL_EXISTS' }, { status: 409 })
    }

    const passwordHash = await bcrypt.hash(data.password, 12)

    // Create user + group member in one transaction
    const { user } = await prisma.$transaction(async (tx) => {
      // Create user account
      const user = await tx.user.create({
        data: {
          email:        inv.email || `member_${Date.now()}@stokvel.local`,
          phone:        data.phone,
          passwordHash,
          fullName:     data.fullName,
          role:         'MEMBER',
          status:       'ACTIVE',
          kycStatus:    'PENDING',
          country:      data.country || inv.group.country || 'Zimbabwe',
          city:         data.city,
          reputationScore: 50,
          emailVerifiedAt: inv.email ? new Date() : null, // email verified via invite link
        },
      })

      // Create group membership
      await tx.groupMember.create({
        data: {
          groupId:    inv.groupId,
          userId:     user.id,
          role:       inv.role as any,
          status:     'ACTIVE',
          joinedAt:   new Date(),
          approvedAt: new Date(),
          approvedById: inv.invitedById,
        },
      })

      // Mark invitation as accepted
      await tx.memberInvitation.update({
        where: { id: inv.id },
        data:  { status: 'ACCEPTED', acceptedAt: new Date(), acceptedUserId: user.id },
      })

      // Audit log
      await tx.auditLog.create({
        data: {
          userId:      user.id,
          groupId:     inv.groupId,
          action:      'CREATE',
          entityType:  'GroupMember',
          entityId:    user.id,
          description: `${data.fullName} accepted invitation and joined "${inv.group.name}"`,
        },
      })

      return { user }
    })

    // Send welcome email (non-blocking)
    if (inv.email) {
      sendWelcomeEmail({
        to:        inv.email,
        fullName:  data.fullName,
        groupName: inv.group.name,
        contribution: Number(inv.group.contributionAmount),
        currency:  inv.group.currency,
        loginUrl:  `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/login`,
      }).catch(e => console.warn('Welcome email failed:', e.message))
    }

    return NextResponse.json({
      success: true,
      message: `Welcome to ${inv.group.name}, ${data.fullName}! Your account has been created.`,
      data: {
        userId:    user.id,
        groupName: inv.group.name,
        loginUrl:  '/login',
      },
    })
  } catch (e: any) {
    if (e instanceof z.ZodError) return NextResponse.json({ success: false, error: e.errors.map(x => x.message).join('; ') }, { status: 400 })
    console.error('Accept invitation error:', e)
    return NextResponse.json({ success: false, error: e.message || 'Failed to accept invitation' }, { status: 500 })
  }
}

// ── Cancel invitation ─────────────────────────────────────────
async function handleCancel(body: any): Promise<NextResponse> {
  const { invitationId } = body
  await prisma.memberInvitation.update({ where: { id: invitationId }, data: { status: 'CANCELLED', cancelledAt: new Date() } })
  return NextResponse.json({ success: true, message: 'Invitation cancelled' })
}

// ── Resend invitation ─────────────────────────────────────────
async function handleResend(body: any): Promise<NextResponse> {
  try {
    const { invitationId } = body
    const inv = await prisma.memberInvitation.findUniqueOrThrow({
      where:   { id: invitationId },
      include: { group: { select: { name: true, contributionAmount: true, currency: true } }, invitedBy: { select: { fullName: true } } },
    })

    if (inv.status === 'ACCEPTED') return NextResponse.json({ success: false, error: 'Invitation already accepted' }, { status: 400 })

    // Extend expiry by 7 days from now
    const newExpiry  = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const baseUrl    = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const inviteUrl  = `${baseUrl}/invite/${inv.token}`

    await prisma.memberInvitation.update({
      where: { id: invitationId },
      data:  { status: 'PENDING', expiresAt: newExpiry, resendCount: { increment: 1 }, reminderSentAt: new Date() },
    })

    if (inv.email && ['EMAIL','BOTH'].includes(inv.channel)) {
      await sendInvitationEmail({
        to: inv.email, inviteUrl, groupName: inv.group.name,
        inviterName: inv.invitedBy.fullName, memberName: inv.fullName,
        contribution: Number(inv.group.contributionAmount), currency: inv.group.currency,
        personalMessage: inv.personalMessage, expiresAt: newExpiry, isReminder: true,
      }).catch(e => console.warn('Resend email failed:', e.message))
    }

    return NextResponse.json({ success: true, message: `Invitation resent. New expiry: ${newExpiry.toLocaleDateString()}` })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── Email sender ──────────────────────────────────────────────
async function sendInvitationEmail({ to, inviteUrl, groupName, inviterName, memberName, contribution, currency, personalMessage, expiresAt, isReminder = false }: any) {
  const currencySymbol = currency === 'USD' ? '$' : currency
  const greeting = memberName ? `Hi ${memberName.split(' ')[0]},` : 'Hi there,'
  const subject  = isReminder
    ? `Reminder: You're invited to join ${groupName} on Windfall Community Deals`
    : `${inviterName} has invited you to join ${groupName}`

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:system-ui,sans-serif">
  <div style="max-width:560px;margin:40px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#0D2137,#0F6E56);padding:32px 40px;text-align:center">
      <div style="font-size:28px;margin-bottom:8px">🔄</div>
      <h1 style="color:white;font-size:22px;font-weight:700;margin:0">Windfall Community Deals</h1>
      <p style="color:rgba(255,255,255,0.7);font-size:13px;margin:6px 0 0">Your community. Your savings. Your future.</p>
    </div>

    <!-- Body -->
    <div style="padding:36px 40px">
      <p style="font-size:16px;color:#0D2137;font-weight:600;margin:0 0 8px">${greeting}</p>
      <p style="font-size:14px;color:#475569;line-height:1.6;margin:0 0 24px">
        ${isReminder ? `This is a reminder that` : ''} <strong>${inviterName}</strong> has invited you to join
        <strong>${groupName}</strong> — a savings and investment group on the Windfall Community Deals.
      </p>

      ${personalMessage ? `
      <div style="background:#F0FDF4;border-left:4px solid #0F6E56;border-radius:4px;padding:14px 18px;margin-bottom:24px">
        <p style="font-size:13px;color:#166534;font-style:italic;margin:0">"${personalMessage}"</p>
        <p style="font-size:12px;color:#94A3B8;margin:6px 0 0">— ${inviterName}</p>
      </div>` : ''}

      <!-- Group details -->
      <div style="background:#F8FAFC;border-radius:10px;padding:20px;margin-bottom:28px;border:1px solid #E2E8F0">
        <h3 style="font-size:13px;font-weight:600;color:#64748B;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 14px">Group Details</h3>
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #F1F5F9">
          <span style="font-size:13px;color:#64748B">Group Name</span>
          <span style="font-size:13px;font-weight:600;color:#0D2137">${groupName}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #F1F5F9">
          <span style="font-size:13px;color:#64748B">Monthly Contribution</span>
          <span style="font-size:13px;font-weight:600;color:#0F6E56">${currencySymbol}${contribution.toLocaleString()}/month</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:8px 0">
          <span style="font-size:13px;color:#64748B">Invitation expires</span>
          <span style="font-size:13px;color:#854D0E">${expiresAt.toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })}</span>
        </div>
      </div>

      <!-- CTA Button -->
      <div style="text-align:center;margin-bottom:28px">
        <a href="${inviteUrl}"
          style="display:inline-block;background:linear-gradient(135deg,#0D2137,#0F6E56);color:white;text-decoration:none;padding:14px 36px;border-radius:10px;font-size:15px;font-weight:600;letter-spacing:0.02em">
          ✅ Accept Invitation
        </a>
      </div>

      <p style="font-size:12px;color:#94A3B8;text-align:center;margin:0 0 4px">Or copy this link:</p>
      <p style="font-size:11px;color:#0F6E56;text-align:center;word-break:break-all;margin:0">
        <a href="${inviteUrl}" style="color:#0F6E56">${inviteUrl}</a>
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#F8FAFC;padding:20px 40px;border-top:1px solid #E2E8F0;text-align:center">
      <p style="font-size:11px;color:#94A3B8;margin:0">
        You received this because ${inviterName} invited you to ${groupName}.<br>
        If you don't know ${inviterName}, you can safely ignore this email.
      </p>
    </div>
  </div>
</body>
</html>`

  await sendViaResend({
    to,
    subject,
    html,
    text: `${inviterName} has invited you to join ${groupName}. Click here to accept: ${inviteUrl} (expires ${expiresAt.toLocaleDateString()})`,
  })
}

// ── Welcome email ─────────────────────────────────────────────
async function sendWelcomeEmail({ to, fullName, groupName, contribution, currency, loginUrl }: any) {
  const currencySymbol = currency === 'USD' ? '$' : currency

  await sendViaResend({
    to,
    subject: `Welcome to ${groupName} — Your account is ready`,
    html: `
<body style="font-family:system-ui,sans-serif;background:#F8FAFC;margin:0;padding:0">
  <div style="max-width:560px;margin:40px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#0D2137,#0F6E56);padding:32px 40px;text-align:center">
      <div style="font-size:40px">🎉</div>
      <h1 style="color:white;font-size:22px;margin:8px 0 0">Welcome, ${fullName.split(' ')[0]}!</h1>
    </div>
    <div style="padding:36px 40px">
      <p style="font-size:15px;color:#0D2137;font-weight:600">You're now a member of <strong>${groupName}</strong></p>
      <p style="font-size:14px;color:#475569;line-height:1.6">Your account has been created and you're officially part of the group. Your monthly contribution is <strong>${currencySymbol}${contribution.toLocaleString()}</strong>.</p>
      <div style="text-align:center;margin:28px 0">
        <a href="${loginUrl}" style="display:inline-block;background:linear-gradient(135deg,#0D2137,#0F6E56);color:white;text-decoration:none;padding:14px 36px;border-radius:10px;font-size:15px;font-weight:600">
          🚀 Go to My Dashboard
        </a>
      </div>
    </div>
  </div>
</body>`,
  })
}

// ── SMS sender ────────────────────────────────────────────────
async function sendInvitationSMS({ to, inviteUrl, groupName, inviterName, contribution, currency }: any) {
  const apiKey   = process.env.AT_API_KEY
  const username = process.env.AT_USERNAME

  if (!apiKey || !username) {
    throw new Error('SMS not configured. Add AT_API_KEY and AT_USERNAME to .env.local')
  }

  const currencySymbol = currency === 'USD' ? '$' : currency
  const message = `${inviterName} invited you to join ${groupName} on Windfall Community Deals. Contribute ${currencySymbol}${contribution}/mo. Accept here: ${inviteUrl}`

  const response = await fetch('https://api.sandbox.africastalking.com/version1/messaging', {
    method:  'POST',
    headers: {
      'apiKey':       apiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept':       'application/json',
    },
    body: new URLSearchParams({ username, to, message }).toString(),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`SMS API error: ${text}`)
  }
}

// ── Format helper ─────────────────────────────────────────────
function formatInvitation(inv: any) {
  return {
    id:              inv.id,
    token:           inv.token,
    email:           inv.email,
    phone:           inv.phone,
    fullName:        inv.fullName,
    role:            inv.role,
    channel:         inv.channel,
    status:          inv.status,
    expiresAt:       inv.expiresAt,
    acceptedAt:      inv.acceptedAt,
    cancelledAt:     inv.cancelledAt,
    personalMessage: inv.personalMessage,
    emailSentAt:     inv.emailSentAt,
    smsSentAt:       inv.smsSentAt,
    resendCount:     inv.resendCount,
    invitedByName:   inv.invitedBy?.fullName,
    daysLeft:        Math.max(0, Math.ceil((new Date(inv.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))),
    inviteUrl:       `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/invite/${inv.token}`,
    createdAt:       inv.createdAt,
  }
}

// ── Resend transport (replaces SMTP/nodemailer) ───────────────
async function sendViaResend({ to, subject, html, text }: { to: string; subject: string; html: string; text?: string }) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('Email not configured — add RESEND_API_KEY to environment variables')

  const from = process.env.FROM_EMAIL || 'Windfall Community Deals <noreply@thecommunitydeals.com>'

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ from, to: [to], subject, html, text: text || undefined }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({} as any))
    throw new Error(err?.message || `Email provider error (${res.status})`)
  }
}
