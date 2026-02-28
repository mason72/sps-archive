"use client";

import { useState, useEffect } from "react";

interface ShareChecklistProps {
  eventId: string;
}

interface ChecklistItem {
  label: string;
  status: "ok" | "warning" | "info";
  detail: string;
  action?: { label: string; href: string };
}

interface ReadinessData {
  imageCount: number;
  processingRemaining: number;
  hasBranding: boolean;
  hasActiveShares: boolean;
  hasPassword: boolean;
  hasExpiration: boolean;
}

function buildChecklist(data: ReadinessData, eventId: string): ChecklistItem[] {
  const items: ChecklistItem[] = [];

  // Photo count
  items.push({
    label: "photos",
    status: data.imageCount > 0 ? "ok" : "warning",
    detail:
      data.imageCount > 0
        ? `${data.imageCount} photo${data.imageCount === 1 ? "" : "s"} in gallery`
        : "No photos in gallery",
    action:
      data.imageCount === 0
        ? { label: "Upload", href: `/events/${eventId}` }
        : undefined,
  });

  // Processing status
  if (data.imageCount > 0) {
    items.push({
      label: "processing",
      status: data.processingRemaining === 0 ? "ok" : "warning",
      detail:
        data.processingRemaining === 0
          ? "Processing complete"
          : `${data.processingRemaining} image${data.processingRemaining === 1 ? "" : "s"} still processing`,
    });
  }

  // Branding
  items.push({
    label: "branding",
    status: data.hasBranding ? "ok" : "warning",
    detail: data.hasBranding
      ? "Branding applied"
      : "No branding set",
    action: !data.hasBranding
      ? { label: "Settings", href: "/dashboard/settings" }
      : undefined,
  });

  // Password (informational, not blocking)
  if (!data.hasPassword) {
    items.push({
      label: "password",
      status: "info",
      detail: "No password set",
    });
  }

  // Expiration (informational, not blocking)
  if (!data.hasExpiration) {
    items.push({
      label: "expiration",
      status: "info",
      detail: "No expiration date",
    });
  }

  return items;
}

export function ShareChecklist({ eventId }: ShareChecklistProps) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchReadiness() {
      try {
        const res = await fetch(
          `/api/events/${eventId}/share-readiness`
        );
        if (!res.ok) throw new Error("Failed to fetch readiness");
        const data: ReadinessData = await res.json();
        if (!cancelled) {
          setItems(buildChecklist(data, eventId));
        }
      } catch (error) {
        console.error("Share readiness check failed:", error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchReadiness();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  if (isLoading) {
    return (
      <div className="mb-6 space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 py-1.5">
            <div className="h-4 w-4 rounded-full bg-stone-100 animate-pulse" />
            <div className="h-3 w-32 bg-stone-100 animate-pulse rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <div className="mb-6 space-y-2">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.25em] text-stone-400 mb-3">
        Pre-flight Check
      </h3>
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-3 py-1.5">
          {/* Status icon */}
          {item.status === "ok" && (
            <svg
              className="h-4 w-4 text-emerald-500 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          )}
          {item.status === "warning" && (
            <svg
              className="h-4 w-4 text-amber-500 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
              />
            </svg>
          )}
          {item.status === "info" && (
            <svg
              className="h-4 w-4 text-stone-300 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
              />
            </svg>
          )}
          <div className="flex-1">
            <span className="text-[13px] text-stone-600">{item.detail}</span>
          </div>
          {item.action && (
            <a
              href={item.action.href}
              className="text-[11px] text-stone-400 hover:text-stone-600 underline transition-colors"
            >
              {item.action.label}
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
