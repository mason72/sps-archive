import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3002";

/**
 * POST /api/stripe/portal
 *
 * Creates a Stripe Customer Portal session for managing subscription.
 * Requires authenticated user with an existing Stripe customer ID.
 */
export async function POST() {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const service = createServiceClient();
    // subscriptions table not in generated types yet — cast through unknown
    const { data: sub } = await (service.from("subscriptions" as unknown as "profiles") as unknown as ReturnType<typeof service.from>)
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .single();

    const customerIdRow = sub as { stripe_customer_id?: string } | null;

    if (!customerIdRow?.stripe_customer_id) {
      return NextResponse.json(
        { error: "No billing account found. Subscribe to a plan first." },
        { status: 400 }
      );
    }

    const session = await getStripe().billingPortal.sessions.create({
      customer: customerIdRow.stripe_customer_id,
      return_url: `${APP_URL}/account?tab=billing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Stripe portal error:", err);
    return NextResponse.json(
      { error: "Failed to create portal session" },
      { status: 500 }
    );
  }
}
