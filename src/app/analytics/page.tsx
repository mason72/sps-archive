import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/helpers";
import { getUserSubscription, isFeatureAllowed } from "@/lib/stripe/subscription";
import { AnalyticsDashboard } from "@/components/analytics/AnalyticsDashboard";
import { UpgradeBanner } from "@/components/analytics/UpgradeBanner";
import { BarChart3 } from "lucide-react";

export const metadata = {
  title: "Analytics — Pixeltrunk",
};

/**
 * /analytics — Server component wrapper with plan gate.
 * Studio+ users see the full dashboard; lower plans see the UpgradeBanner.
 */
export default async function AnalyticsPage() {
  const { user, error } = await getAuthUser();
  if (error || !user) redirect("/sign-in");

  // Check subscription
  const subscription = await getUserSubscription(user.id);
  const plan = subscription?.plan ?? "free";
  const hasAnalytics = isFeatureAllowed(plan, "analytics");

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      {/* Page header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="flex items-center justify-center w-9 h-9 bg-stone-100">
          <BarChart3 className="h-4.5 w-4.5 text-stone-500" />
        </div>
        <div>
          <h1 className="font-editorial text-2xl text-stone-900 tracking-tight">
            Analytics
          </h1>
          <p className="text-[13px] text-stone-400 mt-0.5">
            Track how clients engage with your galleries
          </p>
        </div>
      </div>

      {/* Plan gate */}
      {hasAnalytics ? <AnalyticsDashboard /> : <UpgradeBanner />}
    </div>
  );
}
