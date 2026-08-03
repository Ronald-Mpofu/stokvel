// src/app/api/payment-destinations/route.ts
// Company bank accounts and mobile wallets that members pay into.
//
// Phase 6b.
//
//   GET                       list (admin) — includes coverage gaps
//   GET ?country=ZW&member=1  what a MEMBER sees when paying
//   POST                      create
//   PUT ?id=                  update
//   DELETE ?id=               DEACTIVATE — never a hard delete
//
// ── WHY THIS IS ADMIN-ONLY ───────────────────────────────────
// These are the digits a member types into their banking app. A wrong
// account number sends real money to a stranger, and bank transfers are
// not reversible on request. Writes are restricted to SYSTEM_ADMIN and
// NATIONAL_ADMIN, and every change is audit-logged with old and new
// values.
//
// ── WHY DEACTIVATE, NOT DELETE ───────────────────────────────
// A destination referenced by a settled payment is part of the audit
// trail — "we instructed them to send it here" is evidence. DELETE sets
// isActive = false; the row stays. This also matches the platform's
// soft-delete direction for anything touching money.
//
// ── COVERAGE GAPS ────────────────────────────────────────────
// RefJoiningFee lists which methods a country offers; this table says
// where the money goes. Nothing stops the two disagreeing — a country
// offering ECOCASH with no ECOCASH destination gives the member a dead
// end at the moment they are trying to pay. GET reports those gaps so
// they are visible before a member finds them.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import prisma from '@/lib/prisma/client'
import { getSessionFromRequest, unauthorized, forbidden } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const ADMIN_ROLES = ['SYSTEM_ADMIN', 'NATIONAL_ADMIN']
const METHODS = ['BANK_TRANSFER', 'ECOCASH', 'MPESA', 'MTN_MOMO', 'USSD'] as const

