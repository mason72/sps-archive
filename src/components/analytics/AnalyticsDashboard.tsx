"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Eye,
  Download,
  Heart,
  Share2,
  Loader2,
  AlertCircle,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts";
import { StatCard } from "./StatCard";
import { useInView } from "@/hooks/useInView";

interface OverviewData {
  totals: {
    views: number;
    downloads: number;
    favorites: number;
    shares: number;
  };
  period30d: {
    views: number;
    downloads: number;
    favorites: number;
  };
  sparkline: {
    date: string;
    views: number;
    downloads: number;
    favorites: number;
  }[];
}

interface EngagementData {
  recentActivity: {
    action: string;
    eventId: string | null;
    imageId: string | null;
    createdAt: string;
    metadata: Record<string, unknown>;
  }[];
}

const actionLabels: Record<string, string> = {
  share_view: "Gallery viewed",
  image_view: "Image viewed",
  image_download: "Image downloaded",
  gallery_download: "Gallery downloaded",
  image_favorite: "Image favorited",
  image_unfavorite: "Unfavorited",
  share_created: "Share created",
};

/**
 * AnalyticsDashboard — Client component rendering stat cards + charts.
 */
export function AnalyticsDashboard() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [engagement, setEngagement] = useState<EngagementData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [ovRes, engRes] = await Promise.all([
          fetch("/api/analytics/overview"),
          fetch("/api/analytics/engagement"),
        ]);

        if (!ovRes.ok || !engRes.ok) {
          throw new Error("Failed to load analytics");
        }

        const [ovData, engData] = await Promise.all([
          ovRes.json(),
          engRes.json(),
        ]);

        setOverview(ovData);
        setEngagement(engData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, []);

  // A1: Chart entrance animations (must be before early returns)
  const { ref: areaChartRef, isInView: areaChartInView } = useInView<HTMLDivElement>();
  const { ref: barChartRef, isInView: barChartInView } = useInView<HTMLDivElement>();

  // A2: Group activity items by date bucket
  const groupedActivity = useMemo(() => {
    if (!engagement?.recentActivity?.length) return null;
    return groupActivityByDate(engagement.recentActivity);
  }, [engagement]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 text-stone-300 animate-spin" />
      </div>
    );
  }

  if (error || !overview) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3 text-stone-400">
        <AlertCircle className="h-8 w-8" />
        <p className="text-[13px]">{error || "No data available"}</p>
      </div>
    );
  }

  const { totals, period30d, sparkline } = overview;

  return (
    <div className="space-y-8">
      {/* ─── Stat Cards ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Gallery Views"
          value={totals.views}
          period30d={period30d.views}
          icon={Eye}
          color="blue"
          sparklineData={sparkline.map((d) => ({ value: d.views }))}
        />
        <StatCard
          label="Downloads"
          value={totals.downloads}
          period30d={period30d.downloads}
          icon={Download}
          color="emerald"
          sparklineData={sparkline.map((d) => ({ value: d.downloads }))}
        />
        <StatCard
          label="Favorites"
          value={totals.favorites}
          period30d={period30d.favorites}
          icon={Heart}
          color="orange"
          sparklineData={sparkline.map((d) => ({ value: d.favorites }))}
        />
        <StatCard
          label="Shares Created"
          value={totals.shares}
          icon={Share2}
          color="stone"
        />
      </div>

      {/* ─── 30-day trend chart ─── */}
      <div
        ref={areaChartRef}
        className={`border border-stone-100 bg-white p-6 transition-all duration-700 ${areaChartInView ? "chart-entrance" : "opacity-0"}`}
      >
        <h3 className="text-[11px] uppercase tracking-[0.15em] font-medium text-stone-400 mb-4">
          30-Day Engagement
        </h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkline}>
              <defs>
                <linearGradient id="gradViews" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradDownloads" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradFavorites" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f97316" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="#f97316" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#f5f5f4"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "#a8a29e" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: string) => {
                  const d = new Date(v);
                  return `${d.getMonth() + 1}/${d.getDate()}`;
                }}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#a8a29e" }}
                tickLine={false}
                axisLine={false}
                width={30}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  fontSize: 11,
                  border: "1px solid #e7e5e4",
                  borderRadius: 0,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                }}
                labelFormatter={(v) =>
                  new Date(String(v)).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })
                }
              />
              <Area
                type="monotone"
                dataKey="views"
                stroke="#3b82f6"
                strokeWidth={1.5}
                fill="url(#gradViews)"
                dot={false}
                name="Views"
                isAnimationActive={areaChartInView}
                animationDuration={800}
              />
              <Area
                type="monotone"
                dataKey="downloads"
                stroke="#10b981"
                strokeWidth={1.5}
                fill="url(#gradDownloads)"
                dot={false}
                name="Downloads"
                isAnimationActive={areaChartInView}
                animationDuration={800}
                animationBegin={150}
              />
              <Area
                type="monotone"
                dataKey="favorites"
                stroke="#f97316"
                strokeWidth={1.5}
                fill="url(#gradFavorites)"
                dot={false}
                name="Favorites"
                isAnimationActive={areaChartInView}
                animationDuration={800}
                animationBegin={300}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ─── Engagement breakdown (daily bar chart) ─── */}
      <div
        ref={barChartRef}
        className={`border border-stone-100 bg-white p-6 transition-all duration-700 ${barChartInView ? "chart-entrance" : "opacity-0"}`}
        style={{ animationDelay: "150ms" }}
      >
        <h3 className="text-[11px] uppercase tracking-[0.15em] font-medium text-stone-400 mb-4">
          Daily Breakdown
        </h3>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sparkline.slice(-14)}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#f5f5f4"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "#a8a29e" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: string) => {
                  const d = new Date(v);
                  return `${d.getMonth() + 1}/${d.getDate()}`;
                }}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#a8a29e" }}
                tickLine={false}
                axisLine={false}
                width={25}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  fontSize: 11,
                  border: "1px solid #e7e5e4",
                  borderRadius: 0,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                }}
                labelFormatter={(v) =>
                  new Date(String(v)).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })
                }
              />
              <Bar dataKey="views" fill="#93c5fd" name="Views" stackId="a" isAnimationActive={barChartInView} animationDuration={600} />
              <Bar dataKey="downloads" fill="#6ee7b7" name="Downloads" stackId="a" isAnimationActive={barChartInView} animationDuration={600} animationBegin={100} />
              <Bar dataKey="favorites" fill="#fdba74" name="Favorites" stackId="a" isAnimationActive={barChartInView} animationDuration={600} animationBegin={200} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ─── Recent Activity Timeline ─── */}
      {groupedActivity && groupedActivity.length > 0 && (
        <div className="border border-stone-100 bg-white p-6">
          <h3 className="text-[11px] uppercase tracking-[0.15em] font-medium text-stone-400 mb-5">
            Recent Activity
          </h3>
          <div className="space-y-5">
            {groupedActivity.map((group) => (
              <div key={group.label}>
                <p className="text-[10px] uppercase tracking-[0.2em] font-medium text-stone-300 mb-3">
                  {group.label}
                </p>
                <div className="relative ml-3 border-l border-stone-100 pl-5 space-y-0">
                  {group.items.map((item, i) => (
                    <div
                      key={i}
                      className="relative flex items-center justify-between py-2 stagger-in"
                      style={{ animationDelay: `${i * 80}ms` }}
                    >
                      {/* Timeline dot */}
                      <div
                        className={`absolute -left-[23px] top-1/2 -translate-y-1/2 h-2 w-2 rounded-full ring-2 ring-white ${getTimelineDotColor(item.action)}`}
                      />
                      <div className="flex items-center gap-2.5">
                        <ActivityIcon action={item.action} />
                        <span className="text-[13px] text-stone-700">
                          {actionLabels[item.action] ?? item.action}
                        </span>
                      </div>
                      <span className="text-[11px] text-stone-400 tabular-nums">
                        {formatRelativeTime(item.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Action icon mapping */
function ActivityIcon({ action }: { action: string }) {
  const iconClass = "h-3.5 w-3.5";
  switch (action) {
    case "share_view":
    case "image_view":
      return <Eye className={`${iconClass} text-blue-500`} />;
    case "image_download":
    case "gallery_download":
      return <Download className={`${iconClass} text-emerald-500`} />;
    case "image_favorite":
      return <Heart className={`${iconClass} text-orange-500`} />;
    case "share_created":
      return <Share2 className={`${iconClass} text-stone-500`} />;
    default:
      return <Eye className={`${iconClass} text-stone-400`} />;
  }
}

/** Timeline dot color by action type */
function getTimelineDotColor(action: string): string {
  switch (action) {
    case "share_view":
    case "image_view":
      return "bg-blue-400";
    case "image_download":
    case "gallery_download":
      return "bg-emerald-400";
    case "image_favorite":
    case "image_unfavorite":
      return "bg-orange-400";
    case "share_created":
      return "bg-stone-400";
    default:
      return "bg-stone-300";
  }
}

/** Group activity items by Today / Yesterday / This Week / Older */
interface ActivityItem {
  action: string;
  eventId: string | null;
  imageId: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}

interface ActivityGroup {
  label: string;
  items: ActivityItem[];
}

function groupActivityByDate(items: ActivityItem[]): ActivityGroup[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  const weekStart = todayStart - 6 * 86400000;

  const groups: Record<string, ActivityItem[]> = {};
  const order = ["Today", "Yesterday", "This Week", "Earlier"];

  for (const item of items) {
    const t = new Date(item.createdAt).getTime();
    let bucket: string;
    if (t >= todayStart) bucket = "Today";
    else if (t >= yesterdayStart) bucket = "Yesterday";
    else if (t >= weekStart) bucket = "This Week";
    else bucket = "Earlier";

    if (!groups[bucket]) groups[bucket] = [];
    groups[bucket].push(item);
  }

  return order
    .filter((label) => groups[label]?.length)
    .map((label) => ({ label, items: groups[label] }));
}

/** Format "3h ago", "2d ago" etc. */
function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
