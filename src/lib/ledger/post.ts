// src/lib/ledger/post.ts
//
// Posts a confirmed payment to the general ledger.
//
// THIS IS THE FIRST CODE ON THE PLATFORM THAT WRITES LedgerEntry.
// LedgerAccount and LedgerEntry have been in schema.prisma since the
// beginning and have never held a row.
//
// WHAT A MEMBER-TO-MEMBER PAYMENT POSTS, AND WHY NO CASH ACCOUNT MOVES
//   In a rotating pool member A pays member B directly. Windfall never
//   receives the money, and neither does the group. So there is no cash
//   to debit — posting to a bank account would assert the group holds
//   funds it has never seen, which is exactly the claim the custody
//   document set out to avoid making.
//
//   The honest entry records an OBLIGATION SETTLING:
//     DR  2000 Member Funds              payer's obligation discharged
//     CR  1000 Contributions Receivable  invoice cleared
//
//   A maturity pool is different: money genuinely lands in the group's
//   own account, so the debit goes to 1100 Group Bank Account instead.
//
// IDEMPOTENT
//   postedAt and transactionId are set on the payment. A payment that
//   has already posted is skipped, so a retried confirmation or a
//   re-run sweep cannot double-post and unbalance the ledger.

import { randomUUID } from 'crypto'
import prisma from '@/lib/prisma/client'
import { ensureChartOfAccounts, ACC, periodOf } from './accounts'

async function sql(query: string, params: any[] = []) {
  return prisma.$queryRawUnsafe(query, ...params) as Promise<any[]>
}
async function exec(query: string, params: any[] = []) {
  return prisma.$executeRawUnsafe(query, ...params)
}

export interface PostResult {
  posted: boolean
  transactionId?: string
  reason?: string
}

/**
 * Posts one confirmed payment to the GL.
 * Returns { posted: false, reason } rather than throwing — a posting
 * failure must never roll back a confirmation the recipient has already
 * given. Unposted payments are picked up by the sweep.
 */
export async function postPaymentToLedger(paymentId: string): Promise<PostResult> {
  const rows = await sql(
    `SELECT lp.id, lp."groupId", lp."payerId", lp."payeeType", lp."payeeId",
            lp.currency, lp.amount, lp.method, lp.reference, lp.status,
            lp."postedAt", lp."paymentNumber", lp."paidAt",
            payer."fullName" AS "payerName",
            payee."fullName" AS "payeeName"
       FROM "LedgerPayment" lp
       JOIN "User" payer ON payer.id = lp."payerId"
       LEFT JOIN "User" payee ON payee.id = lp."payeeId"
      WHERE lp.id = $1 LIMIT 1`,
    [paymentId],
  )
  if (!rows.length) return { posted: false, reason: 'Payment not found' }
  const p = rows[0]

  if (p.status !== 'CONFIRMED') return { posted: false, reason: 'Payment is not confirmed' }
  if (p.postedAt)               return { posted: false, reason: 'Already posted' }

  const accounts = await ensureChartOfAccounts(p.groupId)

  // Member-to-member settles an obligation; group-payee brings cash in.
  const isMemberToMember = p.payeeType === 'MEMBER'
  const debitCode  = isMemberToMember ? ACC.MEMBER_FUNDS : ACC.GROUP_BANK
  const creditCode = ACC.CONTRIBUTIONS_RECEIVABLE

  const debitAccountId  = accounts.get(debitCode)
  const creditAccountId = accounts.get(creditCode)
  if (!debitAccountId || !creditAccountId) {
    return { posted: false, reason: `Chart of accounts missing ${debitCode} or ${creditCode}` }
  }

  const amount      = Number(p.amount)
  const period      = periodOf(p.paidAt)
  const description = isMemberToMember
    ? `${p.paymentNumber} — ${p.payerName} to ${p.payeeName}`
    : `${p.paymentNumber} — ${p.payerName} contribution received`

  try {
    // One transaction, two entries, and the payment stamped posted.
    // Wrapped so a partial write cannot leave a half-posted pair: an
    // unbalanced ledger is worse than an unposted payment.
    await prisma.$transaction(async (tx) => {
      const txnId = randomUUID()

      await tx.transaction.create({
        data: {
          id:            txnId,
          type:          'CONTRIBUTION',
          status:        'COMPLETED',
          amount:        amount,
          currency:      p.currency as any,
          description,
          reference:     p.paymentNumber,
          paymentMethod: (p.method === 'CASH' ? 'INTERNAL_TRANSFER' : p.method) as any,
          groupId:       p.groupId,
          userId:        p.payerId,
          metadata: {
            ledgerPaymentId: p.id,
            payeeType:       p.payeeType,
            payeeId:         p.payeeId,
            settlement:      isMemberToMember ? 'MEMBER_TO_MEMBER' : 'TO_GROUP',
          },
        },
      })

      await tx.ledgerEntry.createMany({
        data: [
          {
            id: randomUUID(), accountId: debitAccountId, transactionId: txnId,
            entryType: 'DEBIT', amount, currency: p.currency as any,
            description, period,
          },
          {
            id: randomUUID(), accountId: creditAccountId, transactionId: txnId,
            entryType: 'CREDIT', amount, currency: p.currency as any,
            description, period,
          },
        ],
      })

      await tx.$executeRawUnsafe(
        `UPDATE "LedgerPayment"
            SET "transactionId" = $2, "postedAt" = CURRENT_TIMESTAMP,
                "updatedAt" = CURRENT_TIMESTAMP
          WHERE id = $1`,
        p.id, txnId,
      )

      return txnId
    })

    const back = await sql(`SELECT "transactionId" FROM "LedgerPayment" WHERE id = $1`, [p.id])
    return { posted: true, transactionId: back[0]?.transactionId }
  } catch (e: any) {
    console.error('GL posting failed:', e?.message, paymentId)
    return { posted: false, reason: e?.message || 'Posting failed' }
  }
}

