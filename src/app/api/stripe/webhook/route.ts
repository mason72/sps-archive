import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import {
  getStripe,
  planFromPriceId,
  priceMapConfigured,
  type PricePlan,
} from "@/lib/stripe/config";
import { createServiceClient } from "@/lib/supabase/server";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * Helper to get period dates from a Stripe subscription.
 * In API v2026+, period lives on items rather than the subscription root.
 */
function getSubscriptionPeriod(sub: Stripe.Subscription) {
  const item = sub.items.data[0];
  return {
    start: item?.current_period_start
      ? new Date(item.current_period_start * 1000).toISOString()
      : null,
    end: item?.current_period_end
      ? new Date(item.current_period_end * 1000).toISOString()
      : null,
  };
}

function subscriptionsTable(supabase: ReturnType<typeof createServiceClient>) {
  return supabase.from("subscriptions");
}

/**
 * Resolve the plan a Stripe subscription entitles the user to — from the
 * price map or NOT AT ALL. Until 2026-09-05 an unmapped price fell back to
 * "pro", so a stray price (or a deploy missing its STRIPE_PRICE_* env)
 * silently granted the second-most-expensive tier.
 *
 * Two distinct failures, two distinct answers:
 *  - No price configured at all → the deployment is broken, not the event.
 *    500 so Stripe retries (it will succeed once the env is fixed) and the
 *    dashboard shows the endpoint failing. Alert.
 *  - This price is not in the map → permanently bad; retrying cannot fix it.
 *    200 with an `ignored` reason so Stripe stops, alert the admin, and write
 *    nothing to the entitlement columns. The user stays on their current plan
 *    (visible: they paid and see no upgrade), which is the failure direction
 *    we want — a paying customer complains, a phantom grant never does.
 */
function resolvePlan(
  event: Stripe.Event,
  subscription: Stripe.Subscription,
  userId: string
): { ok: true; plan: PricePlan } | { ok: false; response: NextResponse } {
  const priceId = subscription.items.data[0]?.price.id ?? null;
  const detail = {
    eventId: event.id,
    eventType: event.type,
    subscriptionId: subscription.id,
    priceId,
    userId,
  };

  if (!priceMapConfigured()) {
    console.error("Stripe webhook: no STRIPE_PRICE_* env configured", detail);
    void reportSystemError(
      "stripe.webhook.price-map-missing",
      new Error("No STRIPE_PRICE_* env is set; cannot map any price to a plan"),
      detail
    );
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Price map not configured" },
        { status: 500 }
      ),
    };
  }

  const plan = priceId ? planFromPriceId(priceId) : null;
  if (!plan) {
    console.error("Stripe webhook: price not in plan map, granting nothing", detail);
    void reportSystemError(
      "stripe.webhook.unknown-price",
      new Error(`Price ${priceId ?? "(none)"} is not in the plan map; no plan granted`),
      detail
    );
    return {
      ok: false,
      response: NextResponse.json({ received: true, ignored: "unknown_price" }),
    };
  }

  return { ok: true, plan };
}

/**
 * POST /api/stripe/webhook
 *
 * Handles Stripe webhook events to sync subscription state to Supabase.
 * Events handled:
 *   - checkout.session.completed → activate subscription
 *   - customer.subscription.updated → sync plan/status/period
 *   - customer.subscription.deleted → cancel subscription
 *   - invoice.payment_failed → mark as past_due
 *
 * Response codes are how we talk to Stripe's retry queue: 200 means "done or
 * permanently unprocessable, do not retry"; 500 means "try again later" (the
 * signature was valid, our side failed). A handler error used to return 200,
 * which dropped the event — and a dropped checkout.session.completed is a
 * customer who paid and got nothing.
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 }
    );
  }

  let event: Stripe.Event;

  try {
    event = getStripe().webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.supabase_user_id;
        if (!userId || !session.subscription) break;

        // Fetch the subscription to get plan details
        const subscription = await getStripe().subscriptions.retrieve(
          session.subscription as string
        );
        const period = getSubscriptionPeriod(subscription);

        const resolved = resolvePlan(event, subscription, userId);
        if (!resolved.ok) {
          // Record the linkage so a human can reconcile which subscription
          // this user bought. These ids entitle nothing.
          await subscriptionsTable(supabase)
            .update({
              stripe_subscription_id: subscription.id,
              stripe_customer_id: session.customer as string,
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", userId);
          return resolved.response;
        }

        await subscriptionsTable(supabase)
          .update({
            stripe_subscription_id: subscription.id,
            stripe_customer_id: session.customer as string,
            plan: resolved.plan.plan,
            status: "active",
            billing_interval: resolved.plan.interval,
            current_period_start: period.start,
            current_period_end: period.end,
            trial_end: null,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", userId);

        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata?.supabase_user_id;
        if (!userId) break;

        const period = getSubscriptionPeriod(subscription);

        const resolved = resolvePlan(event, subscription, userId);
        if (!resolved.ok) return resolved.response;

        const statusMap: Record<string, string> = {
          active: "active",
          trialing: "trialing",
          past_due: "past_due",
          canceled: "canceled",
          unpaid: "past_due",
          incomplete: "past_due",
          incomplete_expired: "canceled",
          paused: "canceled",
        };

        await subscriptionsTable(supabase)
          .update({
            plan: resolved.plan.plan,
            status: statusMap[subscription.status] || "active",
            billing_interval: resolved.plan.interval,
            current_period_start: period.start,
            current_period_end: period.end,
            cancel_at_period_end: subscription.cancel_at_period_end,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", userId);

        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata?.supabase_user_id;
        if (!userId) break;

        await subscriptionsTable(supabase)
          .update({
            plan: "free",
            status: "canceled",
            stripe_subscription_id: null,
            cancel_at_period_end: false,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", userId);

        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        // Find user by customer ID
        const { data: sub } = await subscriptionsTable(supabase)
          .select("user_id")
          .eq("stripe_customer_id", customerId)
          .single();

        if (sub) {
          await subscriptionsTable(supabase)
            .update({
              status: "past_due",
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", sub.user_id);
        }

        break;
      }
    }
  } catch (err) {
    console.error(`Webhook handler error for ${event.type}:`, err);
    await reportSystemError("stripe.webhook", err, {
      eventId: event.id,
      eventType: event.type,
    });
    // 500: the signature was valid and OUR side failed (DB, Stripe fetch).
    // Stripe retries with backoff for up to 3 days, which is exactly what a
    // transient failure wants. Swallowing it with a 200 lost the event.
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
