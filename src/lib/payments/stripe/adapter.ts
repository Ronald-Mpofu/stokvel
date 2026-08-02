// ============================================================
// src/lib/payments/stripe/adapter.ts
// Stripe implementation of PaymentProvider.
// Uses inline price_data (dynamic per-country pricing) — no
// Stripe Price catalog to maintain.
// ============================================================

import type Stripe from 'stripe';
import { getStripe } from './client';
import type {
  CheckoutResult,
  CreateCheckoutParams,
  PaymentProvider,
  ResolvedPrice,
  SubscriptionScope,
} from '../types';

// Stripe zero-decimal currencies relevant to our markets.
// UGX is zero-decimal in Stripe even though ISO says 2 decimals.
const ZERO_DECIMAL = new Set(['UGX', 'JPY', 'KRW', 'VND', 'XAF', 'XOF', 'RWF']);

/** Convert a decimal amount to Stripe minor units. */
export function toMinorUnits(amount: number, currency: string): number {
  const upper = currency.toUpperCase();
  if (ZERO_DECIMAL.has(upper)) {
    return Math.round(amount);
  }
  return Math.round(amount * 100);
}

function productName(scope: SubscriptionScope): string {
  return scope === 'MEMBER_ANNUAL'
    ? 'Windfall Member Joining Fee (Annual)'
    : 'Windfall Group Subscription (Monthly)';
}

function interval(scope: SubscriptionScope): 'year' | 'month' {
  return scope === 'MEMBER_ANNUAL' ? 'year' : 'month';
}

function priceData(
  price: ResolvedPrice,
  scope: SubscriptionScope
): Stripe.Checkout.SessionCreateParams.LineItem.PriceData {
  return {
    currency: price.currency.toLowerCase(),
    unit_amount: toMinorUnits(price.amount, price.currency),
    recurring: { interval: interval(scope) },
    product_data: { name: productName(scope) },
  };
}

async function findOrCreateCustomer(
  userId: string,
  email: string,
  currency: string
): Promise<string> {
  const stripe = getStripe();
  const cur = currency.toLowerCase();

  // Stripe locks a Customer to the currency of its first active
  // subscription and rejects any subscription in a different currency
  // ("cannot combine currencies on a single customer"). Our platform
  // routinely mixes currencies on one person — a member joining fee in
  // USD and a group subscription in AUD, say — so we key the Customer
  // by (userId, currency) and keep one Stripe Customer per currency.
  const existing = await stripe.customers.search({
    query: `metadata["windfallUserId"]:"${userId}" AND metadata["windfallCurrency"]:"${cur}"`,
    limit: 1,
  });
  if (existing.data.length > 0) {
    return existing.data[0].id;
  }
  const created = await stripe.customers.create({
    email,
    metadata: { windfallUserId: userId, windfallCurrency: cur },
  });
  return created.id;
}

export const stripeProvider: PaymentProvider = {
  name: 'STRIPE',

  async createSubscriptionCheckout(
    params: CreateCheckoutParams
  ): Promise<CheckoutResult> {
    const stripe = getStripe();
    const customerId = await findOrCreateCustomer(params.userId, params.userEmail, params.price.currency);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price_data: priceData(params.price, params.scope), quantity: 1 }],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      // Metadata flows through to webhook events — this is how the
      // webhook maps Stripe objects back to our records.
      subscription_data: {
        metadata: {
          ...(params.metadata ?? {}),
          scope: params.scope,
          userId: params.userId,
          groupId: params.groupId ?? '',
        },
      },
      metadata: {
        ...(params.metadata ?? {}),
        scope: params.scope,
        userId: params.userId,
        groupId: params.groupId ?? '',
      },
    });

    if (!session.url) {
      throw new Error('Stripe checkout session created without a URL');
    }

    return {
      checkoutUrl: session.url,
      checkoutId: session.id,
      customerId,
    };
  },

  async updateSubscriptionPrice(
    subscriptionId: string,
    price: ResolvedPrice,
    scope: SubscriptionScope
  ): Promise<void> {
    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    const itemId = sub.items.data[0]?.id;
    if (!itemId) {
      throw new Error(`Subscription ${subscriptionId} has no items to update`);
    }
    await stripe.subscriptions.update(subscriptionId, {
      items: [
        {
          id: itemId,
          price_data: {
            currency: price.currency.toLowerCase(),
            unit_amount: toMinorUnits(price.amount, price.currency),
            recurring: { interval: interval(scope) },
            product: sub.items.data[0].price.product as string,
          },
        },
      ],
      // New tier applies from next invoice — no surprise mid-cycle charges
      proration_behavior: 'none',
    });
  },

  async cancelSubscription(subscriptionId: string): Promise<void> {
    await getStripe().subscriptions.cancel(subscriptionId);
  },
  async pauseSubscription(subscriptionId: string): Promise<void> {
    await getStripe().subscriptions.update(subscriptionId, {
      pause_collection: { behavior: 'void' },
    });
  },

  async resumeSubscription(subscriptionId: string): Promise<void> {
    await getStripe().subscriptions.update(subscriptionId, {
      pause_collection: null,
    });
  },
};

// ============================================================
// Cancel at period end
//
// Exported as standalone functions rather than added to the
// PaymentProvider interface, so ../types.ts needs no change and no
// other implementation of that interface is forced to grow methods.
//
// WHY THESE EXIST
// stripeProvider.cancelSubscription() terminates IMMEDIATELY. For a
// member who opts out of Community Membership that is the wrong
// behaviour: they have paid for a full year, and ending it on the spot
// forfeits whatever remains. Under the non-refundable clause that reads
// as keeping their money.
//
// Cancelling at period end means the member keeps access and advert
// visibility through the period they paid for, is never charged again,
// and nothing is forfeited. It is also reversible right up to the
// period end, which the immediate cancel is not.
//
// Immediate cancellation is still the right tool elsewhere — fraud,
// chargebacks, admin termination — so cancelSubscription stays.
// ============================================================

/**
 * Schedule cancellation at the end of the current period.
 *
 * Stripe keeps status 'active' and sets canceled_at to now. Anything
 * reading subscription state must therefore judge currency by status
 * plus current_period_end, NOT by canceled_at being null.
 *
 * Pair with confirmOptOut() in src/lib/community-membership: call this
 * FIRST, and record the opt-out only once Stripe has agreed.
 */
export async function scheduleSubscriptionCancellation(
  subscriptionId: string
): Promise<void> {
  await getStripe().subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  });
}

/**
 * Undo a scheduled cancellation. Only valid before the period ends —
 * once Stripe has actually cancelled, a new checkout is required.
 *
 * Pair with revokeCancellation() in src/lib/community-membership.
 */
export async function revokeSubscriptionCancellation(
  subscriptionId: string
): Promise<void> {
  await getStripe().subscriptions.update(subscriptionId, {
    cancel_at_period_end: false,
  });
}
