// ============================================================
// src/lib/payments/registry.ts
// Resolves which payment provider handles a charge.
// Today: always Stripe. When Paystack/Flutterwave adapters land,
// routing logic (by country / payment method) lives here and
// nothing downstream changes.
// ============================================================

import { stripeProvider } from './stripe/adapter';
import type { PaymentProvider } from './types';

export function getProvider(_countryCode?: string): PaymentProvider {
  // Future: route ZA/KE/NG/GH to Paystack, mobile-money to Flutterwave.
  return stripeProvider;
}