/**
 * Sweeps confirmed-but-unposted payments.
 * Exists because posting is deliberately non-fatal at confirmation
 * time: if the GL write fails, the member's confirmation still stands
 * and this catches up later.
 */
export async function postPendingPayments(limit = 100): Promise<{ posted: number; failed: number }> {
  const pending = await sql(
    `SELECT id FROM "LedgerPayment"
      WHERE status = 'CONFIRMED' AND "postedAt" IS NULL
      ORDER BY "confirmedAt" ASC
      LIMIT ${Math.min(limit, 500)}`,
  )

  let posted = 0, failed = 0
  for (const row of pending) {
    const r = await postPaymentToLedger(row.id)
    if (r.posted) posted++; else failed++
  }
  return { posted, failed }
}

/**
 * Applies a payment to invoices and moves their status.
 *
 * Allocation is oldest-due-first, which is what a member expects: money
 * paid clears the longest-standing arrear, not the newest bill.
 * Over-payment is left unallocated rather than forced onto a future
 * invoice — an unallocated credit is visible and correctable, whereas a
 * silent prepayment is neither.
 */
export async function allocatePaymentToInvoices(
  paymentId: string,
  invoiceIds: string[] | null,
  createdById?: string | null,
): Promise<{ allocated: number; remaining: number }> {
  const pRows = await sql(
    `SELECT id, "groupId", "payerId", "payeeId", "payeeType", amount, "amountAllocated", currency
       FROM "LedgerPayment" WHERE id = $1 LIMIT 1`,
    [paymentId],
  )
  if (!pRows.length) throw new Error('Payment not found')
  const pay = pRows[0]

  let remaining = Number(pay.amount) - Number(pay.amountAllocated)
  if (remaining <= 0) return { allocated: 0, remaining: 0 }

  // Candidate invoices: same payer, same counterparty, still owing.
  // Explicit ids win; otherwise oldest due date first.
  const filterById = invoiceIds && invoiceIds.length > 0
  const invoices = await sql(
    `SELECT id, total, "amountAllocated", (total - "amountAllocated") AS outstanding
       FROM "LedgerInvoice"
      WHERE "payerId" = $1
        AND "groupId" = $2
        AND currency  = $3
        AND status IN ('ISSUED','DUE','PART_PAID','OVERDUE')
        AND (total - "amountAllocated") > 0
        ${filterById ? `AND id = ANY($4::text[])` : ''}
      ORDER BY "dueDate" ASC, "invoiceSeq" ASC`,
    filterById
      ? [pay.payerId, pay.groupId, pay.currency, invoiceIds]
      : [pay.payerId, pay.groupId, pay.currency],
  )

  let allocatedCount = 0
  for (const inv of invoices) {
    if (remaining <= 0) break
    const outstanding = Number(inv.outstanding)
    const apply = Math.min(outstanding, remaining)
    if (apply <= 0) continue

    await exec(
      `INSERT INTO "LedgerAllocation" (id, "paymentId", "invoiceId", amount, "createdById")
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT ("paymentId","invoiceId") DO NOTHING`,
      [randomUUID(), paymentId, inv.id, apply, createdById || null],
    )

    await exec(
      `UPDATE "LedgerInvoice"
          SET "amountAllocated" = "amountAllocated" + $2,
              status = CASE
                WHEN "amountAllocated" + $2 >= total THEN 'PAID'
                ELSE 'PART_PAID'
              END,
              "settledAt" = CASE
                WHEN "amountAllocated" + $2 >= total THEN CURRENT_TIMESTAMP
                ELSE "settledAt"
              END,
              "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [inv.id, apply],
    )

    remaining -= apply
    allocatedCount++
  }

  await exec(
    `UPDATE "LedgerPayment"
        SET "amountAllocated" = $2, "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [paymentId, Number(pay.amount) - remaining],
  )

  return { allocated: allocatedCount, remaining }
}
