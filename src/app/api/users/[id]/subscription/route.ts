// src/app/api/users/[id]/subscription/route.ts
// Admin subscription view and manual payment reconciliation.
//
// Phase 6b.
//
//   GET                              subscription + attempts + invoice
//   POST { action:'VERIFY_PAYMENT' } mark a manual payment received
//   POST { action:'SEND_RECEIPT' }   email a receipt
//
// ── VERIFYING A PAYMENT CREATES MONEY ────────────────────────
// Marking a bank transfer as received activates a membership and writes
// an immutable FEE row to the ledger. It is the manual equivalent of a
// Stripe webhook, and it must do exactly what the webhook does or the
// two payment rails will disagree about what a paid member looks like.
//
// So it is restricted to SYSTEM_ADMIN and NATIONAL_ADMIN. Never
// GROUP_ADMIN: a group admin benefits from their group looking fuller,
// and should not be able to admit a member by asserting a payment
// arrived.
//
// ── NO UN-VERIFYING ──────────────────────────────────────────
// Transaction is append-only by design — the schema says corrections
// happen via reversal, never deletion. There is deliberately no action
// here that flips a verified payment back. A mistake is corrected with
// a reversing entry, which is a separate, auditable operation.
//
// ── IDEMPOTENT ───────────────────────────────────────────────
// Verification claims the attempt with a conditional UPDATE. A second
// click updates zero rows and returns ALREADY_VERIFIED rather than
// creating a second membership and a second ledger entry.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import prisma from '@/lib/prisma/client'
import { getSessionFromRequest, unauthorized, forbidden } from '@/lib/auth'
import { enrolOrRenew, getCommunityMembership } from '@/lib/community-membership'
import { sendNotification, textToHtml } from '@/lib/notifications/engine'

export const dynamic = 'force-dynamic'

/** Only these roles may assert that money arrived. */
const RECONCILER_ROLES = ['SYSTEM_ADMIN', 'NATIONAL_ADMIN']

const VerifySchema = z.object({
  action: z.literal('VERIFY_PAYMENT'),
  attemptId: z.string().uuid(),
  verifiedReference: z.string().min(2, 'Enter the reference from the bank statement').max(120),
  receivedAmount: z.number().positive().optional(),
  note: z.string().max(500).optional(),
})

const ReceiptSchema = z.object({
  action: z.literal('SEND_RECEIPT'),
  invoiceId: z.string().uuid().optional(),
})

// ── GET ───────────────────────────────────────────────────────
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSessionFromRequest(req)
    if (!session) return unauthorized()
    if (!RECONCILER_ROLES.includes(session.role) && session.id !== params.id) {
      return forbidden('Not authorised to view this subscription')
    }

    const userId = params.id

    const [membership, attempts, invoices] = await Promise.all([
      getCommunityMembership(userId),

      prisma.$queryRawUnsafe<any[]>(
        `SELECT pa."id", pa."provider", pa."status", pa."amount", pa."currency",
                pa."providerRef", pa."failureReason", pa."createdAt",
                pa."memberReference", pa."memberPaidAt", pa."memberNote",
                pa."verifiedById", pa."verifiedAt", pa."verifiedReference",
                pa."receivedAmount", pa."verificationNote",
                v."fullName" AS "verifiedByName",
                inv."invoiceNo", inv."id" AS "invoiceId"
         FROM "PaymentAttempt" pa
         LEFT JOIN "User" v ON v.id = pa."verifiedById"
         LEFT JOIN "JoiningFeeInvoice" inv ON inv.id = pa."invoiceId"
         WHERE pa."userId" = $1
         ORDER BY pa."createdAt" DESC
         LIMIT 20`,
        userId
      ),

      prisma.$queryRawUnsafe<any[]>(
        `SELECT "id", "invoiceNo", "status", "amount", "currency", "countryCode",
                "paidAt", "createdAt", "receiptSentAt", "receiptNo"
         FROM "JoiningFeeInvoice"
         WHERE "userId" = $1
         ORDER BY "createdAt" DESC
         LIMIT 10`,
        userId
      ),
    ])

    return NextResponse.json({
      success: true,
      data: {
        membership,
        canReconcile: RECONCILER_ROLES.includes(session.role),
        attempts: attempts.map(a => ({
          ...a,
          amount: a.amount != null ? Number(a.amount) : null,
          receivedAmount: a.receivedAmount != null ? Number(a.receivedAmount) : null,
          isManual: a.provider !== 'CARD',
          awaitingVerification:
            a.provider !== 'CARD' &&
            !a.verifiedAt &&
            ['INITIATED', 'PENDING'].includes(String(a.status)),
        })),
        invoices: invoices.map(i => ({ ...i, amount: Number(i.amount) })),
      },
    })
  } catch (e: any) {
    console.error('GET /api/users/[id]/subscription error:', e?.message)
    return NextResponse.json({ success: false, error: 'Could not load subscription' }, { status: 500 })
  }
}

