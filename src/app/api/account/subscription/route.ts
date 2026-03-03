import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getUserSubscription } from "@/lib/stripe/subscription";

/**
 * GET /api/account/subscription
 *
 * Returns the authenticated user's subscription info.
 */
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const subscription = await getUserSubscription(user.id);

    return NextResponse.json({
      subscription: subscription || {
        plan: "free",
        status: "free",
        billing_interval: null,
        current_period_end: null,
        trial_end: null,
        cancel_at_period_end: false,
      },
    });
  } catch (err) {
    console.error("Subscription fetch error:", err);
    return NextResponse.json(
      { error: "Failed to fetch subscription" },
      { status: 500 }
    );
  }
}
