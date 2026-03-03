import { createServiceClient } from "@/lib/supabase/server";
import { PLANS, type PlanId, type PlanConfig } from "./config";

export interface Subscription {
  id: string;
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: PlanId;
  status: "trialing" | "active" | "past_due" | "canceled" | "free";
  billing_interval: "monthly" | "annual" | null;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Helper to query the subscriptions table with proper typing.
 * The `subscriptions` table isn't in the generated Supabase types yet
 * (needs SQL migration), so we cast through `unknown`.
 */
function subscriptionsTable(supabase: ReturnType<typeof createServiceClient>) {
  // subscriptions table not in generated types yet — cast through unknown
  return supabase.from("subscriptions" as unknown as "profiles") as unknown as ReturnType<typeof supabase.from>;
}

/**
 * Get user's subscription from Supabase.
 * Returns null if no subscription exists (shouldn't happen after trigger setup).
 */
export async function getUserSubscription(
  userId: string
): Promise<Subscription | null> {
  const supabase = createServiceClient();
  const { data, error } = await subscriptionsTable(supabase)
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error || !data) return null;

  const row = data as Subscription;

  // Check trial expiry
  if (row.status === "trialing" && row.trial_end) {
    const trialEnd = new Date(row.trial_end);
    if (trialEnd < new Date()) {
      // Trial expired — downgrade to free
      await subscriptionsTable(supabase)
        .update({
          plan: "free",
          status: "free",
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);

      return { ...row, plan: "free" as PlanId, status: "free" as const };
    }
  }

  return row;
}

/**
 * Get the plan limits for a given plan ID.
 */
export function getPlanLimits(plan: PlanId): PlanConfig {
  return PLANS[plan] || PLANS.free;
}

/**
 * Check if a specific feature is allowed on the user's plan.
 */
export function isFeatureAllowed(
  plan: PlanId,
  feature: keyof PlanConfig["features"]
): boolean {
  const config = PLANS[plan];
  if (!config) return false;
  return config.features[feature];
}
