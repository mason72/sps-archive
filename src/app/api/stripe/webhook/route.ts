import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe, planFromPriceId } from "@/lib/stripe/config";
import { createServiceClient } from "@/lib/supabase/server";

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

/**
 * Look up the local user_id for a Stripe customer.
 *
 * Preferred over reading `metadata.supabase_user_id` directly because the
 * customer ↔ user binding is established server-side at checkout (we
 * insert stripe_customer_id into subscriptions when we create the
 * customer). Metadata could be set/changed via the Stripe Dashboard or
 * any other actor with the secret key.
 */
async function resolveUserIdFromCustomer(
  supabase: ReturnType<typeof createServiceClient>,
  customerId: string | null
): Promise<string | null> {
  if (!customerId) return null;
  const { data } = await supabase
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .single();
  return data?.user_id ?? null;
}

/**
 * POST /api/stripe/webhook
 *
 * Handles Stripe webhook events to sync subscription state to Supabase.
 *
 * Phase 0 hardening:
 *   - Replays are deduped via a stripe_events PK insert (migration 014).
 *     The first delivery wins; duplicates are acknowledged with 200 and
 *     return without re-running handlers.
 *   - User binding flows customer → subscriptions.stripe_customer_id
 *     instead of trusting metadata.supabase_user_id blindly.
 *   - Unknown / typo'd price IDs no longer silently grant `plan: "pro"`
 *     — they short-circuit the handler so we don't write garbage state.
 *   - On handler exception we return 500 (Stripe retries) instead of 200
 *     (silently dropping transient DB blips).
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

  // Idempotency: insert event.id; if it's already there we've handled it.
  const { error: dedupeErr } = await supabase
    .from("stripe_events")
    .insert({ event_id: event.id, event_type: event.type });

  if (dedupeErr) {
    // 23505 unique_violation = already processed. Acknowledge and move on.
    // PostgrestError code lives on the error object.
    const code = (dedupeErr as { code?: string }).code;
    if (code === "23505") {
      return NextResponse.json({ received: true, duplicate: true });
    }
    console.error("Stripe event dedupe insert failed:", dedupeErr);
    // If we can't even record the event, Stripe should retry.
    return NextResponse.json({ error: "Dedupe failure" }, { status: 500 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (!session.subscription || !session.customer) break;

        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : session.customer.id;

        const userId = await resolveUserIdFromCustomer(supabase, customerId);
        if (!userId) {
          console.error(
            `[stripe-webhook] checkout.session.completed for unknown customer ${customerId}`
          );
          break;
        }

        const subscription = await getStripe().subscriptions.retrieve(
          session.subscription as string
        );
        const priceId = subscription.items.data[0]?.price.id;
        const planInfo = priceId ? planFromPriceId(priceId) : null;
        if (!planInfo) {
          console.error(
            `[stripe-webhook] checkout.session.completed: unknown priceId ${priceId} — refusing to flip plan`
          );
          break;
        }
        const period = getSubscriptionPeriod(subscription);

        await supabase
          .from("subscriptions")
          .update({
            stripe_subscription_id: subscription.id,
            stripe_customer_id: customerId,
            plan: planInfo.plan,
            status: "active",
            billing_interval: planInfo.interval,
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
        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer.id;
        const userId = await resolveUserIdFromCustomer(supabase, customerId);
        if (!userId) {
          console.error(
            `[stripe-webhook] subscription.updated for unknown customer ${customerId}`
          );
          break;
        }

        const priceId = subscription.items.data[0]?.price.id;
        const planInfo = priceId ? planFromPriceId(priceId) : null;
        if (!planInfo) {
          console.error(
            `[stripe-webhook] subscription.updated: unknown priceId ${priceId} — refusing to flip plan`
          );
          break;
        }
        const period = getSubscriptionPeriod(subscription);

        const statusMap: Record<string, "trialing" | "active" | "past_due" | "canceled"> = {
          active: "active",
          trialing: "trialing",
          past_due: "past_due",
          canceled: "canceled",
          unpaid: "past_due",
          incomplete: "past_due",
          incomplete_expired: "canceled",
          paused: "canceled",
        };

        await supabase
          .from("subscriptions")
          .update({
            plan: planInfo.plan,
            status: statusMap[subscription.status] || "active",
            billing_interval: planInfo.interval,
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
        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer.id;
        const userId = await resolveUserIdFromCustomer(supabase, customerId);
        if (!userId) break;

        await supabase
          .from("subscriptions")
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
        const customerId =
          typeof invoice.customer === "string"
            ? invoice.customer
            : invoice.customer?.id ?? null;
        const userId = await resolveUserIdFromCustomer(supabase, customerId);
        if (!userId) break;

        await supabase
          .from("subscriptions")
          .update({
            status: "past_due",
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", userId);

        break;
      }
    }
  } catch (err) {
    console.error(`Webhook handler error for ${event.type}:`, err);
    // Roll back the idempotency record so Stripe's retry can re-run the
    // handler. Otherwise transient failures (DB blip, network) become
    // permanent state drift.
    await supabase.from("stripe_events").delete().eq("event_id", event.id);
    return NextResponse.json(
      { error: "Handler failed; will retry" },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true });
}
