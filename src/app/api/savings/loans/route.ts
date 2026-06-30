// src/app/api/savings/loans/route.ts — v2.2 (raw SQL)
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'

async function sql(query: string, params: any[] = []) {
  return prisma.$queryRawUnsafe(query, ...params) as Promise<any[]>
}
async function exec(query: string, params: any[] = []) {
  return prisma.$executeRawUnsafe(query, ...params)
}

const applySchema = z.object({
  poolId:     z.string().uuid(),
  borrowerId: z.string().uuid(),
  amount:     z.coerce.number().positive(),
  termMonths: z.coerce.number().int().min(1).max(24),
  purpose:    z.string().min(5),
})

function formatLoan(l: any) {
  const now = new Date()
  return {
    id:                 l.id,
    poolId:             l.poolId,
    poolName:           l.poolName,
    currency:           l.currency,
    borrowerId:         l.borrowerId,
    borrowerName:       l.borrowerName || l.fullName,
    borrowerEmail:      l.borrowerEmail || l.email,
    amount:             Number(l.amount),
    outstandingBalance: Number(l.outstandingBalance),
    totalInterestDue:   Number(l.totalInterestDue),
    totalInterestPaid:  Number(l.totalInterestPaid),
    interestRatePct:    (Number(l.interestRatePa) * 100).toFixed(1),
    termMonths:         Number(l.termMonths),
    purpose:            l.purpose,
    status:             l.status,
    repaymentProgress:  Number(l.amount) > 0
      ? Math.round((Number(l.amount) - Number(l.outstandingBalance)) / Number(l.amount) * 100) : 0,
    overdueCount:       (l.repayments || []).filter((r: any) => r.status !== 'PAID' && new Date(r.dueDate) < now).length,
    approvedAt:         l.approvedAt,
    disbursedAt:        l.disbursedAt,
    settledAt:          l.settledAt,
    rejectionReason:    l.rejectionReason,
    repayments:         (l.repayments || []).map((r: any) => ({
      id:            r.id,
      installmentNo: Number(r.installmentNo),
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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const poolId = searchParams.get('poolId')
    const loanId = searchParams.get('loanId')

    if (loanId) {
      const loans = await sql(
        `SELECT sl.*, u."fullName", u.email, sp.name as "poolName", sp.currency
         FROM "SavingsLoan" sl
         JOIN "User" u ON u.id = sl."borrowerId"
         JOIN "SavingsPool" sp ON sp.id = sl."poolId"
         WHERE sl.id = $1`, [loanId]
      )
      if (!loans.length) return NextResponse.json({ success: false, error: 'Loan not found' }, { status: 404 })
      const loan = loans[0]
      loan.repayments = await sql(
        `SELECT * FROM "SavingsLoanRepayment" WHERE "loanId"=$1 ORDER BY "installmentNo"`, [loanId]
      )
      return NextResponse.json({ success: true, data: formatLoan(loan) })
    }

    if (!poolId) return NextResponse.json({ success: false, error: 'poolId required' }, { status: 400 })

    const loans = await sql(
      `SELECT sl.*, u."fullName", u.email, sp.name as "poolName", sp.currency
       FROM "SavingsLoan" sl
       JOIN "User" u ON u.id = sl."borrowerId"
       JOIN "SavingsPool" sp ON sp.id = sl."poolId"
       WHERE sl."poolId" = $1
       ORDER BY sl."createdAt" DESC`, [poolId]
    )

    for (const loan of loans) {
      loan.repayments = await sql(
        `SELECT * FROM "SavingsLoanRepayment" WHERE "loanId"=$1 ORDER BY "installmentNo"`, [loan.id]
      )
    }

    return NextResponse.json({ success: true, data: loans.map(formatLoan) })
  } catch (e: any) {
    console.error('GET /api/savings/loans error:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (body.action === 'APPROVE')  return handleApprove(body)
    if (body.action === 'REJECT')   return handleReject(body)
    if (body.action === 'DISBURSE') return handleDisburse(body)
    if (body.action === 'REPAY')    return handleRepay(body)

    const data = applySchema.parse(body)
    const pools = await sql(`SELECT * FROM "SavingsPool" WHERE id=$1`, [data.poolId])
    if (!pools.length) return NextResponse.json({ success: false, error: 'Pool not found' }, { status: 404 })
    const pool = pools[0]

    if (!pool.allowLoans)         return NextResponse.json({ success: false, error: 'Loans are not enabled for this pool' }, { status: 400 })
    if (pool.status !== 'ACTIVE') return NextResponse.json({ success: false, error: 'Pool must be active to take loans' }, { status: 400 })

    const memberCheck = await sql(
      `SELECT id FROM "SavingsPoolMember" WHERE "poolId"=$1 AND "userId"=$2 AND "isActive"=true`,
      [data.poolId, data.borrowerId]
    )
    if (!memberCheck.length) return NextResponse.json({ success: false, error: 'Only pool members can borrow' }, { status: 400 })

    const maxAmount = Number(pool.totalPoolValue) * Number(pool.maxLoanPct)
    if (data.amount > maxAmount) {
      return NextResponse.json({
        success: false,
        error: `Maximum loan is $${maxAmount.toFixed(2)} (${(Number(pool.maxLoanPct)*100).toFixed(0)}% of $${Number(pool.totalPoolValue).toFixed(2)} pool)`,
      }, { status: 400 })
    }

    const existing = await sql(
      `SELECT id FROM "SavingsLoan" WHERE "poolId"=$1 AND "borrowerId"=$2 AND status IN ('ACTIVE','PENDING_APPROVAL','APPROVED')`,
      [data.poolId, data.borrowerId]
    )
    if (existing.length) return NextResponse.json({ success: false, error: 'Member already has an active loan from this pool' }, { status: 409 })

    const monthlyRate   = Number(pool.interestRatePa) / 12
    const totalInterest = data.amount * monthlyRate * data.termMonths
    const monthly       = monthlyRate > 0
      ? (data.amount * monthlyRate * Math.pow(1+monthlyRate,data.termMonths)) / (Math.pow(1+monthlyRate,data.termMonths)-1)
      : data.amount / data.termMonths

    const loanId = crypto.randomUUID()
    await exec(
      `INSERT INTO "SavingsLoan" (id,"poolId","borrowerId",amount,currency,"interestRatePa","termMonths",purpose,status,"outstandingBalance","totalInterestDue","totalInterestPaid","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5::"CurrencyCode",$6,$7,$8,'PENDING_APPROVAL'::"LoanStatus",$4,$9,0,NOW(),NOW())`,
      [loanId, data.poolId, data.borrowerId, data.amount, pool.currency, pool.interestRatePa, data.termMonths, data.purpose, totalInterest]
    )

    for (let i = 1; i <= data.termMonths; i++) {
      const dueDate = new Date()
      dueDate.setMonth(dueDate.getMonth() + i)
      const interest  = monthlyRate > 0 ? (data.amount - (monthly - data.amount * monthlyRate) * (i-1)) * monthlyRate : 0
      const principal = monthly - interest
      const repayId   = crypto.randomUUID()
      await exec(
        `INSERT INTO "SavingsLoanRepayment" (id,"loanId","installmentNo","dueDate","principalDue","interestDue","totalDue","amountPaid",status,"createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,0,'PENDING'::"SavingsContributionStatus",NOW(),NOW())`,
        [repayId, loanId, i, dueDate, Math.max(0,principal), Math.max(0,interest), monthly]
      )
    }

    return NextResponse.json({
      success: true,
      data:    { id: loanId },
      message: `Loan application submitted. Monthly instalment: $${monthly.toFixed(2)}`,
    }, { status: 201 })

  } catch (e: any) {
    if (e instanceof z.ZodError) return NextResponse.json({ success: false, error: e.errors.map(x => x.message).join('; ') }, { status: 400 })
    console.error('POST /api/savings/loans error:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

async function handleApprove(body: any): Promise<NextResponse> {
  await exec(
    `UPDATE "SavingsLoan" SET status='APPROVED',"approvedAt"=NOW(),"approvedById"=$1,notes=$2,"updatedAt"=NOW() WHERE id=$3`,
    [body.approvedById || null, body.notes || null, body.loanId]
  )
  return NextResponse.json({ success: true, message: 'Loan approved. Ready to disburse.' })
}

async function handleReject(body: any): Promise<NextResponse> {
  await exec(
    `UPDATE "SavingsLoan" SET status='REJECTED',"rejectedAt"=NOW(),"rejectionReason"=$1,"updatedAt"=NOW() WHERE id=$2`,
    [body.reason || 'Rejected', body.loanId]
  )
  return NextResponse.json({ success: true, message: 'Loan rejected.' })
}

async function handleDisburse(body: any): Promise<NextResponse> {
  const loans = await sql(`SELECT * FROM "SavingsLoan" WHERE id=$1`, [body.loanId])
  if (!loans.length || loans[0].status !== 'APPROVED') {
    return NextResponse.json({ success: false, error: 'Loan must be approved first' }, { status: 400 })
  }
  const loan = loans[0]
  await exec(
    `UPDATE "SavingsLoan" SET status='ACTIVE',"disbursedAt"=NOW(),"updatedAt"=NOW() WHERE id=$1`,
    [body.loanId]
  )
  const txId = crypto.randomUUID()
  await exec(
    `INSERT INTO "Transaction" (id,type,status,amount,currency,description,reference,"paymentMethod","userId","createdAt")
     VALUES ($1,'LOAN_DISBURSEMENT'::"TransactionType",'COMPLETED'::"TransactionStatus",$2,$3::"CurrencyCode",'Savings pool loan disbursement',$4,'BANK_TRANSFER'::"PaymentMethod",$5,NOW())`,
    [txId, loan.amount, loan.currency, body.disbursementRef || `SLOAN-${Date.now()}`, loan.borrowerId]
  )
  return NextResponse.json({ success: true, message: `$${Number(loan.amount).toFixed(2)} disbursed.` })
}

async function handleRepay(body: any): Promise<NextResponse> {
  const { loanId, repaymentId, amountPaid, paymentMethod, paymentRef } = body

  const [loans, repayments] = await Promise.all([
    sql(`SELECT * FROM "SavingsLoan" WHERE id=$1`, [loanId]),
    sql(`SELECT * FROM "SavingsLoanRepayment" WHERE id=$1`, [repaymentId]),
  ])
  if (!loans.length || !repayments.length) {
    return NextResponse.json({ success: false, error: 'Loan or repayment not found' }, { status: 404 })
  }
  const loan      = loans[0]
  const repayment = repayments[0]

  const isFullPaid     = amountPaid >= Number(repayment.totalDue)
  const newOutstanding = Math.max(0, Number(loan.outstandingBalance) - amountPaid)
  const interestPortion = Math.min(amountPaid, Number(repayment.interestDue))

  await exec(
    `UPDATE "SavingsLoanRepayment" SET "amountPaid"="amountPaid"+$1, status=$2::"SavingsContributionStatus", "paidAt"=$3, "paymentRef"=$4, "updatedAt"=NOW() WHERE id=$5`,
    [amountPaid, isFullPaid ? 'PAID' : 'PENDING', isFullPaid ? new Date() : null, paymentRef || null, repaymentId]
  )
  await exec(
    `UPDATE "SavingsLoan" SET "outstandingBalance"=$1,"totalInterestPaid"="totalInterestPaid"+$2,status=$3::"LoanStatus","settledAt"=$4,"updatedAt"=NOW() WHERE id=$5`,
    [newOutstanding, interestPortion, newOutstanding <= 0 ? 'SETTLED' : 'ACTIVE', newOutstanding <= 0 ? new Date() : null, loanId]
  )

  if (interestPortion > 0) {
    await exec(
      `UPDATE "SavingsPool" SET "totalInterestEarned"="totalInterestEarned"+$1,"totalPoolValue"="totalPoolValue"+$1,"updatedAt"=NOW() WHERE id=$2`,
      [interestPortion, loan.poolId]
    )
    await exec(
      `UPDATE "SavingsPoolMember" SET "loanBalance"=$1,"updatedAt"=NOW() WHERE "poolId"=$2 AND "userId"=$3`,
      [newOutstanding, loan.poolId, loan.borrowerId]
    )
  }

  const msg = newOutstanding <= 0 ? '🎉 Pool loan fully repaid!' : `Payment recorded. Outstanding: $${newOutstanding.toFixed(2)}`
  return NextResponse.json({ success: true, message: msg, data: { newOutstanding, isSettled: newOutstanding <= 0 } })
}
