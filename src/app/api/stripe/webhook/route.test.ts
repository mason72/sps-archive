import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Hermetic webhook test. The point of interest is what the handler WRITES to
 * `subscriptions.plan` — the only entitlement column — when Stripe hands it a
 * price it cannot map. The old code fell back to "pro", so a misconfigured
 * env or a stray price granted the second-most-expensive tier silently.
 *
 * Every negative assertion is paired with a known-price control: a harness
 * that never writes a plan would pass the negative tests for the wrong reason.
 */

const state = {
  event: null as unknown,
  subscription: null as unknown,
  /** Every update() payload sent to the subscriptions table, in order. */
  updates: [] as Record<string, unknown>[],
  /** Make the next update() reject, to exercise the catch path. */
  updateThrows: null as Error | null,
};

vi.mock("@/lib/stripe/config", async () => {
  const actual = await vi.importActual<typeof import("@/lib/stripe/config")>(
    "@/lib/stripe/config"
  );
  return {
    ...actual,
    getStripe: () => ({
      webhooks: { constructEvent: () => state.event },
      subscriptions: { retrieve: async () => state.subscription },
    }),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        state.updates.push(payload);
        return {
          eq: async () => {
            if (state.updateThrows) throw state.updateThrows;
            return { data: null, error: null };
          },
        };
      },
      select: () => ({
        eq: () => ({ single: async () => ({ data: null, error: null }) }),
      }),
    }),
  }),
}));

const reportSystemError = vi.fn(
  async (_context: string, _error: unknown, _detail?: Record<string, unknown>) => {}
);
vi.mock("@/lib/monitoring/report", () => ({
  reportSystemError: (context: string, error: unknown, detail?: Record<string, unknown>) =>
    reportSystemError(context, error, detail),
}));

import { POST } from "./route";

const KNOWN_PRICE = "price_studio_monthly_test";
const UNKNOWN_PRICE = "price_from_some_other_product";

function subscriptionWith(priceId: string) {
  return {
    id: "sub_1",
    status: "active",
    cancel_at_period_end: false,
    metadata: { supabase_user_id: "user-1" },
    items: {
      data: [
        {
          price: { id: priceId },
          current_period_start: 1_700_000_000,
          current_period_end: 1_702_592_000,
        },
      ],
    },
  };
}

function checkoutEvent(priceId: string) {
  state.subscription = subscriptionWith(priceId);
  state.event = {
    id: "evt_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_1",
        customer: "cus_1",
        subscription: "sub_1",
        metadata: { supabase_user_id: "user-1" },
      },
    },
  };
}

function subscriptionUpdatedEvent(priceId: string) {
  state.event = {
    id: "evt_2",
    type: "customer.subscription.updated",
    data: { object: subscriptionWith(priceId) },
  };
}

const call = () =>
  POST(
    new NextRequest("https://app.test/api/stripe/webhook", {
      method: "POST",
      body: "{}",
      headers: { "stripe-signature": "sig" },
    })
  );

const planWrites = () => state.updates.filter((u) => "plan" in u);

describe("POST /api/stripe/webhook — plan comes from the price map or not at all", () => {
  beforeEach(() => {
    state.event = null;
    state.subscription = null;
    state.updates = [];
    state.updateThrows = null;
    reportSystemError.mockClear();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    process.env.STRIPE_PRICE_STUDIO_MONTHLY = KNOWN_PRICE;
  });

  it("control: a mapped price activates that plan", async () => {
    checkoutEvent(KNOWN_PRICE);
    const res = await call();
    expect(res.status).toBe(200);
    expect(planWrites()).toHaveLength(1);
    expect(planWrites()[0]).toMatchObject({
      plan: "studio",
      billing_interval: "monthly",
      status: "active",
      stripe_subscription_id: "sub_1",
    });
    expect(reportSystemError).not.toHaveBeenCalled();
  });

  it("checkout with an unmapped price grants NOTHING, alerts, and is not retried", async () => {
    checkoutEvent(UNKNOWN_PRICE);
    const res = await call();
    const body = await res.json();

    expect(planWrites()).toHaveLength(0);
    // Linkage ids may be recorded for reconciliation, but never entitlement.
    for (const u of state.updates) {
      expect(u).not.toHaveProperty("plan");
      expect(u).not.toHaveProperty("status");
      expect(u).not.toHaveProperty("billing_interval");
    }
    expect(reportSystemError).toHaveBeenCalledTimes(1);
    expect(reportSystemError.mock.calls[0][0]).toBe("stripe.webhook.unknown-price");
    expect(JSON.stringify(reportSystemError.mock.calls[0][2])).toContain(UNKNOWN_PRICE);
    // 200: a permanently-bad event must not be retried by Stripe for 3 days.
    expect(res.status).toBe(200);
    expect(body.ignored).toBe("unknown_price");
  });

  it("subscription.updated with an unmapped price writes no plan either", async () => {
    subscriptionUpdatedEvent(UNKNOWN_PRICE);
    const res = await call();
    expect(res.status).toBe(200);
    expect(planWrites()).toHaveLength(0);
    expect(reportSystemError).toHaveBeenCalledTimes(1);
  });

  it("control: subscription.updated with a mapped price syncs the plan", async () => {
    subscriptionUpdatedEvent(KNOWN_PRICE);
    await call();
    expect(planWrites()).toHaveLength(1);
    expect(planWrites()[0]).toMatchObject({ plan: "studio", status: "active" });
  });

  it("a deploy with NO price map at all is an outage: 500 so Stripe retries, plus alert", async () => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("STRIPE_PRICE_")) delete process.env[k];
    }
    checkoutEvent(KNOWN_PRICE);
    const res = await call();
    expect(res.status).toBe(500);
    expect(planWrites()).toHaveLength(0);
    expect(reportSystemError).toHaveBeenCalledTimes(1);
    expect(reportSystemError.mock.calls[0][0]).toBe("stripe.webhook.price-map-missing");
  });

  it("a handler failure is a 500 (Stripe retries) and alerts — never a swallowed 200", async () => {
    checkoutEvent(KNOWN_PRICE);
    state.updateThrows = new Error("db down");
    const res = await call();
    expect(res.status).toBe(500);
    expect(reportSystemError).toHaveBeenCalledTimes(1);
    expect(reportSystemError.mock.calls[0][0]).toBe("stripe.webhook");
  });
});
