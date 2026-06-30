// src/app/api/loans/repayments/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'

const repaySchema = z.object({
  loanId:        z.string().uuid(),
  repaymentId:   z.string().uuid(),
  amountPaid:    z.coerce.number().positive(),
  paymentMethod: z.string().default('ECOCASH'),
  paymentRef:    z.string().optional(),
  recordedById:  z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const data = repaySchema.parse(await req.json())

    const [loan, repayment] = await Promise.all([
      prisma.loan.findUnique({ where: { id: data.loanId } }),
      prisma.loanRepayment.findUnique({ where: { id: data.repaymentId } }),
    ])

    if (!loan)      return NextResponse.json({ success: false, error: 'Loan not found' }, { status: 404 })
    if (!repayment) return NextResponse.json({ success: false, error: 'Repayment not found' }, { status: 404 })
    if (!['ACTIVE','DISBURSED'].includes(loan.status)) {
      return NextResponse.json({ success: false, error: `Cannot record repayment for loan with status: ${loan.status}` }, { status: 400 })
    }

    const isFullyPaid    = data.amountPaid >= Number(repayment.totalDue)
    const newOutstanding = Math.max(0, Number(loan.outstandingBalance) - data.amountPaid)
    const interestPortion = Math.min(data.amountPaid, Number(repayment.interestDue))

    await prisma.$transaction([
      // Update repayment record
      prisma.loanRepayment.update({
        where: { id: data.repaymentId },
        data: {
          amountPaid: { increment: data.amountPaid },
          status:     isFullyPaid ? 'PAID' : 'PENDING',
          paidAt:     isFullyPaid ? new Date() : undefined,
          paymentRef: data.paymentRef,
        },
      }),
      // Update loan outstanding balance
      prisma.loan.update({
        where: { id: data.loanId },
        data: {
          outstandingBalance: newOutstanding,
          totalInterestPaid:  { increment: interestPortion },
          status: newOutstanding <= 0 ? 'SETTLED' : 'ACTIVE',
          settledAt: newOutstanding <= 0 ? new Date() : undefined,
        },
      }),
      // Transaction record
      prisma.transaction.create({
        data: {
          type:          'LOAN_REPAYMENT',
          status:        'COMPLETED',
          amount:        data.amountPaid,
          currency:      loan.currency,
          loanId:        data.loanId,
          description:   `Loan repayment — Instalment #${repayment.installmentNo}`,
          reference:     data.paymentRef || `REPAY-${Date.now()}`,
          paymentMethod: data.paymentMethod as any,
        },
      }),
    ])

    const statusMsg = newOutstanding <= 0
      ? '🎉 Loan fully settled!'
      : `Payment recorded. Outstanding: $${newOutstanding.toFixed(2)}`

    return NextResponse.json({ success: true, message: statusMsg, data: { newOutstanding, isSettled: newOutstanding <= 0 } })
  } catch (e: any) {
    if (e instanceof z.ZodError) return NextResponse.json({ success: false, error: e.errors.map(x => x.message).join('; ') }, { status: 400 })
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
