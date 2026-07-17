// ============================================================
// src/lib/payments/stripe/client.ts
// Stripe SDK singleton — same pattern as the Prisma client.
// Requires: npm install stripe
// Env: STRIPE_SECRET_KEY (all Vercel environments + local .env)
// ============================================================

import Stripe from 'stripe';

let stripeSingleton: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeSingleton) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY is not set');
    }
    stripeSingleton = new Stripe(key, {
      // apiVersion deliberately omitted — the SDK pins itself to the
      // API version it ships with, and hardcoding a string here breaks
      // the build every time the stripe package is updated.
      typescript: true,
    });
  }
  return stripeSingleton;
}
