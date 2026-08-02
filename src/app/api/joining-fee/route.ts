// src/app/api/joining-fee/route.ts
// GET  ?type=config                 → all active countries + fees + methods (single call, cache 5 min)
// GET  ?userId=xxx                  → user's current invoice + latest attempt status + fee eligibility
// POST { userId, countryCode, provider, phone?, optIn? } → create/reuse invoice, create attempt, call provider
//
// CARD is a real Stripe path: it returns data.checkoutUrl for the
// frontend to redirect to. Mobile money remains stubbed.
//
// Version 2.0 — rule 3b (invited members are fee-exempt).
//
// ── WHAT CHANGED ─────────────────────────────────────────────
// 1. RULE 3b. The "already paid?" test read User.joiningFeePaid and
//    joiningFeeExpiresAt. Under rule 3b that is the wrong question: an
//    invited member who belongs to an active group is exempt from the
//    annual fee regardless of what those columns say. This now resolves
//    live entitlement instead.
//
// 2. RULE 3f PRESERVED. An exempt member MAY still choose to take a
//    Community Membership — that is what rule 3f describes, and the
//    fee is non-refundable once paid. So exemption does not hard-block
//    payment; it requires an explicit optIn: true. Without it the
//    request is refused with FEE_NOT_REQUIRED and an explanation.
//    The point is that nobody is charged by accident for something
//    they already have for free.
//
// 3. AUTHORISATION. userId came from the request body with no check, so
//    any authenticated caller could open invoices and Stripe Checkout
//    sessions against any other user's account, and read back their
//    email. Both GET ?userId and POST are now bound to the session,
//    with super roles able to act on someone's behalf.
//
// 4. The legacy User columns are no longer READ for any decision. The
//    Stripe webhook still writes them during transition; nothing gates
//    behaviour on them.

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma/client';
import { stripeProvider } from '@/lib/payments/stripe/adapter';
import { getSessionFromRequest, unauthorized, forbidden, SUPER_ROLES } from '@/lib/auth';
import { getCommunityMembership } from '@/lib/community-membership';
import { resolveEntitlement } from '@/lib/entitlement';

export const dynamic = 'force-dynamic';

const PROVIDERS = ['ECOCASH', 'MPESA', 'MTN_MOMO', 'BANK_TRANSFER', 'CARD', 'USSD'] as const;

