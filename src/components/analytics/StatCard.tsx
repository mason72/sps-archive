"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { TrendingUp, Minus } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import { useCountUp } from "@/hooks/useCountUp";
import { useInView } from "@/hooks/useInView";

interface StatCardProps {
  label: string;
  value: number;
  period30d?: number;
  icon: LucideIcon;
  sparklineData?: { value: number }[];
  color?: "emerald" | "blue" | "orange" | "stone";
}

const colorMap = {
  emerald: {
    iconBg: "bg-emerald-50",
    iconText: "text-emerald-600",
    fill: "#10b981",
    stroke: "#059669",
  },
  blue: {
    iconBg: "bg-blue-50",
    iconText: "text-blue-600",
    fill: "#3b82f6",
    stroke: "#2563eb",
  },
  orange: {
    iconBg: "bg-orange-50",
    iconText: "text-orange-600",
    fill: "#f97316",
    stroke: "#ea580c",
  },
  stone: {
    iconBg: "bg-stone-100",
    iconText: "text-stone-600",
    fill: "#78716c",
    stroke: "#57534e",
  },
};

/**
 * StatCard — Metric tile with animated value, trend indicator, and sparkline.
 */
export function StatCard({
  label,
  value,
  period30d,
  icon: Icon,
  sparklineData,
  color = "stone",
}: StatCardProps) {
  const c = colorMap[color];
  const gradientId = useId();
  const { ref, isInView } = useInView<HTMLDivElement>();
  const { displayValue } = useCountUp(value, isInView);

  const hasTrend = period30d !== undefined && period30d > 0;

  return (
    <div ref={ref} className="group relative overflow-hidden border border-stone-100 bg-white p-5 transition-shadow duration-300 hover:shadow-sm">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className={cn("inline-flex p-2", c.iconBg)}>
            <Icon className={cn("h-4 w-4", c.iconText)} />
          </div>
          <p className="text-[11px] uppercase tracking-[0.15em] text-stone-400 font-medium">
            {label}
          </p>
          <p className="text-2xl font-editorial font-semibold text-stone-900 tabular-nums tracking-tight">
            {displayValue.toLocaleString()}
          </p>
          {period30d !== undefined && (
            <div className="flex items-center gap-1">
              {hasTrend ? (
                <TrendingUp className="h-3 w-3 text-emerald-500" />
              ) : (
                <Minus className="h-3 w-3 text-stone-300" />
              )}
              <p className={cn("text-[11px] tabular-nums", hasTrend ? "text-emerald-600" : "text-stone-400")}>
                {period30d.toLocaleString()} last 30d
              </p>
            </div>
          )}
        </div>

        {/* Sparkline */}
        {sparklineData && sparklineData.length > 0 && (
          <div className="h-12 w-24 opacity-60">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparklineData}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c.fill} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={c.fill} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={c.stroke}
                  strokeWidth={1.5}
                  fill={`url(#${gradientId})`}
                  dot={false}
                  isAnimationActive={isInView}
                  animationDuration={800}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* A3: Hover detail tooltip */}
      {period30d !== undefined && (
        <div className="absolute left-5 bottom-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
          <span className="text-[10px] bg-stone-900 text-white px-2 py-1 rounded-sm whitespace-nowrap">
            {period30d.toLocaleString()} in 30 days · {value.toLocaleString()} all-time
          </span>
        </div>
      )}
    </div>
  );
}
