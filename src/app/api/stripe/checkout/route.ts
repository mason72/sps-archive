import { NextRequest, NextResponse } from "next/server";
import { getStripe, isAllowedPriceId } from "@/lib/stripe/config";
import {
  createServerSupabaseClient,
  createServiceClient,
} from "@/lib/supabase/server";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3002";

/**
 * POST /api/stripe/checkout
 *
 * Creates a Stripe Checkout Session for subscription upgrade.
 * Requires authenticated user.
 *
 * Phase 0 hardening:
 *   - priceId is now validated against the env-configured allow-list
 *     (isAllowedPriceId). Previously any priceId from the request body
 *     was passed straight to Stripe — a user could subscribe to a $0
 *     test price or an arbitrary unlisted plan in the workspace.
 *   - subscriptions reads/writes use the typed table now that migration
 *     013 exists; no more `from(... as unknown as ...)` casts.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { priceId } = (await request.json()) as { priceId?: string };

    if (!priceId || typeof priceId !== "string") {
      return NextResponse.json(
        { error: "Price ID is required" },
        { status: 400 }
      );
    }

    if (!isAllowedPriceId(priceId)) {
      return NextResponse.json(
        { error: "Unknown plan" },
        { status: 400 }
      );
    }

    // Get or create Stripe customer (writes flow through the service client
    // so we can store the binding in subscriptions.stripe_customer_id —
    // the webhook resolves user_id by that column).
    const service = createServiceClient();

    const { data: sub } = await service
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .single();

    let customerId = sub?.stripe_customer_id ?? null;

    if (!customerId) {
      const customer = await getStripe().customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;

      await service
        .from("subscriptions")
        .update({
          stripe_customer_id: customerId,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id);
    }

    // Create Checkout Session
    const session = await getStripe().checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${APP_URL}/account?tab=billing&checkout=success`,
      cancel_url: `${APP_URL}/account?tab=billing&checkout=canceled`,
      metadata: { supabase_user_id: user.id },
      subscription_data: {
        metadata: { supabase_user_id: user.id },
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout error:", err);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