const InitiateSchema = z.object({
  userId: z.string().uuid(),
  countryCode: z.string().length(2),
  provider: z.enum(PROVIDERS),
  phone: z.string().min(6).optional(), // required for mobile money
  // Rule 3f — an already-exempt member deliberately choosing to take a
  // Community Membership anyway. Without this the request is refused
  // with FEE_NOT_REQUIRED, so nobody is charged by accident.
  optIn: z.boolean().optional(),
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
      // Bound to the session — v1 let any caller read any user's
      // invoice history by id.
      const session = await getSessionFromRequest(req);
      if (!session) return unauthorized();
      if (userId !== session.id && !SUPER_ROLES.includes(session.role)) {
        return forbidden('Not authorised to view this account');
      }

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

      // Eligibility, so the page can say "you don't need to pay" rather
      // than presenting a payment form to somebody who is exempt.
      const [membership, entitlement] = await Promise.all([
        getCommunityMembership(userId),
        resolveEntitlement(userId),
      ]);

      const membershipCurrent =
        !!membership &&
        membership.status === 'ACTIVE' &&
        new Date(membership.expiresAt) > new Date();

      const exemptViaStaff = entitlement.reasons.includes('STAFF_ROLE');
      const exemptViaGroup = entitlement.qualifyingGroupIds.length > 0;

      return NextResponse.json({
        success: true,
        data: invoices[0] || null,
        eligibility: {
          feeRequired: !membershipCurrent && !exemptViaStaff && !exemptViaGroup,
          membershipCurrent,
          membershipExpiresAt: membership?.expiresAt ?? null,
          cancelAtPeriodEnd: membership?.cancelAtPeriodEnd ?? false,
          exemptViaGroup,
          exemptViaStaff,
          // Rule 3f — exempt, but may opt in and pay if they want the
          // group adverts. Requires optIn: true on the POST.
          mayOptIn: !membershipCurrent && exemptViaGroup && !exemptViaStaff,
        },
      });
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
    const { userId, countryCode, provider, phone, optIn } = parsed.data;

    // ── AUTHORISATION ─────────────────────────────────────────
    // userId came straight from the body with no check, so any
    // authenticated caller could open invoices and Stripe Checkout
    // sessions against someone else's account.
    const session = await getSessionFromRequest(req);
    if (!session) return unauthorized();
    if (userId !== session.id && !SUPER_ROLES.includes(session.role)) {
      return forbidden('Not authorised for this account');
    }

    const userRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "email" FROM "User" WHERE "id" = $1 AND "deletedAt" IS NULL`,
      userId
    );
    if (!userRows.length) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }
    const userEmail: string = userRows[0].email;

    // ── Do they need to pay at all? ───────────────────────────
    // Resolved live rather than read from User.joiningFeePaid, which is
    // a snapshot and says nothing about group membership.
    const [membership, entitlement] = await Promise.all([
      getCommunityMembership(userId),
      resolveEntitlement(userId),
    ]);

    const membershipCurrent =
      !!membership &&
      membership.status === 'ACTIVE' &&
      new Date(membership.expiresAt) > new Date();

    if (membershipCurrent) {
      // A pending cancellation is resumed, not re-bought — resuming
      // consumes time they already paid for.
      if (membership!.cancelAtPeriodEnd) {
        return NextResponse.json({
          success: false,
          code: 'CANCELLATION_PENDING',
          error: 'Your membership is active but set to end. Restart it from your membership page instead of paying again.',
        }, { status: 409 });
      }
      return NextResponse.json({
        success: false,
        code: 'ALREADY_CURRENT',
        error: 'Your Community Membership is already active.',
      }, { status: 409 });
    }

    // Staff never pay, and there is no opt-in path for them.
    if (entitlement.reasons.includes('STAFF_ROLE')) {
      return NextResponse.json({
        success: false,
        code: 'FEE_NOT_REQUIRED',
        error: 'Staff accounts are not charged a membership fee.',
      }, { status: 409 });
    }

    // ── RULE 3b ───────────────────────────────────────────────
    // A member of an active group is exempt. Not a hard block, because
    // rule 3f lets them opt in anyway for the group adverts — but it
    // takes an explicit optIn, so nobody is charged by accident for
    // something they already have.
    if (entitlement.qualifyingGroupIds.length > 0 && !optIn) {
      return NextResponse.json({
        success: false,
        code: 'FEE_NOT_REQUIRED',
        error:
          'You already have full access through your group membership, so no fee is due. ' +
          'You can still take a Community Membership if you want to see groups advertising ' +
          'for new members — it is charged annually and is not refundable.',
        data: { mayOptIn: true },
      }, { status: 409 });
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

    // ── Country back-fill (registration no longer asks for it) ─
    // The register form dropped the country field, so User.country is
    // null for anyone who signed up directly. This is where it becomes
    // known, and it MUST be written back — the Stripe webhook's renewal
    // path reads User.country and falls back to 'AU' when it is null,
    // which would silently re-bill a Zimbabwean member at Australian
    // pricing a year later.
    //
    // COALESCE, never overwrite: an existing country is the member's,
    // and a later payment made from elsewhere must not change it.
    await prisma.$executeRawUnsafe(
      `UPDATE "User"
       SET "country" = COALESCE("country", $2), "updatedAt" = now()
       WHERE "id" = $1`,
      userId, countryCode
    );

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

    // Base URL for Stripe redirects — origin header is correct across
    // localhost, preview and production without extra env vars.
    const origin = req.headers.get('origin') || req.nextUrl.origin;

    // Call provider API (adapter pattern — CARD is live via Stripe)
    const providerResult = await initiateWithProvider({
      provider,
      attemptId,
      invoiceId: invoice.id,
      userId,
      userEmail: userEmail,
      countryCode,
      amount: Number(invoice.amount),
      currency: invoice.currency,
      phone,
      reference: invoice.invoiceNo,
      origin,
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
        // CARD only — frontend redirects here to pay.
        checkoutUrl: providerResult.checkoutUrl || null,
      },
    });
  } catch (e: any) {
    console.error('POST /api/joining-fee error:', e?.message);
    return NextResponse.json({ success: false, error: 'Failed to initiate payment' }, { status: 500 });
  }
}

// ------------------------------------------------------------------
// Provider adapters
//   CARD          → live (Stripe Checkout, subscription mode)
//   mobile money  → stubs, replace bodies with real API calls
// ------------------------------------------------------------------
type ProviderInit = {
  provider: string; attemptId: string; invoiceId: string;
  userId: string; userEmail: string; countryCode: string;
  amount: number; currency: string; phone?: string;
  reference: string; origin: string;
};
type ProviderResult = {
  ok: boolean; providerRef?: string; error?: string;
  userMessage?: string; instructions?: string; checkoutUrl?: string;
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

    case 'CARD': {
      // Stripe Checkout in subscription mode — the annual joining fee
      // renews automatically. providerRef is the session id (cs_...),
      // which the webhook uses to find this attempt.
      try {
        const result = await stripeProvider.createSubscriptionCheckout({
          scope: 'MEMBER_ANNUAL',
          userId: p.userId,
          userEmail: p.userEmail,
          price: {
            currency: p.currency,
            amount: p.amount,
            countryCode: p.countryCode,
          },
          successUrl: `${p.origin}/dashboard/join-fee?paid=1`,
          cancelUrl: `${p.origin}/dashboard/join-fee?cancelled=1`,
          metadata: {
            attemptId: p.attemptId,
            invoiceId: p.invoiceId,
            invoiceNo: p.reference,
            countryCode: p.countryCode,
          },
        });
        return {
          ok: true,
          providerRef: result.checkoutId,
          checkoutUrl: result.checkoutUrl,
          userMessage: 'Redirecting to secure checkout.',
        };
      } catch (e: any) {
        console.error('Stripe checkout error:', e?.message);
        return { ok: false, error: 'Could not start card payment. Please try again.' };
      }
    }

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
