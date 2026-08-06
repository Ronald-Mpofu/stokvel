// src/app/api/ledger/payments/route.ts
//
// Payment recording and confirmation.
//
// THE HAPPY PATH IS ONE CLICK, BY THE RIGHT PERSON
//   The RECIPIENT marks an invoice paid. They are the only party who
//   actually knows whether money arrived, so requiring the payer to
//   lodge something first would add a step that proves nothing.
//
// THE UNHAPPY PATH EXISTS BECAUSE RECIPIENTS GO QUIET
//   A payer who has paid but sees no confirmation can lodge their own
//   attestation with a reference and proof. That starts the
//   confirmation window (3 days by default). If the recipient neither
//   confirms nor disputes within it, the payment escalates to the
//   treasurer, who can confirm on their behalf. Without that, one
//   unresponsive member stalls a whole rotation.
//
// THE CONFLICT OF INTEREST THIS ROUTE HAS TO SURVIVE
//   In a rotating pool the confirming party is the beneficiary of the
//   pot. If they falsely deny receipt, the payer is told to pay twice.
//   Hence: proof upload, a treasurer who can override either party with
//   a recorded reason, and recordedBy/confirmedBy stored separately so
//   a statement shows who asserted what.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import prisma from '@/lib/prisma/client'
import {
  getSessionFromRequest, requireGroupManager, isGroupTreasurer,
} from '@/lib/auth'
import { postPaymentToLedger, allocatePaymentToInvoices } from '@/lib/ledger/post'

export const dynamic = 'force-dynamic'

const IS_PROD = process.env.NODE_ENV === 'production'
function safeError(e: any, fallback: string): string {
  return IS_PROD ? fallback : (e?.message || fallback)
}

async function sql(query: string, params: any[] = []) {
  return prisma.$queryRawUnsafe(query, ...params) as Promise<any[]>
}
async function exec(query: string, params: any[] = []) {
  return prisma.$executeRawUnsafe(query, ...params)
}

async function nextPaymentNumber(groupId: string): Promise<{ seq: number; formatted: string }> {
  const s = await sql(`SELECT "paymentPrefix" FROM "LedgerSettings" WHERE "groupId" = $1 LIMIT 1`, [groupId])
  const prefix = s[0]?.paymentPrefix || 'PAY'
  const rows = await sql(`SELECT * FROM next_ledger_number($1, 'PAYMENT', $2)`, [groupId, prefix])
  if (!rows[0]) throw new Error('Could not allocate a payment number')
  return { seq: Number(rows[0].seq), formatted: String(rows[0].formatted) }
}

async function confirmationWindowDays(groupId: string): Promise<number> {
  const s = await sql(`SELECT "confirmationWindowDays" FROM "LedgerSettings" WHERE "groupId" = $1 LIMIT 1`, [groupId])
  return Number(s[0]?.confirmationWindowDays ?? 3)
}