const DestinationSchema = z.object({
  countryCode: z.string().length(2, 'Country code must be 2 letters'),
  currency: z.string().min(3).max(3),
  method: z.enum(METHODS),
  displayName: z.string().min(2, 'Give this destination a name members will recognise').max(120),

  bankName: z.string().max(120).optional().nullable(),
  accountName: z.string().max(120).optional().nullable(),
  accountNumber: z.string().max(60).optional().nullable(),
  branchName: z.string().max(120).optional().nullable(),
  branchCode: z.string().max(40).optional().nullable(),
  swiftCode: z.string().max(20).optional().nullable(),

  walletNumber: z.string().max(40).optional().nullable(),
  walletName: z.string().max(120).optional().nullable(),

  instructions: z.string().max(1000).optional().nullable(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
})

/**
 * A destination nobody can pay into is worse than none — the member
 * follows instructions that go nowhere. Bank rails need an account
 * number; wallet rails need a number to send to.
 */
function validateShape(d: z.infer<typeof DestinationSchema>): string | null {
  if (d.method === 'BANK_TRANSFER') {
    if (!d.bankName?.trim()) return 'Bank name is required for a bank transfer destination'
    if (!d.accountName?.trim()) return 'Account name is required'
    if (!d.accountNumber?.trim()) return 'Account number is required'
  } else {
    if (!d.walletNumber?.trim()) return 'Wallet number is required for a mobile money destination'
  }
  return null
}

async function requireAdmin(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return { error: unauthorized(), session: null }
  if (!ADMIN_ROLES.includes(session.role)) {
    return { error: forbidden('Only System and National Admins can manage payment destinations'), session: null }
  }
  return { error: null, session }
}

// ── GET ───────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const country = searchParams.get('country')
    const memberView = searchParams.get('member') === '1'

    // Member view: any authenticated user, active rows only, and NOTHING
    // beyond what they need in order to pay.
    if (memberView) {
      const session = await getSessionFromRequest(req)
      if (!session) return unauthorized()
      if (!country) {
        return NextResponse.json({ success: false, error: 'country is required' }, { status: 400 })
      }

      const rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT "id","method","displayName","currency",
                "bankName","accountName","accountNumber","branchName","branchCode","swiftCode",
                "walletNumber","walletName","instructions"
         FROM "RefPaymentDestination"
         WHERE "countryCode" = $1 AND "isActive" = true
         ORDER BY "sortOrder" ASC, "displayName" ASC`,
        country.toUpperCase()
      )
      return NextResponse.json({ success: true, data: rows })
    }

    const { error } = await requireAdmin(req)
    if (error) return error

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "RefPaymentDestination"
       ${country ? 'WHERE "countryCode" = $1' : ''}
       ORDER BY "countryCode" ASC, "sortOrder" ASC, "displayName" ASC`,
      ...(country ? [country.toUpperCase()] : [])
    )

    // Coverage gaps — a method offered in RefJoiningFee with no live
    // destination behind it. These are dead ends a member only finds
    // at the moment of paying.
    const gaps = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT f."countryCode", f."countryName", f."currency", m.method
      FROM "RefJoiningFee" f
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(f."paymentMethods"::jsonb) = 'array'
             THEN f."paymentMethods"::jsonb ELSE '[]'::jsonb END
      ) AS m(method)
      WHERE f."isActive" = true
        AND m.method <> 'CARD'
        AND NOT EXISTS (
          SELECT 1 FROM "RefPaymentDestination" d
          WHERE d."countryCode" = f."countryCode"
            AND d."method" = m.method
            AND d."isActive" = true
        )
      ORDER BY f."countryCode", m.method
      `
    ).catch(() => [])

    return NextResponse.json({
      success: true,
      data: rows.map(r => ({ ...r, sortOrder: Number(r.sortOrder) })),
      gaps,
    })
  } catch (e: any) {
    console.error('GET /api/payment-destinations error:', e?.message)
    return NextResponse.json({ success: false, error: 'Could not load payment destinations' }, { status: 500 })
  }
}

// ── POST ──────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { error, session } = await requireAdmin(req)
    if (error) return error

    const parsed = DestinationSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      )
    }
    const shapeError = validateShape(parsed.data)
    if (shapeError) {
      return NextResponse.json({ success: false, error: shapeError }, { status: 400 })
    }

    const d = parsed.data
    const id = randomUUID()

    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "RefPaymentDestination"
           ("id","countryCode","currency","method","displayName",
            "bankName","accountName","accountNumber","branchName","branchCode","swiftCode",
            "walletNumber","walletName","instructions","isActive","sortOrder")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        id, d.countryCode.toUpperCase(), d.currency.toUpperCase(), d.method, d.displayName.trim(),
        d.bankName || null, d.accountName || null, d.accountNumber || null,
        d.branchName || null, d.branchCode || null, d.swiftCode || null,
        d.walletNumber || null, d.walletName || null, d.instructions || null,
        d.isActive ?? true, d.sortOrder ?? 0
      )
    } catch (e: any) {
      if (String(e?.message || '').includes('uq_refpaymentdestination_live')) {
        return NextResponse.json({
          success: false,
          error: 'A live destination already exists for that country, method and currency. Retire it first.',
        }, { status: 409 })
      }
      throw e
    }

    await prisma.auditLog.create({
      data: {
        userId: session!.id,
        action: 'CREATE',
        entityType: 'RefPaymentDestination',
        entityId: id,
        newValues: { ...d, accountNumber: d.accountNumber, walletNumber: d.walletNumber },
        ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown',
        description: `Payment destination added: ${d.displayName} (${d.countryCode}/${d.method})`,
      },
    }).catch(() => {})

    return NextResponse.json({ success: true, message: 'Payment destination added', data: { id } })
  } catch (e: any) {
    console.error('POST /api/payment-destinations error:', e?.message)
    return NextResponse.json({ success: false, error: 'Could not save destination' }, { status: 500 })
  }
}

// ── PUT ───────────────────────────────────────────────────────
export async function PUT(req: NextRequest) {
  try {
    const { error, session } = await requireAdmin(req)
    if (error) return error

    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })

    const parsed = DestinationSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      )
    }
    const shapeError = validateShape(parsed.data)
    if (shapeError) {
      return NextResponse.json({ success: false, error: shapeError }, { status: 400 })
    }

    // Read before writing — the audit log needs the previous account
    // number. "Who changed it, from what, to what" is the first
    // question asked when money goes to the wrong place.
    const before = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "RefPaymentDestination" WHERE "id" = $1`, id
    )
    if (!before.length) {
      return NextResponse.json({ success: false, error: 'Destination not found' }, { status: 404 })
    }

    const d = parsed.data
    await prisma.$executeRawUnsafe(
      `UPDATE "RefPaymentDestination" SET
         "countryCode" = $2, "currency" = $3, "method" = $4, "displayName" = $5,
         "bankName" = $6, "accountName" = $7, "accountNumber" = $8,
         "branchName" = $9, "branchCode" = $10, "swiftCode" = $11,
         "walletNumber" = $12, "walletName" = $13, "instructions" = $14,
         "isActive" = $15, "sortOrder" = $16, "updatedAt" = now()
       WHERE "id" = $1`,
      id, d.countryCode.toUpperCase(), d.currency.toUpperCase(), d.method, d.displayName.trim(),
      d.bankName || null, d.accountName || null, d.accountNumber || null,
      d.branchName || null, d.branchCode || null, d.swiftCode || null,
      d.walletNumber || null, d.walletName || null, d.instructions || null,
      d.isActive ?? true, d.sortOrder ?? 0
    )

    await prisma.auditLog.create({
      data: {
        userId: session!.id,
        action: 'UPDATE',
        entityType: 'RefPaymentDestination',
        entityId: id,
        oldValues: {
          accountNumber: before[0].accountNumber,
          walletNumber: before[0].walletNumber,
          bankName: before[0].bankName,
          isActive: before[0].isActive,
        },
        newValues: {
          accountNumber: d.accountNumber,
          walletNumber: d.walletNumber,
          bankName: d.bankName,
          isActive: d.isActive ?? true,
        },
        ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown',
        description: `Payment destination updated: ${d.displayName} (${d.countryCode}/${d.method})`,
      },
    }).catch(() => {})

    return NextResponse.json({ success: true, message: 'Payment destination updated' })
  } catch (e: any) {
    console.error('PUT /api/payment-destinations error:', e?.message)
    return NextResponse.json({ success: false, error: 'Could not update destination' }, { status: 500 })
  }
}

// ── DELETE — retire, never remove ─────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const { error, session } = await requireAdmin(req)
    if (error) return error

    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })

    const updated = await prisma.$executeRawUnsafe(
      `UPDATE "RefPaymentDestination"
       SET "isActive" = false, "updatedAt" = now()
       WHERE "id" = $1 AND "isActive" = true`,
      id
    )
    if (Number(updated) === 0) {
      return NextResponse.json({ success: false, error: 'Destination not found or already retired' }, { status: 404 })
    }

    await prisma.auditLog.create({
      data: {
        userId: session!.id,
        action: 'UPDATE',
        entityType: 'RefPaymentDestination',
        entityId: id,
        newValues: { isActive: false },
        ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown',
        description: 'Payment destination retired',
      },
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      message: 'Destination retired. It stays on record for past payments but is no longer offered.',
    })
  } catch (e: any) {
    console.error('DELETE /api/payment-destinations error:', e?.message)
    return NextResponse.json({ success: false, error: 'Could not retire destination' }, { status: 500 })
  }
}
