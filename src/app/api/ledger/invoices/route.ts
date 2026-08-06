// src/app/api/ledger/invoices/route.ts
//
// The shared invoice register. Every group and every Windfall Scheme
// reads and writes the same ledger through this route.
//
// THREE AUDIENCES, THREE VIEWS
//   ?view=payable    what the caller owes (member's own obligations)
//   ?view=receivable what is owed TO the caller (rotating-pool recipient)
//   ?view=group      the whole group register (treasurer and admins)
//
// The distinction matters because in a rotating pool a member is both
// payer and payee at different points in the cycle, and the two lists
// answer completely different questions.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import prisma from '@/lib/prisma/client'
import { getSessionFromRequest, requireGroupManager } from '@/lib/auth'
import { generateInvoicesForPool, markOverdueInvoices } from '@/lib/ledger/generate'

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

// ── GET — the register ───────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const session = await getSessionFromRequest(req)
    if (!session) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    // ── Single invoice with its lines and allocations ───────
    const invoiceId = searchParams.get('id')
    if (invoiceId) {
      const rows = await sql(
        `SELECT li.*,
                payer."fullName" AS "payerName",
                payer.email  AS "payerEmail",
                payee."fullName" AS "payeeName",
                g.name AS "groupName",
                COALESCE((
                  SELECT json_agg(json_build_object(
                           'id', l.id, 'description', l.description,
                           'quantity', l.quantity, 'unitAmount', l."unitAmount",
                           'lineTotal', l."lineTotal")
                         ORDER BY l."sortOrder")
                  FROM "LedgerInvoiceLine" l WHERE l."invoiceId" = li.id
                ), '[]'::json) AS lines,
                COALESCE((
                  SELECT json_agg(json_build_object(
                           'id', la.id, 'amount', la.amount,
                           'paymentNumber', lp."paymentNumber",
                           'paidAt', lp."paidAt", 'status', lp.status,
                           'method', lp.method, 'reference', lp.reference)
                         ORDER BY lp."paidAt")
                  FROM "LedgerAllocation" la
                  JOIN "LedgerPayment" lp ON lp.id = la."paymentId"
                  WHERE la."invoiceId" = li.id
                ), '[]'::json) AS allocations
           FROM "LedgerInvoice" li
           JOIN "User"  payer ON payer.id = li."payerId"
           LEFT JOIN "User" payee ON payee.id = li."payeeId"
           JOIN "Group" g ON g.id = li."groupId"
          WHERE li.id = $1 LIMIT 1`,
        [invoiceId],
      )
      if (!rows.length) {
        return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 })
      }
      const inv = rows[0]

      // A member may read an invoice they are party to. Anyone else
      // needs a management role in the owning group.
      const isParty = inv.payerId === session.id || inv.payeeId === session.id
      if (!isParty) {
        const guardErr = await requireGroupManager(req, inv.groupId, { verifyStatus: false })
        if (guardErr) return guardErr
      }

      return NextResponse.json({ success: true, data: inv })
    }

    // ── Register listing ────────────────────────────────────
    const view    = searchParams.get('view') || 'payable'
    const groupId = searchParams.get('groupId')
    const status  = searchParams.get('status')
    const limit   = Math.min(Number(searchParams.get('limit')) || 100, 500)

    const where: string[] = []
    const params: any[] = []
    let n = 0

    if (view === 'group') {
      if (!groupId) {
        return NextResponse.json({ success: false, error: 'groupId is required for the group view' }, { status: 400 })
      }
      const guardErr = await requireGroupManager(req, groupId, { verifyStatus: false })
      if (guardErr) return guardErr
      where.push(`li."groupId" = $${++n}`); params.push(groupId)
    } else if (view === 'receivable') {
      where.push(`li."payeeId" = $${++n}`); params.push(session.id)
      if (groupId) { where.push(`li."groupId" = $${++n}`); params.push(groupId) }
    } else {
      where.push(`li."payerId" = $${++n}`); params.push(session.id)
      if (groupId) { where.push(`li."groupId" = $${++n}`); params.push(groupId) }
    }

    if (status) { where.push(`li.status = $${++n}`); params.push(status) }

    params.push(limit)
    const limitPlaceholder = `$${++n}`

    // Single round trip: rows and totals together. Supabase is in Tokyo
    // and Vercel in Washington DC, so a second query costs ~160ms for a
    // figure that is already in scope here.
    const rows = await sql(
      `SELECT li.id, li."invoiceNumber", li."groupId", li."sourceType",
              li."payerId", li."payeeType", li."payeeId",
              li.currency, li.total, li."amountAllocated",
              (li.total - li."amountAllocated") AS "amountOutstanding",
              li.status, li."issueDate", li."dueDate",
              li."periodLabel", li."periodNumber", li.description,
              payer."fullName" AS "payerName",
              payee."fullName" AS "payeeName",
              g.name AS "groupName",
              (li."dueDate" < CURRENT_TIMESTAMP AND li.status IN ('ISSUED','PART_PAID','OVERDUE')) AS "isOverdue"
         FROM "LedgerInvoice" li
         JOIN "User"  payer ON payer.id = li."payerId"
         LEFT JOIN "User" payee ON payee.id = li."payeeId"
         JOIN "Group" g ON g.id = li."groupId"
        WHERE ${where.join(' AND ')}
        ORDER BY li."dueDate" ASC, li."invoiceSeq" ASC
        LIMIT ${limitPlaceholder}`,
      params,
    )

    const totals = rows.reduce(
      (acc: any, r: any) => {
        const outstanding = Number(r.amountOutstanding) || 0
        acc.count++
        acc.invoiced    += Number(r.total) || 0
        acc.paid        += Number(r.amountAllocated) || 0
        acc.outstanding += outstanding
        if (r.isOverdue) { acc.overdueCount++; acc.overdue += outstanding }
        return acc
      },
      { count: 0, invoiced: 0, paid: 0, outstanding: 0, overdue: 0, overdueCount: 0 },
    )

    return NextResponse.json({ success: true, data: rows, totals, view })
  } catch (e: any) {
    console.error('GET /api/ledger/invoices error:', e?.message)
    return NextResponse.json({ success: false, error: safeError(e, 'Failed to load invoices') }, { status: 500 })
  }
}

