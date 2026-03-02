"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Calendar,
  Image as ImageIcon,
  Search,
  X,
  MoreHorizontal,
  ExternalLink,
  Copy,
  Pencil,
  Trash2,
} from "lucide-react";
import { BrandButton } from "@/components/ui/brand-button";
import { EventCardSkeleton } from "@/components/ui/Skeleton";

interface Event {
  id: string;
  name: string;
  slug: string;
  event_type: string | null;
  event_date: string | null;
  images: { count: number }[];
  coverThumbnailUrl?: string | null;
  activeShareSlug?: string | null;
}

/**
 * EventList — Fetches and displays the user's events on the homepage.
 * Includes search, event type filtering, image thumbnails, and action menus.
 */
export function EventList() {
  const [events, setEvents] = useState<Event[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTypeFilter, setActiveTypeFilter] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

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
            <BrandButton color="emerald" celebrate>Create Event</BrandButton>
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
          {filteredEvents.map((event, i) => (
            <EventCard
              key={event.id}
              event={event}
              index={i}
              onRefresh={loadEvents}
            />
          ))}
        </div>
      )}

      {/* Create new event CTA */}
      <div className="mt-8">
        <Link href="/events/new">
          <BrandButton size="sm" color="emerald">+ New Event</BrandButton>
        </Link>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
 * EventCard — Individual event card with thumbnail + action menu
 * ───────────────────────────────────────────── */
function EventCard({
  event,
  index,
  onRefresh,
}: {
  event: Event;
  index: number;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const imageCount = event.images?.[0]?.count ?? 0;

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setConfirmDelete(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  const handleDuplicate = async () => {
    try {
      const res = await fetch(`/api/events/${event.id}/duplicate`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      toast.success(`Duplicated as "${data.event.name}"`);
      setMenuOpen(false);
      onRefresh();
    } catch {
      toast.error("Failed to duplicate event");
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      const res = await fetch(`/api/events/${event.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      toast.success("Event deleted");
      setMenuOpen(false);
      setConfirmDelete(false);
      onRefresh();
    } catch {
      toast.error("Failed to delete event");
    }
  };

  const handleCopyLink = () => {
    if (event.activeShareSlug) {
      navigator.clipboard.writeText(`${window.location.origin}/gallery/${event.activeShareSlug}`);
      toast.success("Gallery link copied");
    } else {
      toast("No active share link");
    }
    setMenuOpen(false);
  };

  return (
    <div
      className="group relative border border-stone-200 hover:border-stone-400 transition-all duration-300 overflow-hidden reveal"
      style={{ animationDelay: `${0.1 + index * 0.05}s` }}
    >
      {/* Thumbnail */}
      <Link href={`/events/${event.id}`} className="block">
        {event.coverThumbnailUrl ? (
          <div className="aspect-[16/9] bg-stone-100 overflow-hidden">
            <img
              src={event.coverThumbnailUrl}
              alt=""
              className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
              loading="lazy"
            />
          </div>
        ) : (
          <div className="aspect-[16/9] bg-stone-50 flex items-center justify-center">
            <ImageIcon className="h-8 w-8 text-stone-200" />
          </div>
        )}
      </Link>

      {/* Action menu button */}
      <div ref={menuRef}>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMenuOpen((v) => !v);
            setConfirmDelete(false);
          }}
          className="absolute top-2 right-2 p-1.5 bg-white/80 backdrop-blur-sm border border-stone-200/50 opacity-0 group-hover:opacity-100 hover:bg-white transition-all duration-200 z-10"
        >
          <MoreHorizontal className="h-4 w-4 text-stone-500" />
        </button>

        {/* Dropdown menu */}
        {menuOpen && (
          <div className="absolute top-10 right-2 bg-white border border-stone-200 shadow-xl min-w-[160px] py-1 z-20 scale-in">
            {event.activeShareSlug && (
              <MenuButton
                icon={<ExternalLink size={13} />}
                label="Preview"
                onClick={() => {
                  window.open(`/gallery/${event.activeShareSlug}`, "_blank");
                  setMenuOpen(false);
                }}
              />
            )}
            <MenuButton
              icon={<Copy size={13} />}
              label="Copy link"
              onClick={handleCopyLink}
            />
            <MenuButton
              icon={<Pencil size={13} />}
              label="Edit"
              onClick={() => {
                router.push(`/events/${event.id}`);
                setMenuOpen(false);
              }}
            />
            <MenuButton
              icon={<Copy size={13} />}
              label="Duplicate"
              onClick={handleDuplicate}
            />
            <div className="h-px bg-stone-100 my-1" />
            {confirmDelete ? (
              <button
                onClick={handleDelete}
                className="w-full text-left px-3 py-2 text-[12px] text-red-500 hover:bg-red-50 transition-colors font-medium"
              >
                Confirm delete?
              </button>
            ) : (
              <MenuButton
                icon={<Trash2 size={13} />}
                label="Delete"
                onClick={handleDelete}
                danger
              />
            )}
          </div>
        )}
      </div>

      {/* Card content */}
      <Link href={`/events/${event.id}`} className="block p-5">
        <h3 className="font-editorial text-[20px] text-stone-900 group-hover:text-accent transition-colors duration-300 leading-tight">
          {event.name}
        </h3>

        <div className="flex items-center gap-4 mt-3 text-[12px] text-stone-400">
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
          <span className="inline-block mt-3 label-caps text-[10px] text-accent">
            {event.event_type}
          </span>
        )}
      </Link>
    </div>
  );
}

/* ─── Menu Button ─── */
function MenuButton({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className={`w-full text-left px-3 py-2 text-[12px] flex items-center gap-2.5 transition-colors ${
        danger
          ? "text-stone-400 hover:text-red-500 hover:bg-red-50"
          : "text-stone-600 hover:bg-stone-50"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
