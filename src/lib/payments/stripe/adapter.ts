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
  email: string
): Promise<string> {
  const stripe = getStripe();
  // Search by our userId in metadata first — avoids duplicate customers
  const existing = await stripe.customers.search({
    query: `metadata["windfallUserId"]:"${userId}"`,
    limit: 1,
  });
  if (existing.data.length > 0) {
    return existing.data[0].id;
  }
  const created = await stripe.customers.create({
    email,
    metadata: { windfallUserId: userId },
  });
  return created.id;
}

export const stripeProvider: PaymentProvider = {
  name: 'STRIPE',

  async createSubscriptionCheckout(
    params: CreateCheckoutParams
  ): Promise<CheckoutResult> {
    const stripe = getStripe();
    const customerId = await findOrCreateCustomer(params.userId, params.userEmail);

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