// ── POST — generate, sweep, or raise a manual invoice ────────
const manualSchema = z.object({
  groupId:     z.string().uuid(),
  payerId:     z.string().uuid(),
  payeeType:   z.enum(['MEMBER','GROUP','SUPPLIER','PLATFORM']).default('GROUP'),
  payeeId:     z.string().uuid().nullish().transform(v => v || null),
  currency:    z.string().min(3).max(3),
  amount:      z.coerce.number().positive(),
  dueDate:     z.string(),
  description: z.string().min(2).max(300),
  sourceType:  z.enum(['PENALTY','MANUAL']).default('MANUAL'),
  notes:       z.string().max(600).nullish().transform(v => v || null),
})

export async function POST(req: NextRequest) {
  try {
    const body    = await req.json()
    const action  = body?.action || 'manual'
    const session = await getSessionFromRequest(req)
    if (!session) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    // ── Generate from an activated pool ─────────────────────
    if (action === 'generate-pool') {
      const poolId = String(body?.poolId || '')
      if (!poolId) {
        return NextResponse.json({ success: false, error: 'poolId is required' }, { status: 400 })
      }

      const pools = await sql(`SELECT "groupId" FROM "SavingsPool" WHERE id = $1 LIMIT 1`, [poolId])
      if (!pools.length) {
        return NextResponse.json({ success: false, error: 'Pool not found' }, { status: 404 })
      }

      const guardErr = await requireGroupManager(req, pools[0].groupId, { verifyStatus: true })
      if (guardErr) return guardErr

      const result = await generateInvoicesForPool(poolId, session.id)
      return NextResponse.json({
        success: true,
        data: result,
        message: `${result.generated} invoices raised${result.skipped ? `, ${result.skipped} already existed` : ''}.`,
      })
    }

    // ── Overdue sweep ───────────────────────────────────────
    if (action === 'sweep-overdue') {
      const updated = await markOverdueInvoices()
      return NextResponse.json({ success: true, data: { updated }, message: `${updated} invoices marked overdue.` })
    }

    // ── Manual or penalty invoice ───────────────────────────
    const parsed = manualSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.errors[0]?.message || 'Invalid invoice' }, { status: 400 })
    }
    const d = parsed.data

    const guardErr = await requireGroupManager(req, d.groupId, { verifyStatus: true })
    if (guardErr) return guardErr

    if (d.payeeType === 'MEMBER' && !d.payeeId) {
      return NextResponse.json({ success: false, error: 'A member payee must be identified' }, { status: 400 })
    }
    if (d.payeeType === 'MEMBER' && d.payeeId === d.payerId) {
      return NextResponse.json({ success: false, error: 'A member cannot invoice themselves' }, { status: 400 })
    }

    const settings = await sql(`SELECT "invoicePrefix" FROM "LedgerSettings" WHERE "groupId" = $1 LIMIT 1`, [d.groupId])
    const prefix   = settings[0]?.invoicePrefix || 'INV'

    const numRows = await sql(`SELECT * FROM next_ledger_number($1, 'INVOICE', $2)`, [d.groupId, prefix])
    const num     = numRows[0]
    if (!num) {
      return NextResponse.json({ success: false, error: 'Could not allocate an invoice number' }, { status: 500 })
    }

    const invoiceId = randomUUID()
    // sourceId is the invoice's own id for manual invoices: there is no
    // upstream record, and the unique (sourceType, sourceId) index still
    // needs a value that cannot collide.
    await exec(
      `INSERT INTO "LedgerInvoice" (
         id, "groupId", "invoiceNumber", "invoiceSeq", "sourceType", "sourceId",
         "payerType", "payerId", "payeeType", "payeeId",
         currency, subtotal, total, status, "dueDate", description, notes, "createdById"
       ) VALUES ($1,$2,$3,$4,$5,$1,'MEMBER',$6,$7,$8,$9,$10,$10,'ISSUED',$11,$12,$13,$14)`,
      [
        invoiceId, d.groupId, String(num.formatted), Number(num.seq), d.sourceType,
        d.payerId, d.payeeType, d.payeeId,
        d.currency, d.amount, new Date(d.dueDate), d.description, d.notes, session.id,
      ],
    )

    await exec(
      `INSERT INTO "LedgerInvoiceLine"
         (id, "invoiceId", description, quantity, "unitAmount", "lineTotal", "sortOrder")
       VALUES ($1,$2,$3,1,$4,$4,0)`,
      [randomUUID(), invoiceId, d.description, d.amount],
    )

    return NextResponse.json({
      success: true,
      data: { id: invoiceId, invoiceNumber: num.formatted },
      message: `Invoice ${num.formatted} raised.`,
    })
  } catch (e: any) {
    console.error('POST /api/ledger/invoices error:', e?.message)
    return NextResponse.json({ success: false, error: safeError(e, 'Failed to raise invoice') }, { status: 500 })
  }
}

