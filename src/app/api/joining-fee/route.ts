// src/app/api/joining-fee/route.ts
// GET  ?type=config                 → all active countries + fees + methods (single call, cache 5 min)
// GET  ?userId=xxx                  → user's current invoice + latest attempt status
// POST { userId, countryCode, provider, phone? } → create/reuse invoice, create attempt, call provider

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma/client';

export const dynamic = 'force-dynamic';

const PROVIDERS = ['ECOCASH', 'MPESA', 'MTN_MOMO', 'BANK_TRANSFER', 'CARD', 'USSD'] as const;

const InitiateSchema = z.object({
  userId: z.string().uuid(),
  countryCode: z.string().length(2),
  provider: z.enum(PROVIDERS),
  phone: z.string().min(6).optional(), // required for mobile money
});

// ------------------------------------------------------------------
// GET
// ------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type');
    const userId = searchParams.get('userId');

    if (type === 'config') {
      // One query, minimal columns — powers the whole frontend flow
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT "countryCode","countryName","currency","amount","paymentMethods"
         FROM "RefJoiningFee"
         WHERE "isActive" = true
         ORDER BY "countryName" ASC`
      );
      const data = rows.map(r => ({
        countryCode: r.countryCode,
        countryName: r.countryName,
        currency: r.currency,
        amount: Number(r.amount),
        paymentMethods: Array.isArray(r.paymentMethods)
          ? r.paymentMethods
          : JSON.parse(r.paymentMethods || '[]'),
      }));
      return NextResponse.json(
        { success: true, data },
        { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' } }
      );
    }

    if (userId) {
      // Invoice + latest attempt in one round trip each — indexed lookups
      const invoices: any[] = await prisma.$queryRawUnsafe(
        `SELECT i."id", i."invoiceNo", i."currency", i."amount", i."status", i."paidAt",
                a."id" AS "attemptId", a."provider", a."status" AS "attemptStatus", a."failureReason"
         FROM "JoiningFeeInvoice" i
         LEFT JOIN LATERAL (
           SELECT * FROM "PaymentAttempt" pa
           WHERE pa."invoiceId" = i."id"
           ORDER BY pa."createdAt" DESC LIMIT 1
         ) a ON true
         WHERE i."userId" = $1
         ORDER BY i."createdAt" DESC
         LIMIT 1`,
        userId
      );
      return NextResponse.json({ success: true, data: invoices[0] || null });
    }

    return NextResponse.json({ success: false, error: 'Missing type=config or userId' }, { status: 400 });
  } catch (e: any) {
    console.error('GET /api/joining-fee error:', e?.message);
    return NextResponse.json({ success: false, error: 'Failed to load joining fee data' }, { status: 500 });
  }
}

// ------------------------------------------------------------------
// POST — create/reuse invoice, create payment attempt, call provider
// ------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = InitiateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message || 'Invalid request' },
        { status: 400 }
      );
    }
    const { userId, countryCode, provider, phone } = parsed.data;

    // Already paid?
    const paidCheck: any[] = await prisma.$queryRawUnsafe(
      `SELECT "joiningFeePaid" FROM "User" WHERE "id" = $1`,
      userId
    );
    if (!paidCheck.length) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }
    if (paidCheck[0].joiningFeePaid) {
      return NextResponse.json({ success: false, error: 'Joining fee already paid' }, { status: 409 });
    }

    // Fee config
    const feeRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "currency","amount","paymentMethods" FROM "RefJoiningFee"
       WHERE "countryCode" = $1 AND "isActive" = true LIMIT 1`,
      countryCode
    );
    if (!feeRows.length) {
      return NextResponse.json({ success: false, error: 'No joining fee configured for this country' }, { status: 400 });
    }
    const fee = feeRows[0];
    const methods: string[] = Array.isArray(fee.paymentMethods)
      ? fee.paymentMethods
      : JSON.parse(fee.paymentMethods || '[]');
    if (!methods.includes(provider)) {
      return NextResponse.json({ success: false, error: `${provider} is not available in this country` }, { status: 400 });
    }
    if (['ECOCASH', 'MPESA', 'MTN_MOMO'].includes(provider) && !phone) {
      return NextResponse.json({ success: false, error: 'Mobile number is required for this payment method' }, { status: 400 });
    }

    // Reuse pending invoice or create one (unique partial index guarantees single PENDING)
    let invoice: any;
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id","invoiceNo","currency","amount" FROM "JoiningFeeInvoice"
       WHERE "userId" = $1 AND "status" = 'PENDING' LIMIT 1`,
      userId
    );
    if (existing.length) {
      invoice = existing[0];
    } else {
      const invoiceId = randomUUID();
      const invoiceNo = `JF-${new Date().getFullYear()}-${invoiceId.slice(0, 8).toUpperCase()}`;
      const created: any[] = await prisma.$queryRawUnsafe(
        `INSERT INTO "JoiningFeeInvoice"
           ("id","invoiceNo","userId","countryCode","currency","amount","expiresAt")
         VALUES ($1,$2,$3,$4,$5,$6, now() + interval '48 hours')
         RETURNING "id","invoiceNo","currency","amount"`,
        invoiceId, invoiceNo, userId, countryCode, fee.currency, fee.amount
      );
      invoice = created[0];
    }

    // Create attempt
    const attemptId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PaymentAttempt"
         ("id","invoiceId","userId","provider","amount","currency","status")
       VALUES ($1,$2,$3,$4,$5,$6,'INITIATED')`,
      attemptId, invoice.id, userId, provider, invoice.amount, invoice.currency
    );

    // Call provider API (adapter pattern — swap stubs for real integrations)
    const providerResult = await initiateWithProvider({
      provider,
      attemptId,
      amount: Number(invoice.amount),
      currency: invoice.currency,
      phone,
      reference: invoice.invoiceNo,
    });

    await prisma.$executeRawUnsafe(
      `UPDATE "PaymentAttempt"
       SET "providerRef" = $2, "status" = $3, "failureReason" = $4, "updatedAt" = now()
       WHERE "id" = $1`,
      attemptId, providerResult.providerRef || null,
      providerResult.ok ? 'PENDING' : 'FAILED',
      providerResult.ok ? null : providerResult.error || 'Provider initiation failed'
    );

    if (!providerResult.ok) {
      return NextResponse.json({ success: false, error: providerResult.error || 'Payment could not be started' }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      message: providerResult.userMessage,
      data: {
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo,
        attemptId,
        provider,
        amount: Number(invoice.amount),
        currency: invoice.currency,
        instructions: providerResult.instructions || null,
      },
    });
  } catch (e: any) {
    console.error('POST /api/joining-fee error:', e?.message);
    return NextResponse.json({ success: false, error: 'Failed to initiate payment' }, { status: 500 });
  }
}

