"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Eye, Download, Heart, Share2 } from "lucide-react";

interface ActivityRow {
  action: string;
  eventId: string | null;
  imageId: string | null;
  shareId: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
  eventName: string | null;
}

/**
 * Short feed of the photographer's recent client interactions surfaced on
 * the dashboard. Calmly informative — collapses gracefully to nothing when
 * the archive is brand new, so first-run dashboards stay quiet.
 */
export function RecentActivity() {
  const [items, setItems] = useState<ActivityRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/dashboard/recent-activity");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setItems(data.activity ?? []);
      } catch {
        // Silently hide on error — non-essential strip.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!items || items.length === 0) return null;

  return (
    <section
      className="px-8 md:px-16 pb-12 reveal"
      style={{ animationDelay: "0.4s" }}
    >
      <div className="editorial-divider mb-6">
        <span className="label-caps shrink-0">Recent Activity</span>
      </div>
      <ul className="space-y-2">
        {items.slice(0, 5).map((row, i) => (
          <ActivityLine key={`${row.createdAt}-${i}`} row={row} />
        ))}
      </ul>
    </section>
  );
}

function ActivityLine({ row }: { row: ActivityRow }) {
  const summary = renderSummary(row);
  if (!summary) return null;

  const body = (
    <div className="flex items-baseline gap-3 py-1.5 group">
      <span className="text-stone-300 group-hover:text-stone-500 transition-colors duration-200 shrink-0 mt-0.5">
        {summary.icon}
      </span>
      <p className="text-[13px] text-stone-600 leading-relaxed flex-1 truncate">
        <span className="text-stone-900">{summary.subject}</span>{" "}
        <span className="text-stone-400">{summary.verb}</span>
        {row.eventName && (
          <>
            {" "}
            <span className="text-stone-400">·</span>{" "}
            <span className="text-stone-500">{row.eventName}</span>
          </>
        )}
      </p>
      <span className="text-[11px] tabular-nums text-stone-300 shrink-0">
        {formatRelative(row.createdAt)}
      </span>
    </div>
  );

  return row.eventId ? (
    <li>
      <Link
        href={`/events/${row.eventId}`}
        className="block hover:bg-stone-50 -mx-3 px-3 transition-colors duration-200"
      >
        {body}
      </Link>
    </li>
  ) : (
    <li className="-mx-3 px-3">{body}</li>
  );
}

interface RenderedSummary {
  icon: React.ReactNode;
  subject: string;
  verb: string;
}

function renderSummary(row: ActivityRow): RenderedSummary | null {
  switch (row.action) {
    case "share_view":
      return {
        icon: <Eye className="h-3.5 w-3.5" />,
        subject: "A viewer",
        verb: "opened the gallery",
      };
    case "image_favorite":
      return {
        icon: <Heart className="h-3.5 w-3.5" />,
        subject: "A client",
        verb: "added a favorite",
      };
    case "image_download":
      return {
        icon: <Download className="h-3.5 w-3.5" />,
        subject: "A client",
        verb: "downloaded a photo",
      };
    case "gallery_download": {
      const count =
        typeof row.metadata === "object" &&
        row.metadata &&
        typeof (row.metadata as Record<string, unknown>).imageCount === "number"
          ? ((row.metadata as Record<string, unknown>).imageCount as number)
          : null;
      return {
        icon: <Download className="h-3.5 w-3.5" />,
        subject: "A client",
        verb: count ? `downloaded the full gallery (${count} photos)` : "downloaded the full gallery",
      };
    }
    case "share_created":
      return {
        icon: <Share2 className="h-3.5 w-3.5" />,
        subject: "You",
        verb: "created a new share",
      };
    default:
      return null;
  }
}

/** "5m ago", "2h ago", "Yesterday", "Mar 4". */
function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
