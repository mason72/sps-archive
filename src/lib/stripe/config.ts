import Stripe from "stripe";

/**
 * Server-side Stripe client (lazy-initialized).
 * Only import this in API routes / server components.
 * Lazy init prevents build-time errors when STRIPE_SECRET_KEY isn't set.
 */
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-02-25.clover",
      typescript: true,
    });
  }
  return _stripe;
}

/** Plan definitions matching docs/PRICING.md */
export type PlanId = "free" | "solo" | "pro" | "studio" | "enterprise";

export interface PlanConfig {
  name: string;
  storageLimitGB: number;
  eventLimit: number | null; // null = unlimited
  seatLimit: number;
  features: {
    proofing: boolean;
    batchOps: boolean;
    analytics: boolean;
  };
}

export const PLANS: Record<PlanId, PlanConfig> = {
  free: {
    name: "Free",
    storageLimitGB: 10,
    eventLimit: 1,
    seatLimit: 1,
    features: { proofing: false, batchOps: false, analytics: false },
  },
  solo: {
    name: "Solo",
    storageLimitGB: 100,
    eventLimit: null,
    seatLimit: 1,
    features: { proofing: false, batchOps: false, analytics: false },
  },
  pro: {
    name: "Pro",
    storageLimitGB: 750,
    eventLimit: null,
    seatLimit: 3,
    features: { proofing: true, batchOps: false, analytics: false },
  },
  studio: {
    name: "Studio",
    storageLimitGB: 2048,
    eventLimit: null,
    seatLimit: 10,
    features: { proofing: true, batchOps: true, analytics: true },
  },
  enterprise: {
    name: "Enterprise",
    storageLimitGB: Infinity,
    eventLimit: null,
    seatLimit: Infinity,
    features: { proofing: true, batchOps: true, analytics: true },
  },
};

/** Map Stripe price IDs to plan+interval for webhook processing */
export function planFromPriceId(priceId: string): {
  plan: PlanId;
  interval: "monthly" | "annual";
} | null {
  const map: Record<string, { plan: PlanId; interval: "monthly" | "annual" }> =
    {
      [process.env.STRIPE_PRICE_SOLO_MONTHLY || ""]: {
        plan: "solo",
        interval: "monthly",
      },
      [process.env.STRIPE_PRICE_SOLO_ANNUAL || ""]: {
        plan: "solo",
        interval: "annual",
      },
      [process.env.STRIPE_PRICE_PRO_MONTHLY || ""]: {
        plan: "pro",
        interval: "monthly",
      },
      [process.env.STRIPE_PRICE_PRO_ANNUAL || ""]: {
        plan: "pro",
        interval: "annual",
      },
      [process.env.STRIPE_PRICE_STUDIO_MONTHLY || ""]: {
        plan: "studio",
        interval: "monthly",
      },
      [process.env.STRIPE_PRICE_STUDIO_ANNUAL || ""]: {
        plan: "studio",
        interval: "annual",
      },
    };
  return map[priceId] || null;
}
