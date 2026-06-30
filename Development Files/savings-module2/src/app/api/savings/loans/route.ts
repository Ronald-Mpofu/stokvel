// src/app/api/savings/loans/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'

const applySchema = z.object({
  poolId:     z.string().uuid(),
  borrowerId: z.string().uuid(),
  amount:     z.coerce.number().positive(),
  termMonths: z.coerce.number().int().min(1).max(24),
  purpose:    z.string().min(5),
})

// GET — loans for a pool
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const poolId  = searchParams.get('poolId')
    const loanId  = searchParams.get('loanId')

    if (loanId) {
      const loan = await prisma.savingsLoan.findUnique({
        where:   { id: loanId },
        include: {
          borrower:   { select: { fullName: true, email: true } },
          repayments: { orderBy: { installmentNo: 'asc' } },
          pool:       { select: { name: true, currency: true } },
        },
      })
      if (!loan) return NextResponse.json({ success: false, error: 'Loan not found' }, { status: 404 })
      return NextResponse.json({ success: true, data: formatLoan(loan) })
    }

    if (!poolId) return NextResponse.json({ success: false, error: 'poolId required' }, { status: 400 })

    const loans = await prisma.savingsLoan.findMany({
      where:   { poolId },
      include: {
        borrower:   { select: { fullName: true, email: true } },
        repayments: { select: { status: true, dueDate: true, totalDue: true, amountPaid: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ success: true, data: loans.map(formatLoan) })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// POST — apply / approve / disburse / repay
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (body.action === 'APPROVE')  return handleApprove(body)
    if (body.action === 'REJECT')   return handleReject(body)
    if (body.action === 'DISBURSE') return handleDisburse(body)
    if (body.action === 'REPAY')    return handleRepay(body)

    // Apply for loan
    const data = applySchema.parse(body)
    const pool = await prisma.savingsPool.findUnique({
      where:   { id: data.poolId },
      include: { members: { where: { userId: data.borrowerId } } },
    })

    if (!pool)                 return NextResponse.json({ success: false, error: 'Pool not found' }, { status: 404 })
    if (!pool.allowLoans)      return NextResponse.json({ success: false, error: 'Loans are not enabled for this pool' }, { status: 400 })
    if (pool.status !== 'ACTIVE') return NextResponse.json({ success: false, error: 'Pool must be active to take loans' }, { status: 400 })
    if (!pool.members.length)  return NextResponse.json({ success: false, error: 'Only pool members can borrow' }, { status: 400 })

    // Check against max loan limit
    const maxAmount = Number(pool.totalPoolValue) * Number(pool.maxLoanPct)
    if (data.amount > maxAmount) {
      return NextResponse.json({ success: false, error: `Maximum loan amount is $${maxAmount.toFixed(2)} (${(Number(pool.maxLoanPct)*100).toFixed(0)}% of pool value $${Number(pool.totalPoolValue).toFixed(2)})` }, { status: 400 })
    }

    // Check no active loan
    const existing = await prisma.savingsLoan.findFirst({
      where: { poolId: data.poolId, borrowerId: data.borrowerId, status: { in: ['ACTIVE','PENDING_APPROVAL','APPROVED'] } },
    })
    if (existing) return NextResponse.json({ success: false, error: 'Member already has an active loan from this pool' }, { status: 409 })

    // Calculate schedule
    const monthlyRate = Number(pool.interestRatePa) / 12
    const totalInterest = data.amount * monthlyRate * data.termMonths
    const monthly = monthlyRate > 0
      ? (data.amount * monthlyRate * Math.pow(1+monthlyRate,data.termMonths)) / (Math.pow(1+monthlyRate,data.termMonths)-1)
      : data.amount / data.termMonths

    const loan = await prisma.$transaction(async (tx) => {
      const loan = await tx.savingsLoan.create({
        data: {
          poolId:            data.poolId,
          borrowerId:        data.borrowerId,
          amount:            data.amount,
          currency:          pool.currency,
          interestRatePa:    pool.interestRatePa,
          termMonths:        data.termMonths,
          purpose:           data.purpose,
          outstandingBalance: data.amount,
          totalInterestDue:  totalInterest,
        },
      })

      // Repayment schedule
      const schedule = Array.from({ length: data.termMonths }, (_, i) => {
        const dueDate   = new Date()
        dueDate.setMonth(dueDate.getMonth() + i + 1)
        const interest  = monthlyRate > 0 ? (data.amount - (monthly - data.amount * monthlyRate) * i) * monthlyRate : 0
        const principal = monthly - interest
        return { loanId: loan.id, installmentNo: i+1, dueDate, principalDue: Math.max(0,principal), interestDue: Math.max(0,interest), totalDue: monthly }
      })

      await tx.savingsLoanRepayment.createMany({ data: schedule })
      return loan
    })

    return NextResponse.json({
      success: true,
      data:    { id: loan.id },
      message: `Loan application submitted. Monthly instalment: $${monthly.toFixed(2)}`,
    }, { status: 201 })

  } catch (e: any) {
    if (e instanceof z.ZodError) return NextResponse.json({ success: false, error: e.errors.map(x => x.message).join('; ') }, { status: 400 })
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

async function handleApprove(body: any): Promise<NextResponse> {
  await prisma.savingsLoan.update({
    where: { id: body.loanId },
    data:  { status: 'APPROVED', approvedAt: new Date(), approvedById: body.approvedById, notes: body.notes },
  })
  return NextResponse.json({ success: true, message: 'Loan approved. Ready to disburse.' })
}

async function handleReject(body: any): Promise<NextResponse> {
  await prisma.savingsLoan.update({
    where: { id: body.loanId },
    data:  { status: 'REJECTED', rejectedAt: new Date(), rejectionReason: body.reason },
  })
  return NextResponse.json({ success: true, message: 'Loan rejected.' })
}

async function handleDisburse(body: any): Promise<NextResponse> {
  const loan = await prisma.savingsLoan.findUnique({ where: { id: body.loanId } })
  if (!loan || loan.status !== 'APPROVED') return NextResponse.json({ success: false, error: 'Loan must be approved first' }, { status: 400 })

  await prisma.$transaction([
    prisma.savingsLoan.update({
      where: { id: body.loanId },
      data:  { status: 'ACTIVE', disbursedAt: new Date() },
    }),
    prisma.transaction.create({
      data: {
        type:          'LOAN_DISBURSEMENT',
        status:        'COMPLETED',
        amount:        loan.amount,
        currency:      loan.currency,
        description:   `Savings pool loan disbursement`,
        reference:     body.disbursementRef || `SLOAN-${Date.now()}`,
        paymentMethod: 'BANK_TRANSFER' as any,
        userId:        loan.borrowerId,
      },
    }),
  ])

  return NextResponse.json({ success: true, message: `$${Number(loan.amount).toFixed(2)} disbursed to borrower.` })
}

async function handleRepay(body: any): Promise<NextResponse> {
  const { loanId, repaymentId, amountPaid, paymentMethod, paymentRef } = body

  const [loan, repayment] = await Promise.all([
    prisma.savingsLoan.findUnique({ where: { id: loanId } }),
    prisma.savingsLoanRepayment.findUnique({ where: { id: repaymentId } }),
  ])

  if (!loan || !repayment) return NextResponse.json({ success: false, error: 'Loan or repayment not found' }, { status: 404 })

  const isFullyPaid    = amountPaid >= Number(repayment.totalDue)
  const newOutstanding = Math.max(0, Number(loan.outstandingBalance) - amountPaid)
  const interestPortion = Math.min(amountPaid, Number(repayment.interestDue))

  await prisma.$transaction(async (tx) => {
    await tx.savingsLoanRepayment.update({
      where: { id: repaymentId },
      data:  { amountPaid: { increment: amountPaid }, status: isFullyPaid ? 'PAID' : 'PENDING', paidAt: isFullyPaid ? new Date() : undefined, paymentRef },
    })
    await tx.savingsLoan.update({
      where: { id: loanId },
      data: {
        outstandingBalance: newOutstanding,
        totalInterestPaid:  { increment: interestPortion },
        status: newOutstanding <= 0 ? 'SETTLED' : 'ACTIVE',
        settledAt: newOutstanding <= 0 ? new Date() : undefined,
      },
    })
    // Interest flows back into pool
    if (interestPortion > 0) {
      await tx.savingsPool.update({
        where: { id: loan.poolId },
        data: {
          totalInterestEarned: { increment: interestPortion },
          totalPoolValue:      { increment: interestPortion },
        },
      })
      // Update borrower's loan balance in membership
      await tx.savingsPoolMember.updateMany({
        where: { poolId: loan.poolId, userId: loan.borrowerId },
        data:  { loanBalance: newOutstanding },
      })
    }
  })

  const msg = newOutstanding <= 0 ? '🎉 Pool loan fully repaid!' : `Payment recorded. Outstanding: $${newOutstanding.toFixed(2)}`
  return NextResponse.json({ success: true, message: msg, data: { newOutstanding, isSettled: newOutstanding <= 0 } })
}

function formatLoan(l: any) {
  const now     = new Date()
  const progress = Number(l.amount) > 0
    ? Math.round((Number(l.amount) - Number(l.outstandingBalance)) / Number(l.amount) * 100) : 0

  return {
    id:                l.id,
    poolId:            l.poolId,
    poolName:          l.pool?.name,
    currency:          l.pool?.currency || l.currency,
    borrowerId:        l.borrowerId,
    borrowerName:      l.borrower?.fullName,
    borrowerEmail:     l.borrower?.email,
    amount:            Number(l.amount),
    outstandingBalance: Number(l.outstandingBalance),
    totalInterestDue:  Number(l.totalInterestDue),
    totalInterestPaid: Number(l.totalInterestPaid),
    interestRatePct:   (Number(l.interestRatePa) * 100).toFixed(1),
    termMonths:        l.termMonths,
    purpose:           l.purpose,
    status:            l.status,
    repaymentProgress: progress,
    overdueCount:      (l.repayments||[]).filter((r: any) => r.status !== 'PAID' && new Date(r.dueDate) < now).length,
    approvedAt:        l.approvedAt,
    disbursedAt:       l.disbursedAt,
    settledAt:         l.settledAt,
    rejectionReason:   l.rejectionReason,
    repayments:        (l.repayments||[]).map((r: any) => ({
      id:            r.id,
      installmentNo: r.installmentNo,
      dueDate:       r.dueDate,
      principalDue:  Number(r.principalDue),
      interestDue:   Number(r.interestDue),
      totalDue:      Number(r.totalDue),
      amountPaid:    Number(r.amountPaid),
      status:        r.status,
      paidAt:        r.paidAt,
      isOverdue:     r.status !== 'PAID' && new Date(r.dueDate) < now,
    })),
    createdAt: l.createdAt,
  }
}
