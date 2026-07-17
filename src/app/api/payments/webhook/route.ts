// src/app/api/payments/webhook/route.ts
// Stripe webhook. Public route (allowlisted in middleware) — Stripe calls
// it server-to-server with no cookie and authenticates via signature.
//
// Events handled:
//   checkout.session.completed        → first payment: settle the attempt
//                                       created by POST /api/joining-fee
//   invoice.paid (subscription_cycle) → renewal: NO checkout happened, so
//                                       create a fresh invoice + attempt,
//                                       then settle them
//   invoice.payment_failed            → record the failure
//   customer.subscription.deleted     → subscription ended; membership
//                                       lapses at the end of the paid period
//
// Settlement mirrors /api/joining-fee/webhook exactly:
//   attempt SUCCEEDED → invoice PAID → immutable FEE Transaction
//   → User flags (+ joiningFeeExpiresAt, the renewal clock)
//
// Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
// Local: stripe listen --forward-to localhost:3000/api/payments/webhook
//        (that prints a DIFFERENT secret from the dashboard's)

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import type Stripe from 'stripe';
import { prisma } from '@/lib/prisma/client';
import { getStripe } from '@/lib/payments/stripe/client';

export const dynamic = 'force-dynamic';

const PROVIDER = 'CARD'; // matches RefJoiningFee.paymentMethods + PaymentAttempt.provider

// ------------------------------------------------------------------
// Period end — defensive across Stripe API versions.
// Newer versions moved current_period_end off Subscription and onto
// subscription items, so read both. Invoice line periods are the most
// stable source when an invoice is in hand.
// ------------------------------------------------------------------
function subscriptionPeriodEnd(sub: any): Date | null {
  const ts = sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end;
  return typeof ts === 'number' ? new Date(ts * 1000) : null;
}

function invoicePeriodEnd(inv: any): Date | null {
  const ts = inv?.lines?.data?.[0]?.period?.end;
  return typeof ts === 'number' ? new Date(ts * 1000) : null;
}

function toDecimal(minorUnits: number | null | undefined, currency: string): number {
  if (typeof minorUnits !== 'number') return 0;
  const zeroDecimal = ['UGX', 'JPY', 'KRW', 'VND', 'XAF', 'XOF', 'RWF'];
  return zeroDecimal.includes(currency.toUpperCase()) ? minorUnits : minorUnits / 100;
}

// ------------------------------------------------------------------
// Settle a successful payment. Idempotent by attempt status.
// ------------------------------------------------------------------
async function settleAttempt(params: {
  attemptId: string;
  invoiceId: string;
  userId: string;
  amount: number;
  currency: string;
  providerRef: string;
  providerFee: number;
  expiresAt: Date | null;
  payload: unknown;
}) {
  const { attemptId, invoiceId, userId, amount, currency, providerRef, providerFee, expiresAt } = params;
  const net = amount - providerFee;

  await prisma.$executeRawUnsafe(
    `UPDATE "PaymentAttempt"
     SET "status" = 'SUCCEEDED',
         "providerFeeAmount" = $2,
         "providerFeeCurrency" = $3,
         "netAmount" = $4,
         "webhookReceivedAt" = now(),
         "webhookSignatureOk" = true,
         "webhookPayload" = $5::jsonb,
         "updatedAt" = now()
     WHERE "id" = $1`,
    attemptId, providerFee, currency, net, JSON.stringify(params.payload)
  );

  await prisma.$executeRawUnsafe(
    `UPDATE "JoiningFeeInvoice"
     SET "status" = 'PAID', "paidAt" = now(), "updatedAt" = now()
     WHERE "id" = $1 AND "status" = 'PENDING'`,
    invoiceId
  );

  // Transaction IS in schema.prisma — enums must be cast explicitly.
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Transaction"
       ("id","type","status","amount","currency","description","reference","externalRef","paymentMethod","userId","metadata","createdAt")
     VALUES ($1, $2::"TransactionType", $3::"TransactionStatus", $4, $5::"CurrencyCode",
             'Community Deals joining fee', $6, $7, $8::"PaymentMethod", $9, $10::jsonb, now())`,
    randomUUID(), 'FEE', 'COMPLETED', amount, currency,
    randomUUID(), providerRef, PROVIDER, userId,
    JSON.stringify({ invoiceId, attemptId, providerFee, rail: 'STRIPE' })
  );

  await prisma.$executeRawUnsafe(
    `UPDATE "User"
     SET "joiningFeePaid" = true,
         "joiningFeePaidAt" = now(),
         "joiningFeeInvoiceId" = $2,
         "joiningFeeExpiresAt" = $3,
         "updatedAt" = now()
     WHERE "id" = $1`,
    userId, invoiceId, expiresAt
  );
}

// ------------------------------------------------------------------
// Mirror Stripe subscription state into PlatformSubscription.
// ------------------------------------------------------------------
async function upsertSubscription(params: {
  scope: string;
  userId: string;
  groupId: string | null;
  customerId: string;
  subscriptionId: string;
  status: string;
  currency: string;
  amount: number;
  periodEnd: Date | null;
}) {
  const existing: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "PlatformSubscription" WHERE "stripeSubscriptionId" = $1 LIMIT 1`,
    params.subscriptionId
  );

  if (existing.length) {
    await prisma.$executeRawUnsafe(
      `UPDATE "PlatformSubscription"
       SET "status" = $2, "currentPeriodEnd" = $3, "amount" = $4,
           "currency" = $5, "updatedAt" = now()
       WHERE "id" = $1`,
      existing[0].id, params.status, params.periodEnd, params.amount, params.currency
    );
    return;
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO "PlatformSubscription"
       ("id","scope","userId","groupId","stripeCustomerId","stripeSubscriptionId",
        "status","currency","amount","currentPeriodEnd")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    randomUUID(), params.scope, params.userId, params.groupId,
    params.customerId, params.subscriptionId, params.status,
    params.currency, params.amount, params.periodEnd
  );
}

