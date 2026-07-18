// src/app/api/payments/webhook/route.ts
// Stripe webhook. Public route (allowlisted in middleware) — Stripe calls
// it server-to-server with no cookie and authenticates via signature.
//
// TWO subscription scopes flow through here, split on metadata.scope:
//
//   MEMBER_ANNUAL  (joining fee)
//     checkout.session.completed → settle the PaymentAttempt created by
//                                  POST /api/joining-fee
//     invoice.paid (cycle)       → renewal: create fresh invoice+attempt,
//                                  settle, extend joiningFeeExpiresAt
//
//   GROUP_MONTHLY  (group subscription)
//     checkout.session.completed → mark PlatformSubscription active and
//                                  flip the Group to ACTIVE — the group
//                                  does not activate until payment lands
//     invoice.paid (cycle)       → extend currentPeriodEnd + FEE Transaction
//     customer.subscription.deleted → Group falls to PAUSED (not deleted —
//                                  no data loss, feature lockout only)
//
// Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET

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
// MEMBER_ANNUAL: settle a successful payment. Idempotent by attempt status.
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
// Prefers a match on stripeSubscriptionId, then stripeCheckoutId
// (the group-checkout route pre-creates an 'incomplete' row keyed by
// checkout id, before the subscription id exists).
// ------------------------------------------------------------------
async function upsertSubscription(params: {
  scope: string;
  userId: string;
  groupId: string | null;
  customerId: string;
  subscriptionId: string;
  checkoutId?: string | null;
  status: string;
  currency: string;
  amount: number;
  periodEnd: Date | null;
}) {
  const bySub: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "PlatformSubscription" WHERE "stripeSubscriptionId" = $1 LIMIT 1`,
    params.subscriptionId
  );
  let rowId: string | null = bySub[0]?.id ?? null;

  if (!rowId && params.checkoutId) {
    const byCheckout: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "PlatformSubscription" WHERE "stripeCheckoutId" = $1 LIMIT 1`,
      params.checkoutId
    );
    rowId = byCheckout[0]?.id ?? null;
  }

  if (rowId) {
    await prisma.$executeRawUnsafe(
      `UPDATE "PlatformSubscription"
       SET "stripeSubscriptionId" = $2, "status" = $3, "currentPeriodEnd" = $4,
           "amount" = $5, "currency" = $6, "updatedAt" = now()
       WHERE "id" = $1`,
      rowId, params.subscriptionId, params.status, params.periodEnd,
      params.amount, params.currency
    );
    return;
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO "PlatformSubscription"
       ("id","scope","userId","groupId","stripeCustomerId","stripeSubscriptionId",
        "stripeCheckoutId","status","currency","amount","currentPeriodEnd")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    randomUUID(), params.scope, params.userId, params.groupId,
    params.customerId, params.subscriptionId, params.checkoutId ?? null,
    params.status, params.currency, params.amount, params.periodEnd
  );
}

