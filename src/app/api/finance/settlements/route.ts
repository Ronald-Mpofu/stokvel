// src/app/api/finance/settlements/route.ts
// GET  ?status=EXPECTED|RECEIVED|RECONCILED|DISCREPANCY (optional) → batches + linked attempt totals
// POST → create a settlement batch and link succeeded, unsettled attempts for the provider/period
// PUT  → reconcile a batch against the Australian bank account (FX rate, bank refs)

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma/client';

export const dynamic = 'force-dynamic';

const CreateSchema = z.object({
  provider: z.string().min(2),
  batchRef: z.string().min(1),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
});

const ReconcileSchema = z.object({
  id: z.string().uuid(),
  fxRate: z.number().positive(),          // collection currency → AUD
  settledAmount: z.number().positive(),   // AUD received in bank
  bankAccountRef: z.string().min(1),
  bankStatementRef: z.string().optional(),
  notes: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');

    // One query: batches + attempt aggregates (no N+1)
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT s.*,
              COALESCE(a."attemptCount", 0)   AS "attemptCount",
              COALESCE(a."attemptGross", 0)   AS "attemptGross",
              COALESCE(a."attemptFees", 0)    AS "attemptFees"
       FROM "SettlementBatch" s
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS "attemptCount",
                SUM(pa."amount") AS "attemptGross",
                SUM(pa."providerFeeAmount") AS "attemptFees"
         FROM "PaymentAttempt" pa
         WHERE pa."settlementBatchId" = s."id"
       ) a ON true
       ${status ? `WHERE s."status" = $1` : ''}
       ORDER BY s."periodEnd" DESC
       LIMIT 100`,
      ...(status ? [status] : [])
    );

    return NextResponse.json({ success: true, data: rows });
  } catch (e: any) {
    console.error('GET /api/finance/settlements error:', e?.message);
    return NextResponse.json({ success: false, error: 'Failed to load settlements' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = CreateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.errors[0]?.message }, { status: 400 });
    }
    const { provider, batchRef, periodStart, periodEnd } = parsed.data;

    const id = randomUUID();

    // Aggregate succeeded, unlinked attempts for the window in one statement
    const agg: any[] = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM("amount"),0) AS "gross",
              COALESCE(SUM("providerFeeAmount"),0) AS "fees",
              MIN("currency") AS "currency",
              COUNT(*)::int AS "count"
       FROM "PaymentAttempt"
       WHERE "provider" = $1 AND "status" = 'SUCCEEDED'
         AND "settlementBatchId" IS NULL
         AND "updatedAt" >= $2::timestamptz AND "updatedAt" <= $3::timestamptz`,
      provider, periodStart, periodEnd
    );
    if (!agg[0]?.count) {
      return NextResponse.json({ success: false, error: 'No unsettled payments in this period' }, { status: 400 });
    }

    await prisma.$executeRawUnsafe(
      `INSERT INTO "SettlementBatch"
         ("id","provider","batchRef","periodStart","periodEnd","grossAmount","grossCurrency","providerFees","status")
       VALUES ($1,$2,$3,$4::timestamptz,$5::timestamptz,$6,$7,$8,'EXPECTED')`,
      id, provider, batchRef, periodStart, periodEnd,
      agg[0].gross, agg[0].currency, agg[0].fees
    );

    // Link attempts to the batch
    await prisma.$executeRawUnsafe(
      `UPDATE "PaymentAttempt"
       SET "settlementBatchId" = $1, "updatedAt" = now()
       WHERE "provider" = $2 AND "status" = 'SUCCEEDED'
         AND "settlementBatchId" IS NULL
         AND "updatedAt" >= $3::timestamptz AND "updatedAt" <= $4::timestamptz`,
      id, provider, periodStart, periodEnd
    );

    return NextResponse.json({
      success: true,
      message: `Settlement batch created with ${agg[0].count} payments`,
      data: { id, grossAmount: Number(agg[0].gross), providerFees: Number(agg[0].fees), currency: agg[0].currency },
    });
  } catch (e: any) {
    console.error('POST /api/finance/settlements error:', e?.message);
    return NextResponse.json({ success: false, error: 'Failed to create settlement batch' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const parsed = ReconcileSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.errors[0]?.message }, { status: 400 });
    }
    const { id, fxRate, settledAmount, bankAccountRef, bankStatementRef, notes } = parsed.data;

    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "grossAmount","providerFees" FROM "SettlementBatch" WHERE "id" = $1 LIMIT 1`,
      id
    );
    if (!rows.length) {
      return NextResponse.json({ success: false, error: 'Settlement batch not found' }, { status: 404 });
    }

    // Expected AUD = (gross − provider fees) × fxRate; discrepancy = actual − expected
    const expectedAud = (Number(rows[0].grossAmount) - Number(rows[0].providerFees)) * fxRate;
    const discrepancy = settledAmount - expectedAud;
    const status = Math.abs(discrepancy) < 0.01 ? 'RECONCILED' : 'DISCREPANCY';

    await prisma.$executeRawUnsafe(
      `UPDATE "SettlementBatch"
       SET "fxRate" = $2, "fxRateDate" = now(), "settledAmount" = $3,
           "bankAccountRef" = $4, "bankStatementRef" = $5,
           "status" = $6, "discrepancyAmount" = $7,
           "reconciledAt" = now(), "notes" = COALESCE($8, "notes"), "updatedAt" = now()
       WHERE "id" = $1`,
      id, fxRate, settledAmount, bankAccountRef, bankStatementRef || null,
      status, discrepancy, notes || null
    );

    return NextResponse.json({
      success: true,
      message: status === 'RECONCILED'
        ? 'Batch reconciled to bank account'
        : `Reconciled with discrepancy of ${discrepancy.toFixed(2)} AUD — review required`,
      data: { status, expectedAud: Number(expectedAud.toFixed(2)), discrepancy: Number(discrepancy.toFixed(2)) },
    });
  } catch (e: any) {
    console.error('PUT /api/finance/settlements error:', e?.message);
    return NextResponse.json({ success: false, error: 'Failed to reconcile settlement' }, { status: 500 });
  }
}
