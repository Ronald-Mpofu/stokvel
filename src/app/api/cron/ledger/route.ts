// src/app/api/cron/ledger/route.ts
//
// Daily ledger sweep. Five jobs, each idempotent so a re-run — or two
// overlapping runs — cannot double-send or double-post.
//
//   1. ISSUED  → DUE      on the due date
//   2. DUE     → OVERDUE  after the due date plus any grace period
//   3. Reminders, N days before due, to BOTH parties
//   4. Escalate unconfirmed payer attestations to the treasurer
//   5. Post any confirmed-but-unposted payments to the GL
//
// AUTHENTICATION
//   Bearer CRON_SECRET, compared with timingSafeEqual. A plain ===
//   comparison returns early on the first differing byte and leaks the
//   secret's prefix to anyone who can time the response.

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import prisma from '@/lib/prisma/client'
import { postPendingPayments } from '@/lib/ledger/post'
import { sendEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function sql(query: string, params: any[] = []) {
  return prisma.$queryRawUnsafe(query, ...params) as Promise<any[]>
}
async function exec(query: string, params: any[] = []) {
  return prisma.$executeRawUnsafe(query, ...params)
}

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const header = req.headers.get('authorization') || ''
  const token  = header.startsWith('Bearer ') ? header.slice(7) : header
  if (!token) return false

  const a = Buffer.from(token)
  const b = Buffer.from(secret)
  // timingSafeEqual throws on length mismatch, so compare lengths first
  // — but do it in a way that still runs the constant-time compare when
  // lengths match, rather than short-circuiting on content.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

const money = (n: any, c: string) =>
  `${c} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const dateStr = (d: any) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

export async function GET(req: NextRequest) {
  if (!authorised(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorised' }, { status: 401 })
  }

  const result = {
    markedDue: 0, markedOverdue: 0,
    remindersSent: 0, reminderErrors: 0,
    escalated: 0, posted: 0, postFailed: 0,
  }

  try {
    // ── 1. ISSUED → DUE ──────────────────────────────────────
    result.markedDue = await exec(
      `UPDATE "LedgerInvoice"
          SET status = 'DUE', "updatedAt" = CURRENT_TIMESTAMP
        WHERE status = 'ISSUED'
          AND "dueDate"::date <= CURRENT_DATE`,
    ) as unknown as number

    // ── 2. DUE → OVERDUE, honouring each group's grace period ─
    // SELF-CONTRIBUTIONS ARE EXCLUDED. In a rotating pool the cycle's
    // recipient is invoiced for their own share, which is netted against
    // their payout rather than transferred. Marking it overdue would
    // report them as delinquent on their own payout day.
    result.markedOverdue = await exec(
      `UPDATE "LedgerInvoice" li
          SET status = 'OVERDUE', "updatedAt" = CURRENT_TIMESTAMP
        FROM "Group" g
        LEFT JOIN "LedgerSettings" ls ON ls."groupId" = g.id
       WHERE li."groupId" = g.id
         AND li.status IN ('DUE','PART_PAID')
         AND li."payerId" <> COALESCE(li."payeeId", '')
         AND li."dueDate"::date < CURRENT_DATE - (COALESCE(ls."arrearsGraceDays", 0) || ' days')::interval`,
    ) as unknown as number

    // ── 3. Reminders to BOTH parties ─────────────────────────
    const dueSoon = await sql(
      `SELECT li.id, li."invoiceNumber", li.total, li.currency, li."dueDate",
              li."periodLabel", li.description, li."payeeType",
              payer.email AS "payerEmail", payer."fullName" AS "payerName",
              payee.email AS "payeeEmail", payee."fullName" AS "payeeName",
              g.name AS "groupName",
              COALESCE(ls."remindBothParties", true) AS "remindBoth"
         FROM "LedgerInvoice" li
         JOIN "Group" g ON g.id = li."groupId"
         LEFT JOIN "LedgerSettings" ls ON ls."groupId" = li."groupId"
         JOIN "User" payer ON payer.id = li."payerId"
         LEFT JOIN "User" payee ON payee.id = li."payeeId"
        WHERE li."reminderSentAt" IS NULL
          AND li.status IN ('ISSUED','DUE','PART_PAID')
          AND li."payerId" <> COALESCE(li."payeeId", '')
          AND li."dueDate"::date <= CURRENT_DATE + (COALESCE(ls."reminderDaysBefore", 3) || ' days')::interval
          AND li."dueDate"::date >= CURRENT_DATE
        ORDER BY li."dueDate" ASC
        LIMIT 400`,
    )

    for (const inv of dueSoon) {
      const toPayer = inv.payerEmail
      const toPayee = inv.remindBoth && inv.payeeType === 'MEMBER' ? inv.payeeEmail : null
      const amount  = money(inv.total, inv.currency)
      const due     = dateStr(inv.dueDate)

      try {
        if (toPayer) {
          await sendEmail({
            to: toPayer,
            subject: `${amount} due ${due} — ${inv.groupName}`,
            html: `<p>Dear ${inv.payerName},</p>
                   <p>Your contribution of <strong>${amount}</strong> for
                   <strong>${inv.groupName}</strong> is due on <strong>${due}</strong>.</p>
                   <p>${inv.description || ''}</p>
                   ${inv.payeeName && inv.payeeType === 'MEMBER'
                     ? `<p>Pay <strong>${inv.payeeName}</strong> directly. They will confirm receipt, and the invoice is then marked paid on the group ledger.</p>`
                     : `<p>Pay into the group account. The treasurer will confirm receipt.</p>`}
                   <p>Reference: ${inv.invoiceNumber}</p>`,
          })
        }
        if (toPayee) {
          await sendEmail({
            to: toPayee,
            subject: `${amount} due to you ${due} — ${inv.groupName}`,
            html: `<p>Dear ${inv.payeeName},</p>
                   <p><strong>${inv.payerName}</strong> owes you <strong>${amount}</strong>,
                   due on <strong>${due}</strong>, for ${inv.groupName}.</p>
                   <p>When the money arrives, mark it received in your portal and the
                   invoice is settled on the group ledger.</p>
                   <p>Reference: ${inv.invoiceNumber}</p>`,
          })
        }

        // Stamped whether or not both sends succeeded — a partial
        // failure must not cause the whole reminder to repeat daily.
        await exec(
          `UPDATE "LedgerInvoice" SET "reminderSentAt" = CURRENT_TIMESTAMP WHERE id = $1`,
          [inv.id],
        )
        result.remindersSent++
      } catch (e: any) {
        console.error('Reminder failed:', inv.invoiceNumber, e?.message)
        result.reminderErrors++
      }
    }

    // ── 4. Escalate unconfirmed attestations ─────────────────
    result.escalated = await exec(
      `UPDATE "LedgerPayment"
          SET "escalatedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
        WHERE status = 'SENT_UNCONFIRMED'
          AND "escalatedAt" IS NULL
          AND "escalatesAt" IS NOT NULL
          AND "escalatesAt" < CURRENT_TIMESTAMP`,
    ) as unknown as number

    // ── 5. Post confirmed-but-unposted payments ──────────────
    // Posting is non-fatal at confirmation time so a GL failure cannot
    // roll back a member's confirmation. This is the catch-up.
    const posting = await postPendingPayments(200)
    result.posted     = posting.posted
    result.postFailed = posting.failed

    return NextResponse.json({ success: true, data: result })
  } catch (e: any) {
    console.error('GET /api/cron/ledger error:', e?.message)
    return NextResponse.json(
      { success: false, error: 'Sweep failed', data: result },
      { status: 500 },
    )
  }
}
