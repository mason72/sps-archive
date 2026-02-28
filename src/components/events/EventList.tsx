"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { Calendar, Image as ImageIcon, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EventCardSkeleton } from "@/components/ui/Skeleton";

interface Event {
  id: string;
  name: string;
  slug: string;
  event_type: string | null;
  event_date: string | null;
  images: { count: number }[];
}

/**
 * EventList — Fetches and displays the user's events on the homepage.
 * Includes search and event type filtering.
 */
export function EventList() {
  const [events, setEvents] = useState<Event[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTypeFilter, setActiveTypeFilter] = useState<string | null>(null);

  useEffect(() => {
    async function loadEvents() {
      try {
        const res = await fetch("/api/events?limit=100");
        if (!res.ok) return;
        const data = await res.json();
        setEvents(data.events || []);
      } catch (err) {
        console.error("EventList: fetch error:", err);
      } finally {
        setIsLoaded(true);
      }
    }
    loadEvents();
  }, []);

  // Extract unique event types for filter chips
  const eventTypes = useMemo(() => {
    const types = new Set<string>();
    events.forEach((e) => {
      if (e.event_type) types.add(e.event_type);
    });
    return Array.from(types).sort();
  }, [events]);

  // Client-side search + filter
  const filteredEvents = useMemo(() => {
    let result = events;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          (e.event_type && e.event_type.toLowerCase().includes(q)) ||
          (e.event_date && e.event_date.includes(q))
      );
    }

    if (activeTypeFilter) {
      result = result.filter((e) => e.event_type === activeTypeFilter);
    }

    return result;
  }, [events, searchQuery, activeTypeFilter]);

  const hasFilters = searchQuery.trim() !== "" || activeTypeFilter !== null;

  // Still loading — show skeleton grid matching the real layout
  if (!isLoaded) {
    return (
      <div className="px-8 md:px-16 pb-20">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 max-w-5xl">
          {Array.from({ length: 6 }).map((_, i) => (
            <EventCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  // Empty state — first-time user
  if (events.length === 0) {
    return (
      <div className="px-8 md:px-16 py-20">
        <div className="flex flex-col items-center justify-center text-center py-16 border border-dashed border-stone-200">
          <p className="font-editorial text-2xl text-stone-300 italic mb-3">
            No events yet
          </p>
          <p className="text-[13px] text-stone-400 mb-8">
            Create your first event to start uploading photos
          </p>
          <Link href="/events/new">
            <Button>Create Event</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="px-8 md:px-16 pb-20">
      {/* ─── Search + filters ─── */}
      <div className="mb-8 max-w-5xl reveal" style={{ animationDelay: "0.05s" }}>
        {/* Search bar */}
        <div className="relative mb-4">
          <Search className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-300" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search events…"
            className="w-full pl-7 pr-8 py-2.5 text-[14px] text-stone-900 placeholder:text-stone-300 bg-transparent border-b border-stone-200 focus:border-stone-900 focus:outline-none transition-colors duration-300"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-stone-300 hover:text-stone-600 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Event type filter chips */}
        {eventTypes.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setActiveTypeFilter(null)}
              className={`px-3 py-1 text-[11px] uppercase tracking-[0.12em] font-medium border transition-all duration-300 ${
                !activeTypeFilter
                  ? "border-stone-900 bg-stone-900 text-white"
                  : "border-stone-200 text-stone-400 hover:border-stone-400"
              }`}
            >
              All
            </button>
            {eventTypes.map((type) => (
              <button
                key={type}
                onClick={() =>
                  setActiveTypeFilter(activeTypeFilter === type ? null : type)
                }
                className={`px-3 py-1 text-[11px] uppercase tracking-[0.12em] font-medium border transition-all duration-300 ${
                  activeTypeFilter === type
                    ? "border-stone-900 bg-stone-900 text-white"
                    : "border-stone-200 text-stone-400 hover:border-stone-400"
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ─── Event grid ─── */}
      {filteredEvents.length === 0 && hasFilters ? (
        <div className="py-16 text-center max-w-5xl">
          <p className="font-editorial text-xl text-stone-300 italic mb-2">
            No matching events
          </p>
          <p className="text-[13px] text-stone-400">
            Try a different search term or{" "}
            <button
              onClick={() => {
                setSearchQuery("");
                setActiveTypeFilter(null);
              }}
              className="text-stone-600 hover:text-stone-900 underline transition-colors"
            >
              clear filters
            </button>
          </p>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 max-w-5xl">
          {filteredEvents.map((event, i) => {
            const imageCount = event.images?.[0]?.count ?? 0;

            return (
              <Link
                key={event.id}
                href={`/events/${event.id}`}
                className="group block border border-stone-200 p-6 hover:border-stone-400 transition-all duration-300 reveal"
                style={{ animationDelay: `${0.1 + i * 0.05}s` }}
              >
                <h3 className="font-editorial text-[22px] text-stone-900 group-hover:text-accent transition-colors duration-300 leading-tight">
                  {event.name}
                </h3>

                <div className="flex items-center gap-4 mt-4 text-[12px] text-stone-400">
                  {event.event_date && (
                    <span className="flex items-center gap-1.5">
                      <Calendar className="h-3 w-3" />
                      {new Date(event.event_date).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  )}
                  <span className="flex items-center gap-1.5">
                    <ImageIcon className="h-3 w-3" />
                    {imageCount} {imageCount === 1 ? "image" : "images"}
                  </span>
                </div>

                {event.event_type && (
                  <span className="inline-block mt-4 label-caps text-[10px] text-accent">
                    {event.event_type}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {/* Create new event CTA */}
      <div className="mt-8">
        <Link
          href="/events/new"
          className="text-[13px] editorial-link text-stone-400 hover:text-stone-700 transition-colors duration-300"
        >
          + Create new event
        </Link>
      </div>
    </div>
  );
}
