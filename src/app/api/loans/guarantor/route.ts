// src/app/api/loans/guarantor/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'
import { textToHtml } from '@/lib/notifications/engine'

const addSchema = z.object({
  loanId:   z.string().uuid(),
  fullName: z.string().min(2),
  email:    z.string().email(),
  phone:    z.string().min(7),
})

const respondSchema = z.object({
  token:          z.string().uuid(),
  action:         z.enum(['APPROVE', 'DECLINE']),
  rejectedReason: z.string().optional(),
  ipAddress:      z.string().optional(),
})

// ── GET — fetch guarantors for a loan OR verify a token ───────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const loanId = searchParams.get('loanId')
    const token  = searchParams.get('token')

    // Public token verification (for the approval page)
    if (token) {
      const g = await prisma.loanGuarantor.findUnique({
        where:   { token },
        include: {
          loan: {
            include: {
              borrower: { select: { fullName: true } },
              group:    { select: { name: true, currency: true } },
            },
          },
        },
      })

      if (!g) return NextResponse.json({ success: false, error: 'Invalid or expired link.', code: 'NOT_FOUND' }, { status: 404 })
      if (g.status !== 'PENDING') return NextResponse.json({ success: false, error: `This guarantee request has already been ${g.status.toLowerCase()}.`, code: g.status }, { status: 410 })
      if (new Date(g.tokenExpiresAt) < new Date()) return NextResponse.json({ success: false, error: 'This link has expired. Please ask the borrower to request a new guarantee.', code: 'EXPIRED' }, { status: 410 })

      return NextResponse.json({
        success: true,
        data: {
          id:            g.id,
          token:         g.token,
          fullName:      g.fullName,
          email:         g.email,
          phone:         g.phone,
          status:        g.status,
          daysLeft:      Math.ceil((new Date(g.tokenExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
          loan: {
            id:           g.loan.id,
            amount:       Number(g.loan.amount),
            currency:     g.loan.group.currency,
            termMonths:   g.loan.termMonths,
            purpose:      g.loan.purpose,
            interestRatePa: Number(g.loan.interestRatePa),
            borrowerName: g.loan.borrower.fullName,
            groupName:    g.loan.group.name,
          },
        },
      })
    }

    // Admin: list guarantors for a loan
    if (loanId) {
      const guarantors = await prisma.loanGuarantor.findMany({
        where:   { loanId },
        orderBy: { createdAt: 'asc' },
      })
      return NextResponse.json({ success: true, data: guarantors.map(formatGuarantor) })
    }

    return NextResponse.json({ success: false, error: 'loanId or token required' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── POST — add guarantor OR respond to guarantee request ──────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Public response (approve / decline)
    if (body.action === 'APPROVE' || body.action === 'DECLINE') {
      return handleResponse(body)
    }

    // Resend email
    if (body.action === 'RESEND') {
      return handleResend(body.guarantorId)
    }

    // Remove guarantor
    if (body.action === 'REMOVE') {
      await prisma.loanGuarantor.delete({ where: { id: body.guarantorId } })
      return NextResponse.json({ success: true, message: 'Guarantor removed' })
    }

    // Add new guarantor
    const data = addSchema.parse(body)

    // Check not already a guarantor for this loan
    const existing = await prisma.loanGuarantor.findFirst({
      where: { loanId: data.loanId, email: data.email.toLowerCase() },
    })
    if (existing) return NextResponse.json({ success: false, error: `${data.email} is already a guarantor for this loan.` }, { status: 409 })

    const loan = await prisma.loan.findUnique({
      where:   { id: data.loanId },
      include: {
        borrower: { select: { fullName: true } },
        group:    { select: { name: true, currency: true } },
      },
    })
    if (!loan) return NextResponse.json({ success: false, error: 'Loan not found' }, { status: 404 })

    // Try to link to existing user
    const existingUser = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } })

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    const guarantor = await prisma.loanGuarantor.create({
      data: {
        loanId:        data.loanId,
        userId:        existingUser?.id || null,
        fullName:      data.fullName,
        email:         data.email.toLowerCase(),
        phone:         data.phone,
        tokenExpiresAt: expiresAt,
        status:        'PENDING',
      },
    })

    // Send approval email
    await sendGuarantorEmail(guarantor, loan)
    await prisma.loanGuarantor.update({
      where: { id: guarantor.id },
      data:  { emailSentAt: new Date() },
    })

    return NextResponse.json({
      success: true,
      data:    { id: guarantor.id, token: guarantor.token },
      message: `Guarantee request sent to ${data.fullName} at ${data.email}`,
    }, { status: 201 })

  } catch (e: any) {
    if (e instanceof z.ZodError) return NextResponse.json({ success: false, error: e.errors.map(x => x.message).join('; ') }, { status: 400 })
    console.error('POST /api/loans/guarantor error:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── Handle guarantor response ─────────────────────────────────
async function handleResponse(body: any): Promise<NextResponse> {
  try {
    const data = respondSchema.parse(body)

    const g = await prisma.loanGuarantor.findUnique({ where: { token: data.token } })
    if (!g)                        return NextResponse.json({ success: false, error: 'Invalid link.' }, { status: 404 })
    if (g.status !== 'PENDING')    return NextResponse.json({ success: false, error: `Already ${g.status.toLowerCase()}.` }, { status: 410 })
    if (new Date(g.tokenExpiresAt) < new Date()) return NextResponse.json({ success: false, error: 'Link expired.' }, { status: 410 })

    await prisma.loanGuarantor.update({
      where: { token: data.token },
      data: {
        status:         data.action === 'APPROVE' ? 'APPROVED' : 'DECLINED',
        acceptedAt:     data.action === 'APPROVE' ? new Date() : undefined,
        rejectedAt:     data.action === 'DECLINE' ? new Date() : undefined,
        rejectedReason: data.rejectedReason,
        ipAddress:      data.ipAddress,
      },
    })

    await prisma.auditLog.create({
      data: {
        action:      'UPDATE',
        entityType:  'LoanGuarantor',
        entityId:    g.id,
        description: `Guarantor ${g.fullName} ${data.action === 'APPROVE' ? 'approved' : 'declined'} guarantee for loan ${g.loanId}`,
      } as any,
    })

    return NextResponse.json({
      success: true,
      message: data.action === 'APPROVE'
        ? `Thank you ${g.fullName}! Your guarantee has been confirmed.`
        : `Your response has been recorded.`,
      data: { status: data.action === 'APPROVE' ? 'APPROVED' : 'DECLINED' },
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── Resend email ──────────────────────────────────────────────
async function handleResend(guarantorId: string): Promise<NextResponse> {
  const g = await prisma.loanGuarantor.findUnique({
    where:   { id: guarantorId },
    include: {
      loan: {
        include: {
          borrower: { select: { fullName: true } },
          group:    { select: { name: true, currency: true } },
        },
      },
    },
  })
  if (!g) return NextResponse.json({ success: false, error: 'Guarantor not found' }, { status: 404 })

  // Extend expiry
  await prisma.loanGuarantor.update({
    where: { id: guarantorId },
    data:  { tokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), reminderSentAt: new Date() },
  })

  await sendGuarantorEmail(g, g.loan)
  return NextResponse.json({ success: true, message: `Reminder sent to ${g.email}` })
}

// ── Email sender ──────────────────────────────────────────────
async function sendGuarantorEmail(guarantor: any, loan: any) {
  const baseUrl    = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const approveUrl = `${baseUrl}/guarantor/${guarantor.token}`
  const curr       = loan.group.currency === 'USD' ? '$' : loan.group.currency
  const interestPct = (Number(loan.interestRatePa) * 100).toFixed(0)

  const subject = `Action Required: Loan Guarantee Request from ${loan.borrower.fullName}`

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:system-ui,sans-serif">
  <div style="max-width:560px;margin:40px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">

    <div style="background:linear-gradient(135deg,#0D2137,#0F6E56);padding:32px 40px;text-align:center">
      <div style="font-size:32px;margin-bottom:8px">🤝</div>
      <h1 style="color:white;font-size:20px;font-weight:700;margin:0">Loan Guarantee Request</h1>
      <p style="color:rgba(255,255,255,0.7);font-size:13px;margin:6px 0 0">Windfall Community Deals</p>
    </div>

    <div style="padding:32px 40px">
      <p style="font-size:15px;color:#0D2137;font-weight:600;margin:0 0 8px">Hi ${guarantor.fullName},</p>
      <p style="font-size:14px;color:#475569;line-height:1.6;margin:0 0 24px">
        <strong>${loan.borrower.fullName}</strong> has applied for a loan through <strong>${loan.group.name}</strong>
        on the Windfall Community Deals and has listed you as a guarantor. Your approval is required to proceed.
      </p>

      <div style="background:#F8FAFC;border-radius:12px;padding:20px;margin-bottom:28px;border:1px solid #E2E8F0">
        <h3 style="font-size:13px;font-weight:600;color:#64748B;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 14px">Loan Details</h3>
        <table style="width:100%;border-collapse:collapse">
          ${[
            ['Borrower',     loan.borrower.fullName],
            ['Group',        loan.group.name],
            ['Loan Amount',  `${curr}${Number(loan.amount).toLocaleString('en-US',{minimumFractionDigits:2})}`],
            ['Term',         `${loan.termMonths} months`],
            ['Interest Rate',`${interestPct}% per annum`],
            ['Purpose',      loan.purpose],
          ].map(([l,v])=>`
          <tr style="border-bottom:1px solid #F1F5F9">
            <td style="padding:8px 0;font-size:13px;color:#64748B;width:40%">${l}</td>
            <td style="padding:8px 0;font-size:13px;font-weight:600;color:#0D2137">${v}</td>
          </tr>`).join('')}
        </table>
      </div>

      <div style="background:#FEF9C3;border-radius:10px;padding:16px;margin-bottom:28px;border:1px solid #FCD34D">
        <p style="font-size:13px;color:#854D0E;margin:0;line-height:1.6">
          <strong>⚠️ What guaranteeing means:</strong> By approving this request, you agree to be responsible for this loan if
          <strong>${loan.borrower.fullName}</strong> is unable to repay. Please ensure you understand the commitment before approving.
        </p>
      </div>

      <div style="text-align:center;margin-bottom:20px">
        <a href="${approveUrl}" style="display:inline-block;background:linear-gradient(135deg,#0D2137,#0F6E56);color:white;text-decoration:none;padding:14px 36px;border-radius:10px;font-size:15px;font-weight:600;margin-bottom:10px">
          ✅ Review &amp; Respond
        </a>
      </div>
      <p style="font-size:12px;color:#94A3B8;text-align:center;margin:0 0 4px">Or copy this link:</p>
      <p style="font-size:11px;color:#0F6E56;text-align:center;word-break:break-all;margin:0">
        <a href="${approveUrl}" style="color:#0F6E56">${approveUrl}</a>
      </p>
    </div>

    <div style="background:#F8FAFC;padding:20px 40px;border-top:1px solid #E2E8F0;text-align:center">
      <p style="font-size:11px;color:#94A3B8;margin:0">
        This link expires in 7 days. If you did not expect this email, you can safely ignore it.
      </p>
    </div>
  </div>
</body></html>`

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.log(`[DEV — no RESEND_API_KEY] Guarantor email to ${guarantor.email}: ${approveUrl}`)
    return
  }

  const from = process.env.FROM_EMAIL || 'Windfall Community Deals <noreply@thecommunitydeals.com>'

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to:      [guarantor.email],
      subject,
      html,
      text: `Hi ${guarantor.fullName}, ${loan.borrower.fullName} has requested your guarantee for a loan of ${curr}${loan.amount}. Review and respond here: ${approveUrl}`,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({} as any))
    throw new Error(err?.message || `Email provider error (${res.status})`)
  }
}

function formatGuarantor(g: any) {
  return {
    id:           g.id,
    fullName:     g.fullName,
    email:        g.email,
    phone:        g.phone,
    status:       g.status,
    emailSentAt:  g.emailSentAt,
    reminderSentAt: g.reminderSentAt,
    acceptedAt:   g.acceptedAt,
    rejectedAt:   g.rejectedAt,
    rejectedReason: g.rejectedReason,
    daysLeft:     Math.max(0, Math.ceil((new Date(g.tokenExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))),
    createdAt:    g.createdAt,
  }
}
