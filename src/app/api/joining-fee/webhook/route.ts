// src/app/api/joining-fee/webhook/route.ts
// POST — provider webhook/callback.
// Steps: 1) validate HMAC signature  2) locate attempt by providerRef
//        3) idempotency guard  4) update attempt (+provider fee)
//        5) mark invoice PAID  6) create immutable FEE Transaction
//        7) activate user membership
//
// Env vars required (one per provider):
//   WEBHOOK_SECRET_ECOCASH, WEBHOOK_SECRET_MPESA, WEBHOOK_SECRET_MTN_MOMO,
//   WEBHOOK_SECRET_CARD, WEBHOOK_SECRET_BANK
// Remember: changing Vercel env vars requires a manual redeploy.

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID, createHmac, timingSafeEqual } from 'crypto';
import { prisma } from '@/lib/prisma/client';

export const dynamic = 'force-dynamic';

const SECRET_MAP: Record<string, string | undefined> = {
  ECOCASH: process.env.WEBHOOK_SECRET_ECOCASH,
  MPESA: process.env.WEBHOOK_SECRET_MPESA,
  MTN_MOMO: process.env.WEBHOOK_SECRET_MTN_MOMO,
  CARD: process.env.WEBHOOK_SECRET_CARD,
  USSD: process.env.WEBHOOK_SECRET_CARD,
  BANK_TRANSFER: process.env.WEBHOOK_SECRET_BANK,
};

function verifySignature(provider: string, rawBody: string, signature: string | null): boolean {
  const secret = SECRET_MAP[provider];
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-webhook-signature');
    const provider = (req.headers.get('x-provider') || '').toUpperCase();

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON payload' }, { status: 400 });
    }

    // 1. Validate signature BEFORE touching the database state
    const signatureOk = verifySignature(provider, rawBody, signature);

    // Normalised fields (map per real provider spec)
    const providerRef: string | undefined = payload.providerRef || payload.transactionId || payload.CheckoutRequestID;
    const outcome: string = String(payload.status || payload.ResultCode === 0 ? 'SUCCESS' : payload.status || 'FAILED').toUpperCase();
    const providerFee = Number(payload.providerFee ?? payload.fee ?? 0);

    if (!providerRef) {
      return NextResponse.json({ success: false, error: 'Missing provider reference' }, { status: 400 });
    }

    // 2. Locate the attempt (indexed on provider + providerRef)
    const attempts: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id","invoiceId","userId","status","amount","currency"
       FROM "PaymentAttempt"
       WHERE "provider" = $1 AND "providerRef" = $2
       LIMIT 1`,
      provider, providerRef
    );
    if (!attempts.length) {
      return NextResponse.json({ success: false, error: 'Unknown payment reference' }, { status: 404 });
    }
    const attempt = attempts[0];

    // Always record the webhook for audit, even on bad signature
    await prisma.$executeRawUnsafe(
      `UPDATE "PaymentAttempt"
       SET "webhookReceivedAt" = now(), "webhookSignatureOk" = $2, "webhookPayload" = $3::jsonb, "updatedAt" = now()
       WHERE "id" = $1`,
      attempt.id, signatureOk, JSON.stringify(payload)
    );

    if (!signatureOk) {
      console.error('POST /api/joining-fee/webhook error: invalid signature for', provider, providerRef);
      return NextResponse.json({ success: false, error: 'Invalid signature' }, { status: 401 });
    }

    // 3. Idempotency — a settled attempt is never re-processed
    if (attempt.status === 'SUCCEEDED' || attempt.status === 'FAILED') {
      return NextResponse.json({ success: true, message: 'Already processed' });
    }

    const succeeded = outcome === 'SUCCESS' || outcome === 'SUCCEEDED' || outcome === 'COMPLETED';

    if (!succeeded) {
      await prisma.$executeRawUnsafe(
        `UPDATE "PaymentAttempt"
         SET "status" = 'FAILED', "failureReason" = $2, "updatedAt" = now()
         WHERE "id" = $1`,
        attempt.id, String(payload.reason || payload.ResultDesc || 'Payment failed')
      );
      return NextResponse.json({ success: true, message: 'Failure recorded' });
    }

    // 4. Success — update attempt with provider fee + net
    const net = Number(attempt.amount) - providerFee;
    await prisma.$executeRawUnsafe(
      `UPDATE "PaymentAttempt"
       SET "status" = 'SUCCEEDED',
           "providerFeeAmount" = $2,
           "providerFeeCurrency" = $3,
           "netAmount" = $4,
           "updatedAt" = now()
       WHERE "id" = $1`,
      attempt.id, providerFee, attempt.currency, net
    );

    // 5. Mark invoice paid
    await prisma.$executeRawUnsafe(
      `UPDATE "JoiningFeeInvoice"
       SET "status" = 'PAID', "paidAt" = now(), "updatedAt" = now()
       WHERE "id" = $1 AND "status" = 'PENDING'`,
      attempt.invoiceId
    );

    // 6. Immutable FEE transaction (Transaction IS in schema.prisma — cast enums)
    const txnId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Transaction"
         ("id","type","status","amount","currency","description","reference","externalRef","paymentMethod","userId","metadata","createdAt")
       VALUES ($1, $2::"TransactionType", $3::"TransactionStatus", $4, $5::"CurrencyCode",
               'Community Deals joining fee', $6, $7, $8::"PaymentMethod", $9, $10::jsonb, now())`,
      txnId, 'FEE', 'COMPLETED', attempt.amount, attempt.currency,
      randomUUID(), providerRef, provider, attempt.userId,
      JSON.stringify({ invoiceId: attempt.invoiceId, attemptId: attempt.id, providerFee })
    );

    // 7. Activate membership
    await prisma.$executeRawUnsafe(
      `UPDATE "User"
       SET "joiningFeePaid" = true, "joiningFeePaidAt" = now(), "joiningFeeInvoiceId" = $2, "updatedAt" = now()
       WHERE "id" = $1`,
      attempt.userId, attempt.invoiceId
    );

    return NextResponse.json({ success: true, message: 'Payment confirmed and membership activated' });
  } catch (e: any) {
    console.error('POST /api/joining-fee/webhook error:', e?.message);
    return NextResponse.json({ success: false, error: 'Webhook processing failed' }, { status: 500 });
  }
}