// ── GET — payment queues ─────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const session = await getSessionFromRequest(req)
    if (!session) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const view    = searchParams.get('view') || 'awaiting-me'
    const groupId = searchParams.get('groupId')
    const limit   = Math.min(Number(searchParams.get('limit')) || 100, 500)

    const where: string[] = []
    const params: any[] = []
    let n = 0

    if (view === 'awaiting-me') {
      // Payer attestations sitting on this caller for confirmation.
      where.push(`lp."payeeId" = $${++n}`); params.push(session.id)
      where.push(`lp.status = 'SENT_UNCONFIRMED'`)
    } else if (view === 'mine-sent') {
      where.push(`lp."payerId" = $${++n}`); params.push(session.id)
    } else if (view === 'mine-received') {
      where.push(`lp."payeeId" = $${++n}`); params.push(session.id)
    } else if (view === 'escalated') {
      if (!groupId) {
        return NextResponse.json({ success: false, error: 'groupId is required' }, { status: 400 })
      }
      const guardErr = await requireGroupManager(req, groupId, { verifyStatus: false })
      if (guardErr) return guardErr
      where.push(`lp."groupId" = $${++n}`); params.push(groupId)
      where.push(`lp.status = 'SENT_UNCONFIRMED' AND lp."escalatedAt" IS NOT NULL`)
    } else if (view === 'disputed') {
      if (!groupId) {
        return NextResponse.json({ success: false, error: 'groupId is required' }, { status: 400 })
      }
      const guardErr = await requireGroupManager(req, groupId, { verifyStatus: false })
      if (guardErr) return guardErr
      where.push(`lp."groupId" = $${++n}`); params.push(groupId)
      where.push(`lp.status = 'DISPUTED'`)
    } else {
      if (!groupId) {
        return NextResponse.json({ success: false, error: 'groupId is required for the group view' }, { status: 400 })
      }
      const guardErr = await requireGroupManager(req, groupId, { verifyStatus: false })
      if (guardErr) return guardErr
      where.push(`lp."groupId" = $${++n}`); params.push(groupId)
    }

    if (groupId && view !== 'group' && view !== 'escalated' && view !== 'disputed') {
      where.push(`lp."groupId" = $${++n}`); params.push(groupId)
    }

    const rows = await sql(
      `SELECT lp.id, lp."paymentNumber", lp."groupId", lp."payerId", lp."payeeType", lp."payeeId",
              lp.currency, lp.amount, lp."amountAllocated", lp.method, lp.reference,
              lp."proofPath", lp.status, lp."recordedBy", lp."paidAt", lp."escalatesAt",
              lp."escalatedAt", lp."confirmedAt", lp."confirmedBy", lp."disputeReason",
              lp."payerNote", lp."postedAt",
              payer."fullName" AS "payerName",
              payee."fullName" AS "payeeName",
              g.name AS "groupName",
              COALESCE((
                SELECT json_agg(json_build_object(
                         'invoiceId', la."invoiceId",
                         'invoiceNumber', li."invoiceNumber",
                         'amount', la.amount,
                         'periodLabel', li."periodLabel")
                       ORDER BY li."dueDate")
                FROM "LedgerAllocation" la
                JOIN "LedgerInvoice" li ON li.id = la."invoiceId"
                WHERE la."paymentId" = lp.id
              ), '[]'::json) AS allocations
         FROM "LedgerPayment" lp
         JOIN "User" payer ON payer.id = lp."payerId"
         LEFT JOIN "User" payee ON payee.id = lp."payeeId"
         JOIN "Group" g ON g.id = lp."groupId"
        WHERE ${where.join(' AND ')}
        ORDER BY lp."paidAt" DESC
        LIMIT ${limit}`,
      params,
    )

    return NextResponse.json({ success: true, data: rows, view })
  } catch (e: any) {
    console.error('GET /api/ledger/payments error:', e?.message)
    return NextResponse.json({ success: false, error: safeError(e, 'Failed to load payments') }, { status: 500 })
  }
}

