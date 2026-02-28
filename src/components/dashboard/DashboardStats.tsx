"use client";

import { useEffect, useState } from "react";

interface Stats {
  totalEvents: number;
  totalImages: number;
  totalViews: number;
  totalFavorites: number;
}

/**
 * DashboardStats — Subtle stats row at top of dashboard.
 * Editorial typography, minimal chrome.
 */
export function DashboardStats() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/stats")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.totalImages > 0) setStats(data);
      })
      .catch(() => {});
  }, []);

  // Don't show stats for brand new users with no images
  if (!stats) return null;

  const items = [
    { value: stats.totalImages.toLocaleString(), label: "photos" },
    { value: stats.totalEvents.toLocaleString(), label: stats.totalEvents === 1 ? "event" : "events" },
    ...(stats.totalViews > 0
      ? [{ value: stats.totalViews.toLocaleString(), label: "gallery views" }]
      : []),
    ...(stats.totalFavorites > 0
      ? [{ value: stats.totalFavorites.toLocaleString(), label: stats.totalFavorites === 1 ? "favorite" : "favorites" }]
      : []),
  ];

  return (
    <div className="px-8 md:px-16 pt-6 reveal" style={{ animationDelay: "0.05s" }}>
      <p className="text-[13px] text-stone-400 leading-relaxed">
        {items.map((item, i) => (
          <span key={item.label}>
            {i > 0 && <span className="mx-1.5 text-stone-300">·</span>}
            <span className="text-stone-600 tabular-nums">{item.value}</span>{" "}
            {item.label}
          </span>
        ))}
      </p>
    </div>
  );
}
