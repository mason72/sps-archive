"use client";

import { BarChart3, Sparkles } from "lucide-react";
import Link from "next/link";

/**
 * UpgradeBanner — Elegant plan gate for features requiring Studio+ tier.
 * Reusable across analytics and other premium features.
 */
export function UpgradeBanner({
  feature = "Analytics",
  description = "Track how clients engage with your galleries — views, favorites, downloads, and more.",
}: {
  feature?: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-8 text-center">
      <div className="max-w-md space-y-6">
        {/* Icon */}
        <div className="mx-auto flex h-16 w-16 items-center justify-center bg-stone-50">
          <BarChart3 className="h-7 w-7 text-stone-400" />
        </div>

        {/* Copy */}
        <div className="space-y-2">
          <h2 className="font-editorial text-2xl font-semibold text-stone-900 tracking-tight">
            {feature}
          </h2>
          <p className="text-[14px] leading-relaxed text-stone-500">
            {description}
          </p>
        </div>

        {/* Plan badge */}
        <div className="inline-flex items-center gap-1.5 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/60 px-3 py-1.5 text-[11px] uppercase tracking-[0.15em] font-medium text-amber-700">
          <Sparkles className="h-3 w-3" />
          Studio Plan & Above
        </div>

        {/* CTA */}
        <div>
          <Link
            href="/settings/billing"
            className="inline-block bg-stone-900 text-white text-[12px] uppercase tracking-[0.15em] font-medium px-6 py-3 hover:bg-stone-800 transition-colors duration-300"
          >
            Upgrade Plan
          </Link>
          <p className="mt-3 text-[11px] text-stone-400">
            Free 14-day trial included
          </p>
        </div>
      </div>
    </div>
  );
}