// ------------------------------------------------------------------
// Provider adapters (stubs — replace bodies with real API calls)
// ------------------------------------------------------------------
type ProviderInit = {
  provider: string; attemptId: string; amount: number;
  currency: string; phone?: string; reference: string;
};
type ProviderResult = {
  ok: boolean; providerRef?: string; error?: string;
  userMessage?: string; instructions?: string;
};

async function initiateWithProvider(p: ProviderInit): Promise<ProviderResult> {
  switch (p.provider) {
    case 'ECOCASH':
    case 'MPESA':
    case 'MTN_MOMO':
      // TODO: real STK-push / USSD-push API call using env credentials
      return {
        ok: true,
        providerRef: `SIM-${p.attemptId.slice(0, 12)}`,
        userMessage: 'A payment prompt has been sent to your phone. Approve it to complete payment.',
        instructions: `Approve the ${p.provider} prompt for ${p.currency} ${p.amount} on ${p.phone}.`,
      };
    case 'BANK_TRANSFER':
      return {
        ok: true,
        providerRef: null as any,
        userMessage: 'Bank transfer details generated.',
        instructions: `Transfer ${p.currency} ${p.amount} using reference ${p.reference}. Your membership activates once the payment is confirmed.`,
      };
    case 'CARD':
    case 'USSD':
      // TODO: return hosted checkout URL from gateway
      return {
        ok: true,
        providerRef: `SIM-${p.attemptId.slice(0, 12)}`,
        userMessage: 'Redirecting to secure checkout.',
      };
    default:
      return { ok: false, error: 'Unsupported provider' };
  }
}