// ------------------------------------------------------------------
// GROUP_MONTHLY: a FEE Transaction tied to the group.
// ------------------------------------------------------------------
async function recordGroupFeeTransaction(params: {
  groupId: string;
  userId: string;
  amount: number;
  currency: string;
  providerRef: string;
}) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Transaction"
       ("id","type","status","amount","currency","description","reference","externalRef","paymentMethod","groupId","userId","metadata","createdAt")
     VALUES ($1, $2::"TransactionType", $3::"TransactionStatus", $4, $5::"CurrencyCode",
             'Group monthly subscription', $6, $7, $8::"PaymentMethod", $9, $10, $11::jsonb, now())`,
    randomUUID(), 'FEE', 'COMPLETED', params.amount, params.currency,
    randomUUID(), params.providerRef, PROVIDER, params.groupId, params.userId,
    JSON.stringify({ rail: 'STRIPE', scope: 'GROUP_MONTHLY' })
  );
}

// ------------------------------------------------------------------
// MEMBER_ANNUAL renewal — no checkout happened, so create records.
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
      // ── First payment (both scopes) ──────────────────────────
      case 'checkout.session.completed': {
        const session = event.data.object as any;
        const scope = session.metadata?.scope || 'MEMBER_ANNUAL';

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

        // ── GROUP_MONTHLY: activate the group ──────────────────
        if (scope === 'GROUP_MONTHLY') {
          const groupId: string | null = session.metadata?.groupId || null;
          const userId: string | null = session.metadata?.userId || null;
          if (!groupId || !userId || !subscriptionId) {
            console.error('POST /api/payments/webhook: group checkout missing metadata', session.id);
            return NextResponse.json({ success: true, message: 'Missing group metadata; ignored' });
          }

          // Idempotency — an already-active subscription means we ran.
          const already: any[] = await prisma.$queryRawUnsafe(
            `SELECT "id" FROM "PlatformSubscription"
             WHERE "stripeSubscriptionId" = $1 AND "status" = 'active' LIMIT 1`,
            subscriptionId
          );
          if (already.length) {
            return NextResponse.json({ success: true, message: 'Already processed' });
          }

          const currency = String(session.currency || 'usd').toUpperCase();
          const amount = toDecimal(session.amount_total, currency);

          await upsertSubscription({
            scope: 'GROUP_MONTHLY',
            userId,
            groupId,
            customerId: session.customer as string,
            subscriptionId,
            checkoutId: session.id,
            status: subStatus,
            currency,
            amount,
            periodEnd,
          });

          // The activation itself — DRAFT/PAUSED only; enum cast required.
          await prisma.$executeRawUnsafe(
            `UPDATE "Group"
             SET "status" = 'ACTIVE'::"GroupStatus", "updatedAt" = now()
             WHERE "id" = $1 AND "status" IN ('DRAFT'::"GroupStatus", 'PAUSED'::"GroupStatus")`,
            groupId
          );

          await recordGroupFeeTransaction({
            groupId, userId, amount, currency, providerRef: session.id,
          });

          return NextResponse.json({ success: true, message: 'Group subscription active — group activated' });
        }

        // ── MEMBER_ANNUAL: settle the joining-fee attempt ──────
        const providerRef = session.id as string;
        const attempts: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id","invoiceId","userId","status","amount","currency"
           FROM "PaymentAttempt"
           WHERE "provider" = $1 AND "providerRef" = $2
           LIMIT 1`,
          PROVIDER, providerRef
        );
        if (!attempts.length) {
          console.error('POST /api/payments/webhook: no attempt for session', providerRef);
          return NextResponse.json({ success: true, message: 'No matching attempt; ignored' });
        }
        const attempt = attempts[0];

        if (attempt.status === 'SUCCEEDED' || attempt.status === 'FAILED') {
          return NextResponse.json({ success: true, message: 'Already processed' });
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
            scope: 'MEMBER_ANNUAL',
            userId: attempt.userId,
            groupId: null,
            customerId: session.customer as string,
            subscriptionId,
            checkoutId: session.id,
            status: subStatus,
            currency: attempt.currency,
            amount: Number(attempt.amount),
            periodEnd,
          });
        }

        return NextResponse.json({ success: true, message: 'Payment confirmed and membership activated' });
      }

      // ── Renewal (both scopes) ────────────────────────────────
      case 'invoice.paid': {
        const invoice = event.data.object as any;

        // The first invoice of a subscription is already handled by
        // checkout.session.completed — only cycle renewals land here.
        if (invoice.billing_reason !== 'subscription_cycle') {
          return NextResponse.json({ success: true, message: 'Not a renewal; ignored' });
        }

        const subscriptionId: string | null = invoice.subscription || null;
        if (!subscriptionId) {
          return NextResponse.json({ success: true, message: 'No subscription on invoice; ignored' });
        }

        const sub = await getStripe().subscriptions.retrieve(subscriptionId);
        const meta = (sub as any).metadata || {};
        const scope = meta.scope || 'MEMBER_ANNUAL';
        const userId: string | undefined = meta.userId;
        const providerRef = invoice.id as string;
        const currency = String(invoice.currency || 'usd').toUpperCase();
        const amount = toDecimal(invoice.amount_paid, currency);
        const periodEnd = invoicePeriodEnd(invoice) ?? subscriptionPeriodEnd(sub);

        // ── GROUP_MONTHLY renewal: extend the period, no member
        //    records — JoiningFeeInvoice/User columns are member-only.
        if (scope === 'GROUP_MONTHLY') {
          const groupId: string | null = meta.groupId || null;

          // Idempotency: has this invoice already produced a Transaction?
          const seenTx: any[] = await prisma.$queryRawUnsafe(
            `SELECT "id" FROM "Transaction" WHERE "externalRef" = $1 LIMIT 1`,
            providerRef
          );
          if (seenTx.length) {
            return NextResponse.json({ success: true, message: 'Already processed' });
          }

          await prisma.$executeRawUnsafe(
            `UPDATE "PlatformSubscription"
             SET "status" = 'active', "currentPeriodEnd" = $2, "updatedAt" = now()
             WHERE "stripeSubscriptionId" = $1`,
            subscriptionId, periodEnd
          );

          if (groupId && userId) {
            await recordGroupFeeTransaction({
              groupId, userId, amount, currency, providerRef,
            });
          }

          return NextResponse.json({ success: true, message: 'Group renewal settled' });
        }

        // ── MEMBER_ANNUAL renewal ──────────────────────────────
        if (!userId) {
          console.error('POST /api/payments/webhook: renewal without userId metadata', subscriptionId);
          return NextResponse.json({ success: true, message: 'No userId metadata; ignored' });
        }

        // Idempotency by providerRef — the renewal records are created
        // here, so their presence means we already ran.
        const seen: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id" FROM "PaymentAttempt"
           WHERE "provider" = $1 AND "providerRef" = $2 LIMIT 1`,
          PROVIDER, providerRef
        );
        if (seen.length) {
          return NextResponse.json({ success: true, message: 'Already processed' });
        }

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
          scope: 'MEMBER_ANNUAL',
          userId,
          groupId: null,
          customerId: invoice.customer as string,
          subscriptionId,
          status: (sub as any).status || 'active',
          currency,
          amount,
          periodEnd,
        });

        return NextResponse.json({ success: true, message: 'Renewal settled' });
      }

      // ── Failed payment (both scopes) ─────────────────────────
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
        // Nothing is revoked here — Stripe Smart Retries run for ~2 weeks.
        // Members stay paid until joiningFeeExpiresAt lapses; groups stay
        // ACTIVE until the subscription is deleted outright.
        console.error('POST /api/payments/webhook: payment failed for subscription', subscriptionId);
        return NextResponse.json({ success: true, message: 'Failure recorded' });
      }

      // ── Subscription ended (both scopes) ─────────────────────
      case 'customer.subscription.deleted': {
        const sub = event.data.object as any;
        const scope = sub.metadata?.scope || 'MEMBER_ANNUAL';

        await prisma.$executeRawUnsafe(
          `UPDATE "PlatformSubscription"
           SET "status" = 'canceled', "canceledAt" = now(), "updatedAt" = now()
           WHERE "stripeSubscriptionId" = $1`,
          sub.id
        );

        if (scope === 'GROUP_MONTHLY' && sub.metadata?.groupId) {
          // Group falls to PAUSED — features lock, data survives, and
          // re-activation simply runs the checkout again.
          await prisma.$executeRawUnsafe(
            `UPDATE "Group"
             SET "status" = 'PAUSED'::"GroupStatus", "updatedAt" = now()
             WHERE "id" = $1 AND "status" = 'ACTIVE'::"GroupStatus"`,
            sub.metadata.groupId
          );
          return NextResponse.json({ success: true, message: 'Group subscription ended — group paused' });
        }

        // MEMBER_ANNUAL: deliberately NOT flipping joiningFeePaid — the
        // member has paid through joiningFeeExpiresAt and keeps access
        // until then.
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
