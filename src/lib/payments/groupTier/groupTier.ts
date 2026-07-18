// ============================================================
// src/lib/payments/groupTier.ts
// Re-syncs a group's Stripe subscription price when its capacity
// (maxMembers) moves it into a different charge tier.
//
// Called from the groups PUT handler after a maxMembers change.
// Billing is by CONFIGURED CAPACITY, so this is the only place a
// live subscription's tier can legitimately move.
//
// Never throws to the caller — a tier-sync failure must not fail
// the group save. Failures are logged and the next capacity edit
// (or a manual re-save) retries naturally.
// ============================================================

import { prisma } from '@/lib/prisma/client';
import { resolveGroupMonthlyPrice } from './chargeSheet';
import { stripeProvider } from './stripe/adapter';

export async function syncGroupSubscriptionTier(groupId: string): Promise<void> {
  try {
    const subs: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "stripeSubscriptionId", "amount", "currency",
              "currentTierMin", "currentTierMax"
       FROM "PlatformSubscription"
       WHERE "groupId" = $1
         AND "scope" = 'GROUP_MONTHLY'
         AND "status" IN ('active', 'past_due')
         AND "stripeSubscriptionId" IS NOT NULL
       LIMIT 1`,
      groupId
    );
    if (!subs.length) return; // not subscribed — nothing to sync
    const sub = subs[0];

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: { country: true, maxMembers: true },
    });
    if (!group?.country) return;

    const price = await resolveGroupMonthlyPrice(group.country, group.maxMembers ?? 1);

    const unchanged =
      Number(sub.amount) === price.amount &&
      sub.currency === price.currency &&
      (sub.currentTierMin ?? null) === (price.tierMin ?? null);
    if (unchanged) return;

    // proration_behavior 'none' inside the adapter: the new rate simply
    // applies from the next invoice — no surprise mid-cycle charges.
    await stripeProvider.updateSubscriptionPrice(
      sub.stripeSubscriptionId,
      price,
      'GROUP_MONTHLY'
    );

    await prisma.$executeRawUnsafe(
      `UPDATE "PlatformSubscription"
       SET "amount" = $2, "currency" = $3,
           "currentTierMin" = $4, "currentTierMax" = $5,
           "updatedAt" = now()
       WHERE "id" = $1`,
      sub.id, price.amount, price.currency,
      price.tierMin ?? null, price.tierMax ?? null
    );
  } catch (e: any) {
    console.error('syncGroupSubscriptionTier error:', e?.message);
  }
}
