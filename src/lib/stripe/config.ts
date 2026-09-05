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
  /** Monthly list price in USD (null = custom). Must match the marketing
   *  pricing page (src/app/m/pricing/page.tsx) — used by the ops pricing
   *  summary to map measured usage onto a tier and compute margin. */
  monthlyPriceUsd: number | null;
  features: {
    proofing: boolean;
    batchOps: boolean;
    analytics: boolean;
  };
}

export const PLANS: Record<PlanId, PlanConfig> = {
  free: {
    name: "Free",
    monthlyPriceUsd: 0,
    storageLimitGB: 10,
    eventLimit: 1,
    seatLimit: 1,
    features: { proofing: false, batchOps: false, analytics: false },
  },
  solo: {
    name: "Solo",
    monthlyPriceUsd: 25,
    storageLimitGB: 100,
    eventLimit: null,
    seatLimit: 1,
    features: { proofing: false, batchOps: false, analytics: false },
  },
  pro: {
    name: "Pro",
    monthlyPriceUsd: 59,
    storageLimitGB: 750,
    eventLimit: null,
    seatLimit: 3,
    features: { proofing: true, batchOps: false, analytics: false },
  },
  studio: {
    name: "Studio",
    monthlyPriceUsd: 99,
    storageLimitGB: 2048,
    eventLimit: null,
    seatLimit: 10,
    features: { proofing: true, batchOps: true, analytics: true },
  },
  enterprise: {
    name: "Enterprise",
    monthlyPriceUsd: null,
    storageLimitGB: Infinity,
    eventLimit: null,
    seatLimit: Infinity,
    features: { proofing: true, batchOps: true, analytics: true },
  },
};

export interface PricePlan {
  plan: PlanId;
  interval: "monthly" | "annual";
}

/** The env var that carries each sellable price. Free/enterprise have none. */
const PRICE_ENV: ReadonlyArray<[envVar: string, plan: PricePlan]> = [
  ["STRIPE_PRICE_SOLO_MONTHLY", { plan: "solo", interval: "monthly" }],
  ["STRIPE_PRICE_SOLO_ANNUAL", { plan: "solo", interval: "annual" }],
  ["STRIPE_PRICE_PRO_MONTHLY", { plan: "pro", interval: "monthly" }],
  ["STRIPE_PRICE_PRO_ANNUAL", { plan: "pro", interval: "annual" }],
  ["STRIPE_PRICE_STUDIO_MONTHLY", { plan: "studio", interval: "monthly" }],
  ["STRIPE_PRICE_STUDIO_ANNUAL", { plan: "studio", interval: "annual" }],
];

/**
 * Price ID → plan, built from the env on every call (the webhook must see a
 * rotated price without a restart, and tests set the env per case). Only
 * CONFIGURED prices are keys: an unset env var used to become the key "",
 * and a Map rather than a plain object keeps "constructor"/"__proto__" from
 * resolving to something truthy.
 */
function priceMap(): Map<string, PricePlan> {
  const map = new Map<string, PricePlan>();
  for (const [envVar, plan] of PRICE_ENV) {
    const id = process.env[envVar];
    if (id) map.set(id, plan);
  }
  return map;
}

/**
 * True when at least one sellable price is configured. A deployment with NONE
 * is misconfigured (env not set), which is a different failure from a single
 * price the map does not know — the webhook treats the first as an outage
 * worth a retry and the second as a permanently-bad event.
 */
export function priceMapConfigured(): boolean {
  return priceMap().size > 0;
}

/**
 * Map a Stripe price ID to plan+interval. Returns null for anything the map
 * does not know — and null means "grant nothing", never "assume pro". The
 * webhook fell back to "pro" for an unknown price until 2026-09-05.
 */
export function planFromPriceId(priceId: string): PricePlan | null {
  return priceMap().get(priceId) ?? null;
}