// ── POST — record a payment ──────────────────────────────────
const recordSchema = z.object({
  invoiceIds: z.array(z.string().uuid()).min(1),
  amount:     z.coerce.number().positive().optional(),
  method:     z.enum(['BANK_TRANSFER','ECOCASH','MPESA','MTN_MOMO','CARD','USSD','CASH','INTERNAL_TRANSFER']).default('BANK_TRANSFER'),
  reference:  z.string().max(120).nullish().transform(v => v || null),
  note:       z.string().max(600).nullish().transform(v => v || null),
  proofPath:  z.string().max(400).nullish().transform(v => v || null),
  paidAt:     z.string().nullish(),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req)
    if (!session) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const body   = await req.json()
    const parsed = recordSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.errors[0]?.message || 'Invalid payment' }, { status: 400 })
    }
    const d = parsed.data

    // Every invoice must share one payer, one payee, one currency and
    // one group. A payment settling invoices owed to different people
    // is not one payment.
    const invoices = await sql(
      `SELECT id, "groupId", "payerId", "payeeType", "payeeId", currency,
              (total - "amountAllocated") AS outstanding, status
         FROM "LedgerInvoice"
        WHERE id = ANY($1::text[]) AND status NOT IN ('CANCELLED','WRITTEN_OFF')`,
      [d.invoiceIds],
    )
    if (invoices.length !== d.invoiceIds.length) {
      return NextResponse.json({ success: false, error: 'One or more invoices were not found' }, { status: 404 })
    }

    const first = invoices[0]
    const uniform = invoices.every((i: any) =>
      i.groupId === first.groupId && i.payerId === first.payerId &&
      i.payeeType === first.payeeType && (i.payeeId ?? null) === (first.payeeId ?? null) &&
      i.currency === first.currency)
    if (!uniform) {
      return NextResponse.json({
        success: false,
        error: 'These invoices have different payers, recipients or currencies and cannot be settled by one payment',
      }, { status: 400 })
    }

    const outstanding = invoices.reduce((s: number, i: any) => s + Number(i.outstanding), 0)
    if (outstanding <= 0) {
      return NextResponse.json({ success: false, error: 'These invoices are already settled' }, { status: 409 })
    }
    const amount = d.amount != null ? Number(d.amount) : outstanding
    if (amount > outstanding) {
      return NextResponse.json({
        success: false,
        error: `Amount exceeds the ${first.currency} ${outstanding.toFixed(2)} outstanding on these invoices`,
      }, { status: 400 })
    }

    // WHO IS RECORDING THIS, AND WHAT IT MEANS
    //   payee    → confirming receipt. Settles immediately. Happy path.
    //   payer    → attesting they sent it. Awaits confirmation.
    //   treasurer→ recording on behalf. Settles immediately, attributed.
    const isPayee     = first.payeeType === 'MEMBER' && first.payeeId === session.id
    const isPayer     = first.payerId === session.id
    const treasurer   = await isGroupTreasurer(session.id, first.groupId)
    const groupPayee  = first.payeeType !== 'MEMBER'

    if (!isPayee && !isPayer && !treasurer) {
      return NextResponse.json({ success: false, error: 'You are not a party to these invoices' }, { status: 403 })
    }

    // A group-payee invoice has no member to confirm receipt, so only
    // the treasurer or an admin may record it as received.
    if (groupPayee && !treasurer) {
      const guardErr = await requireGroupManager(req, first.groupId, { verifyStatus: true })
      if (guardErr) return guardErr
    }

    const recordedBy = isPayee ? 'RECIPIENT' : (treasurer && !isPayer ? 'TREASURER' : 'PAYER')
    const confirmsNow = recordedBy !== 'PAYER'

    const num = await nextPaymentNumber(first.groupId)
    const paymentId = randomUUID()
    const windowDays = await confirmationWindowDays(first.groupId)
    const paidAt = d.paidAt ? new Date(d.paidAt) : new Date()
    const escalatesAt = confirmsNow ? null : new Date(Date.now() + windowDays * 86400000)

    await exec(
      `INSERT INTO "LedgerPayment" (
         id, "groupId", "paymentNumber", "paymentSeq", "payerId", "payeeType", "payeeId",
         currency, amount, method, reference, "proofPath", "payerNote",
         status, "recordedBy", "paidAt", "escalatesAt",
         "confirmedAt", "confirmedById", "confirmedBy", "createdById"
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
         $14,$15,$16,$17,$18,$19,$20,$21
       )`,
      [
        paymentId, first.groupId, num.formatted, num.seq, first.payerId,
        first.payeeType, first.payeeId, first.currency, amount,
        d.method, d.reference, d.proofPath, d.note,
        confirmsNow ? 'CONFIRMED' : 'SENT_UNCONFIRMED',
        recordedBy, paidAt, escalatesAt,
        confirmsNow ? new Date() : null,
        confirmsNow ? session.id : null,
        confirmsNow ? (recordedBy === 'RECIPIENT' ? 'RECIPIENT' : 'TREASURER') : null,
        session.id,
      ],
    )

    // Allocation and posting only happen once the payment is confirmed.
    // An unconfirmed attestation must not clear an invoice — that is the
    // whole point of the confirmation step.
    let allocation = { allocated: 0, remaining: amount }
    let posting: any = { posted: false, reason: 'Awaiting confirmation' }
    if (confirmsNow) {
      allocation = await allocatePaymentToInvoices(paymentId, d.invoiceIds, session.id)
      posting    = await postPaymentToLedger(paymentId)
    }

    return NextResponse.json({
      success: true,
      data: { id: paymentId, paymentNumber: num.formatted, status: confirmsNow ? 'CONFIRMED' : 'SENT_UNCONFIRMED', allocation, posting },
      message: confirmsNow
        ? `Payment ${num.formatted} recorded and ${allocation.allocated} invoice${allocation.allocated === 1 ? '' : 's'} settled.`
        : `Payment ${num.formatted} logged. ${(first.payeeId ? 'The recipient' : 'The treasurer')} has ${windowDays} days to confirm it.`,
    })
  } catch (e: any) {
    console.error('POST /api/ledger/payments error:', e?.message)
    return NextResponse.json({ success: false, error: safeError(e, 'Failed to record payment') }, { status: 500 })
  }
}

