// src/app/api/payments/group-checkout/route.ts
// POST { groupId } → Stripe Checkout for the GROUP MONTHLY subscription.
//
// Business rule: a group subscription is charged when the group is
// ACTIVATED — a DRAFT group is never billed. The tier is resolved from
// the group's country + its configured capacity (maxMembers): billing
// by capacity is self-consistent because maxMembers caps membership,
// so an admin cannot sit in tier 1 while running a tier 3 group.
//
// Flow: Activate Group button → this route → Stripe Checkout →
// webhook (checkout.session.completed, scope GROUP_MONTHLY) flips the
// Group to ACTIVE. The group does NOT activate until payment lands.

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma/client';
import { getSessionFromRequest, requireGroupManager } from '@/lib/auth';
import { resolveGroupMonthlyPrice } from '@/lib/payments/chargeSheet';
import { stripeProvider } from '@/lib/payments/stripe/adapter';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  groupId: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorised. Please log in.' }, { status: 401 });
    }

    const body = await req.json();
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message || 'Invalid request' },
        { status: 400 }
      );
    }
    const { groupId } = parsed.data;

    const guardErr = await requireGroupManager(req, groupId);
    if (guardErr) return guardErr;

    // Group IS in schema.prisma — safe for Prisma select on known columns.
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true, name: true, status: true, country: true, maxMembers: true },
    });
    if (!group) {
      return NextResponse.json({ success: false, error: 'Group not found' }, { status: 404 });
    }
    if (group.status === 'ACTIVE') {
      return NextResponse.json({ success: false, error: 'This group is already active' }, { status: 409 });
    }
    if (group.status === 'COMPLETED' || group.status === 'DISSOLVED') {
      return NextResponse.json(
        { success: false, error: `A ${group.status.toLowerCase()} group cannot be activated` },
        { status: 409 }
      );
    }
    if (!group.country) {
      return NextResponse.json(
        { success: false, error: 'Set the group country first — the subscription price depends on it' },
        { status: 400 }
      );
    }

    // One live subscription per group. A previous 'incomplete' row
    // (abandoned checkout) is reused rather than duplicated — the
    // partial unique index would reject a second live row anyway.
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "status" FROM "PlatformSubscription"
       WHERE "groupId" = $1
         AND "scope" = 'GROUP_MONTHLY'
         AND "status" IN ('active', 'past_due', 'paused')
       LIMIT 1`,
      groupId
    );
    if (existing.length) {
      return NextResponse.json(
        { success: false, error: 'This group already has a live subscription' },
        { status: 409 }
      );
    }

    // Tier from configured capacity (see header note).
    const memberCount = group.maxMembers ?? 1;
    const price = await resolveGroupMonthlyPrice(group.country, memberCount);

    const origin = req.headers.get('origin') || req.nextUrl.origin;

    const checkout = await stripeProvider.createSubscriptionCheckout({
      scope: 'GROUP_MONTHLY',
      userId: session.id,
      userEmail: session.email,
      groupId,
      price,
      successUrl: `${origin}/dashboard/groups?activated=1&groupId=${groupId}`,
      cancelUrl: `${origin}/dashboard/groups?activation_cancelled=1&groupId=${groupId}`,
      metadata: {
        groupName: group.name,
        tierMin: String(price.tierMin ?? ''),
        tierMax: price.tierMax === null || price.tierMax === undefined ? '' : String(price.tierMax),
        countryCode: price.countryCode,
      },
    });

    // Record the pending subscription. Reuse an abandoned 'incomplete'
    // row for this group if one exists; otherwise insert.
    const pending: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "PlatformSubscription"
       WHERE "groupId" = $1 AND "scope" = 'GROUP_MONTHLY' AND "status" = 'incomplete'
       LIMIT 1`,
      groupId
    );

    if (pending.length) {
      await prisma.$executeRawUnsafe(
        `UPDATE "PlatformSubscription"
         SET "stripeCheckoutId" = $2, "stripeCustomerId" = $3, "userId" = $4,
             "currency" = $5, "amount" = $6,
             "currentTierMin" = $7, "currentTierMax" = $8, "updatedAt" = now()
         WHERE "id" = $1`,
        pending[0].id, checkout.checkoutId, checkout.customerId, session.id,
        price.currency, price.amount, price.tierMin ?? null, price.tierMax ?? null
      );
    } else {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "PlatformSubscription"
           ("id","scope","userId","groupId","stripeCustomerId","stripeCheckoutId",
            "status","currency","amount","currentTierMin","currentTierMax")
         VALUES ($1,'GROUP_MONTHLY',$2,$3,$4,$5,'incomplete',$6,$7,$8,$9)`,
        randomUUID(), session.id, groupId, checkout.customerId, checkout.checkoutId,
        price.currency, price.amount, price.tierMin ?? null, price.tierMax ?? null
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Redirecting to secure checkout.',
      data: {
        checkoutUrl: checkout.checkoutUrl,
        amount: price.amount,
        currency: price.currency,
        tierMin: price.tierMin ?? null,
        tierMax: price.tierMax ?? null,
        pricedFor: memberCount,
      },
    });
  } catch (e: any) {
    console.error('POST /api/payments/group-checkout error:', e?.message);
    return NextResponse.json({ success: false, error: 'Could not start group subscription' }, { status: 500 });
  }
}