// ── POST ──────────────────────────────────────────────────────
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSessionFromRequest(req)
    if (!session) return unauthorized()
    if (!RECONCILER_ROLES.includes(session.role)) {
      return forbidden('Only System and National Admins can reconcile payments')
    }

    const body = await req.json().catch(() => ({} as any))
    const userId = params.id

    // ── Send receipt ────────────────────────────────────────
    if (body?.action === 'SEND_RECEIPT') {
      const parsed = ReceiptSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 })
      }
      return sendReceipt(userId, parsed.data.invoiceId, session.id)
    }

    // ── Verify a manual payment ─────────────────────────────
    const parsed = VerifySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message || 'Invalid request' },
        { status: 400 }
      )
    }
    const { attemptId, verifiedReference, receivedAmount, note } = parsed.data

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT pa."id", pa."userId", pa."provider", pa."status", pa."amount",
              pa."currency", pa."invoiceId", pa."verifiedAt",
              inv."invoiceNo", inv."countryCode", u."email", u."fullName"
       FROM "PaymentAttempt" pa
       LEFT JOIN "JoiningFeeInvoice" inv ON inv.id = pa."invoiceId"
       JOIN "User" u ON u.id = pa."userId"
       WHERE pa."id" = $1 AND pa."userId" = $2`,
      attemptId, userId
    )
    if (!rows.length) {
      return NextResponse.json({ success: false, error: 'Payment attempt not found' }, { status: 404 })
    }
    const attempt = rows[0]

    if (attempt.provider === 'CARD') {
      return NextResponse.json({
        success: false,
        code: 'CARD_PAYMENT',
        error: 'Card payments are confirmed automatically by Stripe and cannot be reconciled by hand.',
      }, { status: 409 })
    }
    if (attempt.verifiedAt) {
      return NextResponse.json({
        success: false,
        code: 'ALREADY_VERIFIED',
        error: 'This payment has already been verified.',
      }, { status: 409 })
    }

    const amount = Number(attempt.amount)
    const received = receivedAmount ?? amount
    const currency = String(attempt.currency)

    // Conditional claim — a second click updates zero rows, so no
    // second membership and no second ledger entry.
    const claimed = await prisma.$executeRawUnsafe(
      `UPDATE "PaymentAttempt"
       SET "status" = 'SUCCESS',
           "verifiedById" = $2,
           "verifiedAt" = now(),
           "verifiedReference" = $3,
           "receivedAmount" = $4::numeric,
           "verificationNote" = $5,
           "updatedAt" = now()
       WHERE "id" = $1 AND "verifiedAt" IS NULL`,
      attemptId, session.id, verifiedReference, received, note ?? null
    )
    if (Number(claimed) === 0) {
      return NextResponse.json({
        success: false, code: 'ALREADY_VERIFIED',
        error: 'This payment has already been verified.',
      }, { status: 409 })
    }

    if (attempt.invoiceId) {
      await prisma.$executeRawUnsafe(
        `UPDATE "JoiningFeeInvoice"
         SET "status" = 'PAID', "paidAt" = now(), "updatedAt" = now()
         WHERE "id" = $1 AND "status" <> 'PAID'`,
        attempt.invoiceId
      )
    }

    // Immutable ledger entry — the same row the Stripe webhook writes,
    // so both rails produce identical financial history.
    await prisma.transaction.create({
      data: {
        type: 'FEE',
        status: 'COMPLETED',
        amount: received,
        currency: currency as any,
        description: `Community Membership fee — ${attempt.provider} (manually verified)`,
        reference: randomUUID(),
        externalRef: verifiedReference,
        paymentMethod: attempt.provider as any,
        userId,
        metadata: {
          attemptId,
          invoiceNo: attempt.invoiceNo,
          verifiedBy: session.id,
          invoicedAmount: amount,
          receivedAmount: received,
        },
      },
    }).catch((e: any) => {
      // The payment IS verified at this point. A ledger failure must be
      // loud, but must not leave the caller thinking nothing happened.
      console.error('VERIFY_PAYMENT: ledger write failed', attemptId, e?.message)
    })

    // No expiresAt — manual rails have no Stripe period, so the service
    // computes 12 months from today.
    const membership = await enrolOrRenew({
      userId,
      currency,
      autoRenew: false,
      amountPaid: received,
      paymentRef: verifiedReference,
      invoiceId: attempt.invoiceId ?? null,
      source: 'DIRECT_REGISTRATION',
      actorUserId: session.id,
    })

    await prisma.auditLog.create({
      data: {
        userId: session.id,
        action: 'APPROVE',
        entityType: 'PaymentAttempt',
        entityId: attemptId,
        newValues: {
          verifiedReference,
          receivedAmount: received,
          invoicedAmount: amount,
          currency,
          provider: attempt.provider,
        },
        ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown',
        userAgent: req.headers.get('user-agent') || undefined,
        description:
          `Manual payment verified for ${attempt.email} — ${currency} ${received} ` +
          `via ${attempt.provider}, ref ${verifiedReference}`,
      },
    }).catch(() => {})

    const shortfall = received < amount ? amount - received : 0

    return NextResponse.json({
      success: true,
      message:
        `Payment verified. ${attempt.fullName}'s membership is active` +
        (shortfall > 0 ? ` — note the amount was ${currency} ${shortfall.toFixed(2)} short.` : '.'),
      data: {
        membership: membership.ok ? membership.membership : null,
        shortfall,
        membershipWritten: membership.ok,
      },
    })
  } catch (e: any) {
    console.error('POST /api/users/[id]/subscription error:', e?.message)
    return NextResponse.json({ success: false, error: 'Could not complete this action' }, { status: 500 })
  }
}

