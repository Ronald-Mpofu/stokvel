// ============================================================
// src/lib/payments/types.ts
// Provider-agnostic payment types. Nothing in the app should
// import Stripe types directly — only these.
// ============================================================

export type SubscriptionScope = 'MEMBER_ANNUAL' | 'GROUP_MONTHLY';

export type SubscriptionStatus =
  | 'incomplete'
  | 'active'
  | 'past_due'
  | 'paused'
  | 'canceled';

export interface ChargeSheet {
  id: string;
  countryCode: string;
  currency: string;
  memberAnnualFee: number;
  isActive: boolean;
}

export interface ChargeTier {
  id: string;
  sheetId: string;
  minMembers: number;
  maxMembers: number | null; // null = open-ended (e.g. 21++)
  monthlyFee: number;
}

export interface ResolvedPrice {
  currency: string;       // ISO code as stored on the sheet (TEXT, not enum)
  amount: number;          // decimal units, e.g. 12.5
  countryCode: string;     // sheet that resolved ('DEFAULT' if fallback)
  tierMin?: number;        // GROUP_MONTHLY only
  tierMax?: number | null; // GROUP_MONTHLY only
}

export interface CreateCheckoutParams {
  scope: SubscriptionScope;
  userId: string;
  userEmail: string;
  groupId?: string;        // required when scope = GROUP_MONTHLY
  price: ResolvedPrice;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  checkoutUrl: string;
  checkoutId: string;      // provider session id (Stripe: cs_...)
  customerId: string;      // provider customer id (Stripe: cus_...)
}

export interface PaymentProvider {
  name: 'STRIPE'; // union grows when Paystack/Flutterwave adapters land
  createSubscriptionCheckout(params: CreateCheckoutParams): Promise<CheckoutResult>;
  updateSubscriptionPrice(
    subscriptionId: string,
    price: ResolvedPrice,
    scope: SubscriptionScope
  ): Promise<void>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  pauseSubscription(subscriptionId: string): Promise<void>;
  resumeSubscription(subscriptionId: string): Promise<void>;
}
