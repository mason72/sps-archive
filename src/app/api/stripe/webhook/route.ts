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

function subscriptionsTable(supabase: ReturnType<typeof createServiceClient>) {
  // subscriptions table not in generated types yet — cast through unknown
  return supabase.from("subscriptions" as unknown as "profiles") as unknown as ReturnType<typeof supabase.from>;
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
        const priceId = subscription.items.data[0]?.price.id;
        const planInfo = priceId ? planFromPriceId(priceId) : null;
        const period = getSubscriptionPeriod(subscription);

        await subscriptionsTable(supabase)
          .update({
            stripe_subscription_id: subscription.id,
            stripe_customer_id: session.customer as string,
            plan: planInfo?.plan || "pro",
            status: "active",
            billing_interval: planInfo?.interval || "monthly",
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

        const priceId = subscription.items.data[0]?.price.id;
        const planInfo = priceId ? planFromPriceId(priceId) : null;
        const period = getSubscriptionPeriod(subscription);

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
            plan: planInfo?.plan || "pro",
            status: statusMap[subscription.status] || "active",
            billing_interval: planInfo?.interval || "monthly",
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
            .eq("user_id", (sub as { user_id: string }).user_id);
        }

        break;
      }
    }
  } catch (err) {
    console.error(`Webhook handler error for ${event.type}:`, err);
    // Return 200 to prevent Stripe from retrying
  }

  return NextResponse.json({ received: true });
}