// ── PUT — cancel or write off ────────────────────────────────
// An ISSUED invoice is never edited. It is an obligation the counterparty
// has been told about, so it is cancelled or written off with a reason,
// and a corrected one is raised in its place.
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const session = await getSessionFromRequest(req)
    if (!session) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const id     = String(body?.id || '')
    const status = String(body?.status || '')
    const reason = String(body?.reason || '').slice(0, 400)

    if (!id || !['CANCELLED','WRITTEN_OFF'].includes(status)) {
      return NextResponse.json({ success: false, error: 'Invoice id and a valid status are required' }, { status: 400 })
    }
    if (!reason) {
      return NextResponse.json({ success: false, error: 'A reason is required' }, { status: 400 })
    }

    const rows = await sql(
      `SELECT id, "groupId", status, "amountAllocated" FROM "LedgerInvoice" WHERE id = $1 LIMIT 1`,
      [id],
    )
    if (!rows.length) {
      return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 })
    }

    const guardErr = await requireGroupManager(req, rows[0].groupId, { verifyStatus: true })
    if (guardErr) return guardErr

    // Cancelling an invoice that has taken money would orphan the
    // allocation and leave the payment pointing at nothing.
    if (Number(rows[0].amountAllocated) > 0) {
      return NextResponse.json({
        success: false,
        error: 'This invoice has payments allocated to it. Reverse the payment first.',
        code: 'HAS_ALLOCATIONS',
      }, { status: 409 })
    }

    await exec(
      `UPDATE "LedgerInvoice"
          SET status = $2, "cancelledAt" = CURRENT_TIMESTAMP,
              "cancelReason" = $3, "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [id, status, reason],
    )

    return NextResponse.json({ success: true, message: `Invoice ${status === 'CANCELLED' ? 'cancelled' : 'written off'}.` })
  } catch (e: any) {
    console.error('PUT /api/ledger/invoices error:', e?.message)
    return NextResponse.json({ success: false, error: safeError(e, 'Failed to update invoice') }, { status: 500 })
  }
}