// ── PUT — confirm, dispute, or adjudicate ────────────────────
export async function PUT(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req)
    if (!session) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const body      = await req.json()
    const action    = String(body?.action || '')
    const paymentId = String(body?.paymentId || '')
    if (!paymentId || !['confirm','dispute','cancel'].includes(action)) {
      return NextResponse.json({ success: false, error: 'paymentId and a valid action are required' }, { status: 400 })
    }

    const rows = await sql(
      `SELECT id, "groupId", "payerId", "payeeId", "payeeType", status, amount, currency, "paymentNumber"
         FROM "LedgerPayment" WHERE id = $1 LIMIT 1`,
      [paymentId],
    )
    if (!rows.length) {
      return NextResponse.json({ success: false, error: 'Payment not found' }, { status: 404 })
    }
    const p = rows[0]

    const isPayee   = p.payeeId === session.id
    const isPayer   = p.payerId === session.id
    const treasurer = await isGroupTreasurer(session.id, p.groupId)

    // ── Cancel — payer withdrawing their own unconfirmed claim ──
    if (action === 'cancel') {
      if (!isPayer && !treasurer) {
        return NextResponse.json({ success: false, error: 'Only the payer or treasurer can cancel this' }, { status: 403 })
      }
      if (p.status === 'CONFIRMED') {
        return NextResponse.json({
          success: false,
          error: 'This payment is confirmed and posted. Raise a reversal instead.',
          code: 'ALREADY_CONFIRMED',
        }, { status: 409 })
      }
      await exec(
        `UPDATE "LedgerPayment"
            SET status = 'CANCELLED', "cancelledAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [paymentId],
      )
      return NextResponse.json({ success: true, message: 'Payment withdrawn.' })
    }

    if (p.status !== 'SENT_UNCONFIRMED') {
      return NextResponse.json({
        success: false,
        error: `This payment is ${String(p.status).toLowerCase().replace('_',' ')} and cannot be changed`,
      }, { status: 409 })
    }

    // ── Dispute — recipient says the money did not arrive ──────
    if (action === 'dispute') {
      const reason = String(body?.reason || '').slice(0, 500)
      if (!isPayee && !treasurer) {
        return NextResponse.json({ success: false, error: 'Only the recipient or treasurer can dispute this' }, { status: 403 })
      }
      if (!reason) {
        return NextResponse.json({ success: false, error: 'A reason is required' }, { status: 400 })
      }
      await exec(
        `UPDATE "LedgerPayment"
            SET status = 'DISPUTED', "disputedAt" = CURRENT_TIMESTAMP,
                "disputeReason" = $2, "updatedAt" = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [paymentId, reason],
      )
      return NextResponse.json({
        success: true,
        message: 'Payment disputed. The treasurer will review it.',
      })
    }

    // ── Confirm ───────────────────────────────────────────────
    // The recipient may always confirm. The treasurer may confirm on
    // their behalf — deliberately allowed, because otherwise one
    // unresponsive member stalls the rotation. Which of the two acted
    // is recorded, since it matters in any later dispute.
    if (!isPayee && !treasurer) {
      return NextResponse.json({ success: false, error: 'Only the recipient or treasurer can confirm this' }, { status: 403 })
    }
    if (!isPayee && treasurer) {
      const allowed = await sql(
        `SELECT "allowTreasurerConfirm" FROM "LedgerSettings" WHERE "groupId" = $1 LIMIT 1`,
        [p.groupId],
      )
      if (allowed.length && allowed[0].allowTreasurerConfirm === false) {
        return NextResponse.json({
          success: false,
          error: 'This group does not permit the treasurer to confirm on a member\u2019s behalf',
          code: 'TREASURER_CONFIRM_DISABLED',
        }, { status: 403 })
      }
    }

    await exec(
      `UPDATE "LedgerPayment"
          SET status = 'CONFIRMED', "confirmedAt" = CURRENT_TIMESTAMP,
              "confirmedById" = $2, "confirmedBy" = $3,
              "confirmNote" = $4, "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [paymentId, session.id, isPayee ? 'RECIPIENT' : 'TREASURER', String(body?.note || '').slice(0, 400) || null],
    )

    const allocation = await allocatePaymentToInvoices(paymentId, body?.invoiceIds || null, session.id)
    const posting    = await postPaymentToLedger(paymentId)

    return NextResponse.json({
      success: true,
      data: { allocation, posting },
      message: isPayee
        ? `Payment ${p.paymentNumber} confirmed. ${allocation.allocated} invoice${allocation.allocated === 1 ? '' : 's'} settled.`
        : `Payment ${p.paymentNumber} confirmed on the recipient\u2019s behalf and recorded as a treasurer decision.`,
    })
  } catch (e: any) {
    console.error('PUT /api/ledger/payments error:', e?.message)
    return NextResponse.json({ success: false, error: safeError(e, 'Failed to update payment') }, { status: 500 })
  }
}