// ── Receipt ───────────────────────────────────────────────────
async function sendReceipt(userId: string, invoiceId: string | undefined, actorId: string) {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT inv."id", inv."invoiceNo", inv."amount", inv."currency", inv."paidAt",
            inv."receiptNo", inv."receiptSentAt", u."email", u."fullName"
     FROM "JoiningFeeInvoice" inv
     JOIN "User" u ON u.id = inv."userId"
     WHERE inv."userId" = $1 AND inv."status" = 'PAID'
       ${invoiceId ? 'AND inv."id" = $2' : ''}
     ORDER BY inv."paidAt" DESC NULLS LAST
     LIMIT 1`,
    ...(invoiceId ? [userId, invoiceId] : [userId])
  )

  if (!rows.length) {
    return NextResponse.json({
      success: false, code: 'NO_PAID_INVOICE',
      error: 'There is no paid invoice to receipt.',
    }, { status: 404 })
  }

  const inv = rows[0]
  // Reuse the existing number on a resend, so a member never holds two
  // receipts with different numbers for one payment.
  const receiptNo = inv.receiptNo || `RCT-${new Date().getFullYear()}-${String(inv.invoiceNo).split('-').pop()}`
  const paidOn = inv.paidAt
    ? new Date(inv.paidAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—'
  const amount = `${inv.currency} ${Number(inv.amount).toFixed(2)}`

  const body =
    `Hi ${String(inv.fullName || 'there').split(' ')[0]},\n\n` +
    `Thank you — your Community Membership payment has been received.\n\n` +
    `Receipt number: ${receiptNo}\n` +
    `Invoice: ${inv.invoiceNo}\n` +
    `Amount: ${amount}\n` +
    `Date received: ${paidOn}\n\n` +
    `Keep this for your records. Your membership is now active.`

  const res = await sendNotification({
    userId,
    type: 'ANNOUNCEMENT',
    templateId: 'membership_receipt',
    subject: `Receipt ${receiptNo} — Windfall Community Deals`,
    body,
    html: textToHtml(body, 'Payment received'),
    channels: ['EMAIL', 'IN_APP'],
    email: inv.email,
    fullName: inv.fullName,
    // Keyed to the receipt, so re-sending is a deliberate act rather
    // than an accidental duplicate from a double-click.
    dedupeKey: `receipt:${inv.id}:${receiptNo}:${Date.now()}`,
    metadata: { invoiceId: inv.id, receiptNo, actorId },
  })

  await prisma.$executeRawUnsafe(
    `UPDATE "JoiningFeeInvoice"
     SET "receiptNo" = COALESCE("receiptNo", $2), "receiptSentAt" = now(), "updatedAt" = now()
     WHERE "id" = $1`,
    inv.id, receiptNo
  )

  return NextResponse.json({
    success: res.sent.length > 0,
    message: res.sent.length
      ? `Receipt ${receiptNo} emailed to ${inv.email}.`
      : `Receipt ${receiptNo} recorded, but the email could not be sent.`,
    data: { receiptNo },
  })
}
