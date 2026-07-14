// src/app/api/loans/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'
import { requireGroupManager } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const createSchema = z.object({
  groupId:      z.string().uuid(),
  borrowerId:   z.string().uuid(),
  type:         z.enum(['STANDARD','EMERGENCY','BUSINESS']).default('STANDARD'),
  amount:       z.coerce.number().positive(),
  interestRatePa: z.coerce.number().min(0).max(1),  // e.g. 0.24 = 24% p.a.
  termMonths:   z.coerce.number().int().min(1).max(60),
  purpose:      z.string().min(5),
  isEmergency:  z.boolean().default(false),
  guarantorIds: z.array(z.string().uuid()).optional(),
})

const reviewSchema = z.object({
  loanId:    z.string().uuid(),
  action:    z.enum(['APPROVE','REJECT','TREASURER_REVIEW','DISBURSE']),
  reviewerId: z.string().uuid(),
  notes:     z.string().optional(),
  rejectionReason: z.string().optional(),
  disbursementRef: z.string().optional(),
})

// ── GET ───────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const groupId    = searchParams.get('groupId')
    const borrowerId = searchParams.get('borrowerId')
    const status     = searchParams.get('status')
    const loanId     = searchParams.get('loanId')

    // Single loan detail
    if (loanId) {
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
        include: {
          borrower:   { select: { id: true, fullName: true, email: true, phone: true, reputationScore: true, tier: true } },
          guarantors: { include: { user: { select: { id: true, fullName: true, email: true } } } },
          repayments: { orderBy: { installmentNo: 'asc' } },
          group:      { select: { name: true, currency: true } },
        },
      })
      if (!loan) return NextResponse.json({ success: false, error: 'Loan not found' }, { status: 404 })

      const totalPaid = loan.repayments.filter(r => r.status === 'PAID').reduce((s,r) => s + Number(r.amountPaid), 0)
      const overdue   = loan.repayments.filter(r => r.status === 'PENDING' && new Date(r.dueDate) < new Date())

      return NextResponse.json({ success: true, data: { ...formatLoan(loan), totalPaid, overdueCount: overdue.length } })
    }

    const where: any = {}
    if (groupId)    where.groupId    = groupId
    if (borrowerId) where.borrowerId = borrowerId
    if (status)     where.status     = status

    const loans = await prisma.loan.findMany({
      where,
      include: {
        borrower:   { select: { id: true, fullName: true, email: true, reputationScore: true, tier: true } },
        guarantors: { include: { user: { select: { fullName: true } } } },
        repayments: { select: { status: true, dueDate: true, totalDue: true, amountPaid: true } },
        group:      { select: { name: true, currency: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Summary stats
    const active    = loans.filter(l => ['ACTIVE','DISBURSED'].includes(l.status))
    const pending   = loans.filter(l => ['DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED'].includes(l.status))
    const totalOut  = active.reduce((s,l) => s + Number(l.outstandingBalance), 0)

    return NextResponse.json({
      success: true,
      data: {
        loans: loans.map(formatLoan),
        summary: {
          total:       loans.length,
          active:      active.length,
          pending:     pending.length,
          settled:     loans.filter(l => l.status === 'SETTLED').length,
          defaulted:   loans.filter(l => l.status === 'DEFAULTED').length,
          totalOutstanding: totalOut,
        },
      },
    })
  } catch (e: any) {
    console.error('GET /api/loans error:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── POST — create loan application ────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // ── Group-manager guard (BR 4 & 6) ────────────────────────
    // Creation carries groupId; REVIEW actions carry loanId, resolved
    // to the loan's group.
    let guardGroupId: string | null = body.groupId || null
    if (!guardGroupId && body.loanId) {
      const l = await prisma.loan.findUnique({ where: { id: body.loanId }, select: { groupId: true } })
      guardGroupId = l?.groupId ?? null
    }
    const guardErr = await requireGroupManager(req, guardGroupId)
    if (guardErr) return guardErr

    // Route to actions
    if (body.action === 'REVIEW') return handleReview(body)

    const data = createSchema.parse(body)

    // Check borrower is active member
    const membership = await prisma.groupMember.findFirst({
      where: { groupId: data.groupId, userId: data.borrowerId, status: 'ACTIVE' },
    })
    if (!membership) return NextResponse.json({ success: false, error: 'Borrower must be an active group member' }, { status: 400 })

    // Check no existing active loan
    const existingLoan = await prisma.loan.findFirst({
      where: { groupId: data.groupId, borrowerId: data.borrowerId, status: { in: ['ACTIVE','DISBURSED','PENDING_REVIEW','PENDING_APPROVAL','APPROVED'] } },
    })
    if (existingLoan) return NextResponse.json({ success: false, error: 'This member already has an active or pending loan in this group' }, { status: 409 })

    // Calculate amortisation schedule
    const monthlyRate   = data.interestRatePa / 12
    const totalInterest = data.amount * monthlyRate * data.termMonths
    const monthlyInstallment = monthlyRate > 0
      ? (data.amount * monthlyRate * Math.pow(1 + monthlyRate, data.termMonths)) / (Math.pow(1 + monthlyRate, data.termMonths) - 1)
      : data.amount / data.termMonths

    const group = await prisma.group.findUnique({ where: { id: data.groupId }, select: { currency: true } })

    const loan = await prisma.$transaction(async (tx) => {
      const loan = await tx.loan.create({
        data: {
          groupId:          data.groupId,
          borrowerId:       data.borrowerId,
          type:             data.type,
          status:           data.isEmergency ? 'PENDING_APPROVAL' : 'PENDING_REVIEW',
          amount:           data.amount,
          currency:         group!.currency,
          interestRatePa:   data.interestRatePa,
          termMonths:       data.termMonths,
          purpose:          data.purpose,
          isEmergency:      data.isEmergency,
          outstandingBalance: data.amount,
          totalInterestDue: totalInterest,
        },
      })

      // Add guarantors — fetch user details required by LoanGuarantor model
      if (data.guarantorIds?.length) {
        const guarantorUsers = await tx.user.findMany({
          where: { id: { in: data.guarantorIds } },
          select: { id: true, fullName: true, email: true, phone: true },
        })
        await tx.loanGuarantor.createMany({
          data: guarantorUsers.map(u => ({
            loanId:        loan.id,
            userId:        u.id,
            fullName:      u.fullName,
            email:         u.email || '',
            phone:         u.phone || '',
            tokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
          })),
        })
      }

      // Generate repayment schedule
      const now = new Date()
      const schedule = Array.from({ length: data.termMonths }, (_, i) => {
        const dueDate  = new Date(now.getFullYear(), now.getMonth() + i + 1, 1)
        const interest = monthlyRate > 0 ? (data.amount - (monthlyInstallment - data.amount * monthlyRate) * i) * monthlyRate : 0
        const principal = monthlyInstallment - interest
        return {
          loanId:        loan.id,
          installmentNo: i + 1,
          dueDate,
          principalDue:  Math.max(0, principal),
          interestDue:   Math.max(0, interest),
          totalDue:      monthlyInstallment,
        }
      })

      await tx.loanRepayment.createMany({ data: schedule })

      await tx.auditLog.create({
        data: { groupId: data.groupId, borrowerId: data.borrowerId, action: 'CREATE', entityType: 'Loan', entityId: loan.id,
                description: `Loan application: $${data.amount} for ${data.termMonths} months. Purpose: ${data.purpose}` } as any,
      })

      return loan
    })

    return NextResponse.json({
      success: true,
      data:    { id: loan.id, status: loan.status },
      message: `Loan application submitted. Monthly instalment: $${monthlyInstallment.toFixed(2)}`,
    }, { status: 201 })

  } catch (e: any) {
    if (e instanceof z.ZodError) return NextResponse.json({ success: false, error: e.errors.map(x => x.message).join('; ') }, { status: 400 })
    console.error('POST /api/loans error:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── Review / Approve / Disburse ───────────────────────────────
async function handleReview(body: any): Promise<NextResponse> {
  try {
    const data = reviewSchema.parse(body)
    const loan = await prisma.loan.findUnique({
      where:   { id: data.loanId },
      include: { group: { select: { currency: true } } },
    })
    if (!loan) return NextResponse.json({ success: false, error: 'Loan not found' }, { status: 404 })

    const updateData: any = {}
    let message = ''

    switch (data.action) {
      case 'TREASURER_REVIEW':
        updateData.status           = 'PENDING_APPROVAL'
        updateData.treasurerReviewAt = new Date()
        updateData.treasurerReviewBy = data.reviewerId
        updateData.treasurerNotes   = data.notes
        message = 'Loan reviewed by treasurer. Awaiting admin approval.'
        break
      case 'APPROVE':
        if (!['PENDING_APPROVAL', 'PENDING_REVIEW'].includes(loan.status)) {
          return NextResponse.json({ success: false, error: `Cannot approve loan with status: ${loan.status}` }, { status: 400 })
        }
        updateData.status          = 'APPROVED'
        updateData.adminApprovedAt = new Date()
        updateData.adminApprovedBy = data.reviewerId
        updateData.adminNotes      = data.notes
        message = 'Loan approved. Ready for disbursement.'
        break
      case 'DISBURSE':
        if (loan.status !== 'APPROVED') {
          return NextResponse.json({ success: false, error: 'Loan must be approved before disbursement' }, { status: 400 })
        }
        updateData.status           = 'ACTIVE'
        updateData.disbursedAt      = new Date()
        updateData.disbursementRef  = data.disbursementRef || `DISB-${Date.now()}`
        updateData.settlementDate   = new Date(
          new Date().getFullYear(),
          new Date().getMonth() + loan.termMonths,
          1
        )
        message = `Loan of $${loan.amount} disbursed successfully.`
        break
      case 'REJECT':
        updateData.status           = 'REJECTED'
        updateData.rejectedAt       = new Date()
        updateData.rejectedBy       = data.reviewerId
        updateData.rejectionReason  = data.rejectionReason || data.notes || 'Rejected by administrator'
        message = 'Loan application rejected.'
        break
    }

    await prisma.loan.update({ where: { id: data.loanId }, data: updateData })

    await prisma.auditLog.create({
      data: { action: 'UPDATE', entityType: 'Loan', entityId: data.loanId,
              description: `${data.action}: ${message}` } as any,
    })

    return NextResponse.json({ success: true, message })
  } catch (e: any) {
    if (e instanceof z.ZodError) return NextResponse.json({ success: false, error: e.errors.map(x => x.message).join('; ') }, { status: 400 })
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── Delete loan (temporary hard-delete — remove before go-live) ──
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const loanId = searchParams.get('loanId')
    if (!loanId) return NextResponse.json({ success: false, error: 'loanId required' }, { status: 400 })

    const loan = await prisma.loan.findUnique({
      where:  { id: loanId },
      select: { id: true, amount: true, status: true, groupId: true, borrower: { select: { fullName: true } } },
    })
    if (!loan) return NextResponse.json({ success: false, error: 'Loan not found' }, { status: 404 })

    // ── Group-manager guard ────────────────────────────────────
    const guardErr = await requireGroupManager(req, loan.groupId)
    if (guardErr) return guardErr

    await prisma.$transaction(async (tx) => {
      await tx.loanRepayment.deleteMany({ where: { loanId } })
      await tx.loanGuarantor.deleteMany({ where: { loanId } })
      await tx.loan.delete({ where: { id: loanId } })
    })

    return NextResponse.json({
      success: true,
      message: `Loan for ${loan.borrower?.fullName || 'member'} ($${Number(loan.amount).toFixed(2)}) has been permanently deleted.`,
    })
  } catch (e: any) {
    console.error('DELETE /api/loans error:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── Format helper ─────────────────────────────────────────────
function formatLoan(l: any) {
  const now      = new Date()
  const overdue  = (l.repayments || []).filter((r: any) => r.status !== 'PAID' && r.status !== 'WAIVED' && new Date(r.dueDate) < now)
  const progress = Number(l.amount) > 0
    ? Math.round((Number(l.amount) - Number(l.outstandingBalance)) / Number(l.amount) * 100)
    : 0

  return {
    id:               l.id,
    groupId:          l.groupId,
    groupName:        l.group?.name,
    currency:         l.group?.currency || l.currency,
    borrowerId:       l.borrowerId,
    borrowerName:     l.borrower?.fullName,
    borrowerEmail:    l.borrower?.email,
    borrowerTier:     l.borrower?.tier,
    borrowerScore:    Number(l.borrower?.reputationScore || 0),
    type:             l.type,
    status:           l.status,
    amount:           Number(l.amount),
    interestRatePa:   Number(l.interestRatePa),
    interestRatePct:  (Number(l.interestRatePa) * 100).toFixed(1),
    termMonths:       l.termMonths,
    purpose:          l.purpose,
    isEmergency:      l.isEmergency,
    outstandingBalance: Number(l.outstandingBalance),
    totalInterestDue: Number(l.totalInterestDue),
    totalInterestPaid: Number(l.totalInterestPaid),
    disbursedAt:      l.disbursedAt,
    settlementDate:   l.settlementDate,
    settledAt:        l.settledAt,
    rejectionReason:  l.rejectionReason,
    treasurerNotes:   l.treasurerNotes,
    adminNotes:       l.adminNotes,
    guarantors:       (l.guarantors || []).map((g: any) => ({ userId: g.userId, fullName: g.user?.fullName, acceptedAt: g.acceptedAt })),
    repayments:       (l.repayments || []).map((r: any) => ({
      id:            r.id,
      installmentNo: r.installmentNo,
      dueDate:       r.dueDate,
      principalDue:  Number(r.principalDue),
      interestDue:   Number(r.interestDue),
      totalDue:      Number(r.totalDue),
      amountPaid:    Number(r.amountPaid),
      status:        r.status,
      paidAt:        r.paidAt,
      paymentRef:    r.paymentRef,
      isOverdue:     r.status !== 'PAID' && r.status !== 'WAIVED' && new Date(r.dueDate) < now,
    })),
    repaymentProgress: progress,
    overdueCount:     overdue.length,
    createdAt:        l.createdAt,
    monthlyInstalment: l.termMonths > 0
      ? ((Number(l.amount) + Number(l.totalInterestDue)) / l.termMonths).toFixed(2)
      : '0.00',
  }
}