// ------------------------------------------------------------------
// Renewal — Stripe billed a saved card with no checkout involved, so
// there is no pre-existing attempt to find. Create invoice + attempt.
// ------------------------------------------------------------------
async function createRenewalRecords(params: {
  userId: string;
  countryCode: string;
  currency: string;
  amount: number;
  providerRef: string;
}): Promise<{ invoiceId: string; attemptId: string }> {
  const invoiceId = randomUUID();
  const invoiceNo = `JF-${new Date().getFullYear()}-${invoiceId.slice(0, 8).toUpperCase()}`;

  await prisma.$executeRawUnsafe(
    `INSERT INTO "JoiningFeeInvoice"
       ("id","invoiceNo","userId","countryCode","currency","amount","status","expiresAt")
     VALUES ($1,$2,$3,$4,$5,$6,'PENDING', now() + interval '48 hours')`,
    invoiceId, invoiceNo, params.userId, params.countryCode, params.currency, params.amount
  );

  const attemptId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PaymentAttempt"
       ("id","invoiceId","userId","provider","providerRef","amount","currency","status")
     VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING')`,
    attemptId, invoiceId, params.userId, PROVIDER, params.providerRef,
    params.amount, params.currency
  );

  return { invoiceId, attemptId };
}

// ------------------------------------------------------------------
// POST
// ------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('POST /api/payments/webhook error: STRIPE_WEBHOOK_SECRET not set');
    return NextResponse.json({ success: false, error: 'Webhook not configured' }, { status: 500 });
  }

  // Signature verification needs the RAW body — req.json() would break it.
  const rawBody = await req.text();
  const signature = req.headers.get('stripe-signature');

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature || '', secret);
  } catch (e: any) {
    console.error('POST /api/payments/webhook error: signature verification failed:', e?.message);
    return NextResponse.json({ success: false, error: 'Invalid signature' }, { status: 401 });
  }

  try {
    switch (event.type) {
      // ── First payment ────────────────────────────────────────
      case 'checkout.session.completed': {
        const session = event.data.object as any;
        const providerRef = session.id as string;

        const attempts: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id","invoiceId","userId","status","amount","currency"
           FROM "PaymentAttempt"
           WHERE "provider" = $1 AND "providerRef" = $2
           LIMIT 1`,
          PROVIDER, providerRef
        );
        if (!attempts.length) {
          // Not ours (or created outside this flow) — ack so Stripe stops retrying.
          console.error('POST /api/payments/webhook: no attempt for session', providerRef);
          return NextResponse.json({ success: true, message: 'No matching attempt; ignored' });
        }
        const attempt = attempts[0];

        // Idempotency — Stripe retries, and events can arrive twice.
        if (attempt.status === 'SUCCEEDED' || attempt.status === 'FAILED') {
          return NextResponse.json({ success: true, message: 'Already processed' });
        }

        if (session.payment_status !== 'paid') {
          return NextResponse.json({ success: true, message: 'Session not paid; ignored' });
        }

        let periodEnd: Date | null = null;
        let subStatus = 'active';
        const subscriptionId: string | null = session.subscription || null;
        if (subscriptionId) {
          const sub = await getStripe().subscriptions.retrieve(subscriptionId);
          periodEnd = subscriptionPeriodEnd(sub);
          subStatus = (sub as any).status || 'active';
        }

        await settleAttempt({
          attemptId: attempt.id,
          invoiceId: attempt.invoiceId,
          userId: attempt.userId,
          amount: Number(attempt.amount),
          currency: attempt.currency,
          providerRef,
          providerFee: 0, // Stripe fees settle via Balance Transactions, not here
          expiresAt: periodEnd,
          payload: session,
        });

        if (subscriptionId) {
          await upsertSubscription({
            scope: session.metadata?.scope || 'MEMBER_ANNUAL',
            userId: attempt.userId,
            groupId: session.metadata?.groupId || null,
            customerId: session.customer as string,
            subscriptionId,
            status: subStatus,
            currency: attempt.currency,
            amount: Number(attempt.amount),
            periodEnd,
          });
        }

        return NextResponse.json({ success: true, message: 'Payment confirmed and membership activated' });
      }

      // ── Renewal ──────────────────────────────────────────────
      case 'invoice.paid': {
        const invoice = event.data.object as any;

        // The first invoice of a subscription is already handled by
        // checkout.session.completed — only cycle renewals land here.
        if (invoice.billing_reason !== 'subscription_cycle') {
          return NextResponse.json({ success: true, message: 'Not a renewal; ignored' });
        }

        const providerRef = invoice.id as string;

        // Idempotency by providerRef — the renewal records are created
        // here, so their presence means we already ran.
        const seen: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id","status" FROM "PaymentAttempt"
           WHERE "provider" = $1 AND "providerRef" = $2 LIMIT 1`,
          PROVIDER, providerRef
        );
        if (seen.length) {
          return NextResponse.json({ success: true, message: 'Already processed' });
        }

        const subscriptionId: string | null = invoice.subscription || null;
        if (!subscriptionId) {
          return NextResponse.json({ success: true, message: 'No subscription on invoice; ignored' });
        }

        const sub = await getStripe().subscriptions.retrieve(subscriptionId);
        const meta = (sub as any).metadata || {};
        const userId: string | undefined = meta.userId;
        if (!userId) {
          console.error('POST /api/payments/webhook: renewal without userId metadata', subscriptionId);
          return NextResponse.json({ success: true, message: 'No userId metadata; ignored' });
        }

        const currency = String(invoice.currency || 'usd').toUpperCase();
        const amount = toDecimal(invoice.amount_paid, currency);
        const periodEnd = invoicePeriodEnd(invoice) ?? subscriptionPeriodEnd(sub);

        const countryRows: any[] = await prisma.$queryRawUnsafe(
          `SELECT "country" FROM "User" WHERE "id" = $1 LIMIT 1`,
          userId
        );
        const countryCode = countryRows[0]?.country || meta.countryCode || 'AU';

        const { invoiceId, attemptId } = await createRenewalRecords({
          userId, countryCode, currency, amount, providerRef,
        });

        await settleAttempt({
          attemptId,
          invoiceId,
          userId,
          amount,
          currency,
          providerRef,
          providerFee: 0,
          expiresAt: periodEnd,
          payload: invoice,
        });

        await upsertSubscription({
          scope: meta.scope || 'MEMBER_ANNUAL',
          userId,
          groupId: meta.groupId || null,
          customerId: invoice.customer as string,
          subscriptionId,
          status: (sub as any).status || 'active',
          currency,
          amount,
          periodEnd,
        });

        return NextResponse.json({ success: true, message: 'Renewal settled' });
      }

      // ── Failed payment ───────────────────────────────────────
      case 'invoice.payment_failed': {
        const invoice = event.data.object as any;
        const subscriptionId: string | null = invoice.subscription || null;
        if (subscriptionId) {
          await prisma.$executeRawUnsafe(
            `UPDATE "PlatformSubscription"
             SET "status" = 'past_due', "updatedAt" = now()
             WHERE "stripeSubscriptionId" = $1`,
            subscriptionId
          );
        }
        // Membership is NOT revoked here — Stripe Smart Retries run for
        // ~2 weeks. The user stays paid until joiningFeeExpiresAt lapses
        // or the subscription is deleted outright.
        console.error('POST /api/payments/webhook: payment failed for subscription', subscriptionId);
        return NextResponse.json({ success: true, message: 'Failure recorded' });
      }

      // ── Subscription ended ───────────────────────────────────
      case 'customer.subscription.deleted': {
        const sub = event.data.object as any;
        await prisma.$executeRawUnsafe(
          `UPDATE "PlatformSubscription"
           SET "status" = 'canceled', "canceledAt" = now(), "updatedAt" = now()
           WHERE "stripeSubscriptionId" = $1`,
          sub.id
        );
        // Deliberately NOT flipping joiningFeePaid — the member has paid
        // through joiningFeeExpiresAt and keeps access until then.
        return NextResponse.json({ success: true, message: 'Subscription cancelled' });
      }

      default:
        return NextResponse.json({ success: true, message: `Unhandled event ${event.type}` });
    }
  } catch (e: any) {
    console.error('POST /api/payments/webhook error:', e?.message);
    // 500 makes Stripe retry — correct for transient DB failures.
    return NextResponse.json({ success: false, error: 'Webhook processing failed' }, { status: 500 });
  }
}
