import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3002";

/**
 * POST /api/stripe/checkout
 *
 * Creates a Stripe Checkout Session for subscription upgrade.
 * Requires authenticated user.
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

    const { priceId } = await request.json();

    if (!priceId) {
      return NextResponse.json(
        { error: "Price ID is required" },
        { status: 400 }
      );
    }

    // Get or create Stripe customer
    const service = createServiceClient();
    // subscriptions table not in generated types yet — cast through unknown
    const subs = service.from("subscriptions" as unknown as "profiles") as unknown as ReturnType<typeof service.from>;

    const { data: sub } = await subs
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .single();

    let customerId = (sub as { stripe_customer_id?: string } | null)
      ?.stripe_customer_id;

    if (!customerId) {
      // Create Stripe customer
      const customer = await getStripe().customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;

      // Store customer ID
      await subs
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
