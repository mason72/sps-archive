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

/**
 * Build the price-id → plan map from env. Empty / missing env entries are
 * skipped (we can't accept an empty string as a key — it would let the
 * default `priceId = ""` match every plan).
 */
function buildPriceIdMap(): Record<string, { plan: PlanId; interval: "monthly" | "annual" }> {
  const entries: Array<[string | undefined, PlanId, "monthly" | "annual"]> = [
    [process.env.STRIPE_PRICE_SOLO_MONTHLY, "solo", "monthly"],
    [process.env.STRIPE_PRICE_SOLO_ANNUAL, "solo", "annual"],
    [process.env.STRIPE_PRICE_PRO_MONTHLY, "pro", "monthly"],
    [process.env.STRIPE_PRICE_PRO_ANNUAL, "pro", "annual"],
    [process.env.STRIPE_PRICE_STUDIO_MONTHLY, "studio", "monthly"],
    [process.env.STRIPE_PRICE_STUDIO_ANNUAL, "studio", "annual"],
  ];
  const map: Record<string, { plan: PlanId; interval: "monthly" | "annual" }> = {};
  for (const [id, plan, interval] of entries) {
    if (id && id.trim()) {
      map[id] = { plan, interval };
    }
  }
  return map;
}

/** Map a Stripe price ID to its plan tier + interval, or null if unknown. */
export function planFromPriceId(priceId: string): {
  plan: PlanId;
  interval: "monthly" | "annual";
} | null {
  return buildPriceIdMap()[priceId] || null;
}

/**
 * Returns the full allow-list of price IDs we recognize. Used at checkout
 * to reject arbitrary client-supplied prices (avoids "subscribe to a $0
 * test price" abuse / silent upgrade to Pro via unknown priceIds).
 */
export function isAllowedPriceId(priceId: string): boolean {
  return priceId in buildPriceIdMap();
}
