"use client";

import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Search,
  ArrowRight,
  Home,
  PlusCircle,
  Settings,
  LogOut,
  Calendar,
  Command,
  CornerDownLeft,
} from "lucide-react";

/* ─────────────────────────────────────────────
 * Types
 * ───────────────────────────────────────────── */
interface CommandItem {
  id: string;
  label: string;
  group: string;
  icon?: React.ReactNode;
  shortcut?: string;
  onSelect: () => void;
}

interface EventRow {
  id: string;
  name: string;
  event_type: string | null;
  event_date: string | null;
}

/* ─────────────────────────────────────────────
 * CommandPalette
 * ───────────────────────────────────────────── */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [events, setEvents] = useState<EventRow[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ── Fetch events when palette opens ──
  useEffect(() => {
    if (!open) return;
    const supabase = createClient();
    supabase
      .from("events")
      .select("id, name, event_type, event_date")
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }: { data: EventRow[] | null }) => {
        if (data) setEvents(data);
      });
  }, [open]);

  // ── Global ⌘K listener ──
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // ⌘K or Ctrl+K
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      // Escape closes
      if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  // ── Focus input when opened ──
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // ── Build command list ──
  const navigate = useCallback(
    (path: string) => {
      setOpen(false);
      router.push(path);
    },
    [router]
  );

  const handleSignOut = useCallback(async () => {
    setOpen(false);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }, [router]);

  const navItems: CommandItem[] = [
    {
      id: "nav-dashboard",
      label: "Dashboard",
      group: "Navigation",
      icon: <Home size={15} />,
      onSelect: () => navigate("/"),
    },
    {
      id: "nav-new-event",
      label: "New Event",
      group: "Navigation",
      icon: <PlusCircle size={15} />,
      shortcut: "N",
      onSelect: () => navigate("/events/new"),
    },
    {
      id: "nav-account",
      label: "Account Settings",
      group: "Navigation",
      icon: <Settings size={15} />,
      onSelect: () => navigate("/account"),
    },
    {
      id: "action-signout",
      label: "Sign Out",
      group: "Actions",
      icon: <LogOut size={15} />,
      onSelect: handleSignOut,
    },
  ];

  const eventItems: CommandItem[] = events.map((evt) => ({
    id: `event-${evt.id}`,
    label: evt.name,
    group: "Events",
    icon: <Calendar size={15} />,
    onSelect: () => navigate(`/events/${evt.id}`),
  }));

  // ── Filter by query ──
  const allItems = [...navItems, ...eventItems];
  const q = query.toLowerCase().trim();
  const filtered = q
    ? allItems.filter((item) => item.label.toLowerCase().includes(q))
    : allItems;

  // Group items for rendering
  const groups: Record<string, CommandItem[]> = {};
  for (const item of filtered) {
    if (!groups[item.group]) groups[item.group] = [];
    groups[item.group].push(item);
  }
  const groupEntries = Object.entries(groups);

  // Flat list for keyboard navigation
  const flatItems = filtered;

  // ── Keyboard navigation ──
  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      flatItems[activeIndex]?.onSelect();
    }
  };

  // Reset active index on filter change
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  let flatIndex = -1;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-[2px] fade-in"
        onClick={() => setOpen(false)}
      />

      {/* Palette */}
      <div className="fixed inset-0 z-[101] flex items-start justify-center pt-[min(20vh,160px)] px-4">
        <div
          className="w-full max-w-[520px] bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden fade-in"
          style={{ animationDuration: "150ms" }}
        >
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 border-b border-stone-100">
            <Search size={16} className="text-stone-300 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="Search events, navigate..."
              className="w-full py-3.5 text-[14px] bg-transparent placeholder:text-stone-300 focus:outline-none"
            />
            <kbd className="hidden sm:flex items-center gap-0.5 text-[11px] text-stone-300 bg-stone-50 border border-stone-200 rounded px-1.5 py-0.5 shrink-0">
              esc
            </kbd>
          </div>

          {/* Results */}
          <div ref={listRef} className="max-h-[min(50vh,360px)] overflow-y-auto py-2">
            {flatItems.length === 0 && (
              <p className="px-4 py-8 text-center text-[13px] text-stone-300">
                No results found
              </p>
            )}

            {groupEntries.map(([group, items]) => (
              <Fragment key={group}>
                <p className="px-4 pt-3 pb-1 text-[11px] font-medium tracking-wider uppercase text-stone-300">
                  {group}
                </p>
                {items.map((item) => {
                  flatIndex++;
                  const idx = flatIndex;
                  const isActive = idx === activeIndex;
                  return (
                    <button
                      key={item.id}
                      data-index={idx}
                      onClick={item.onSelect}
                      onMouseEnter={() => setActiveIndex(idx)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-[13px] transition-colors duration-100 ${
                        isActive
                          ? "bg-stone-50 text-stone-900"
                          : "text-stone-500 hover:bg-stone-50"
                      }`}
                    >
                      <span
                        className={`shrink-0 ${isActive ? "text-stone-600" : "text-stone-300"}`}
                      >
                        {item.icon || <ArrowRight size={15} />}
                      </span>
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.shortcut && (
                        <kbd className="text-[11px] text-stone-300 bg-stone-50 border border-stone-100 rounded px-1.5 py-0.5">
                          {item.shortcut}
                        </kbd>
                      )}
                      {isActive && (
                        <CornerDownLeft size={13} className="text-stone-300 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </Fragment>
            ))}
          </div>

          {/* Footer hints */}
          <div className="flex items-center gap-4 px-4 py-2.5 border-t border-stone-100 text-[11px] text-stone-300">
            <span className="flex items-center gap-1">
              <kbd className="bg-stone-50 border border-stone-200 rounded px-1 py-0.5">↑↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="bg-stone-50 border border-stone-200 rounded px-1 py-0.5">↵</kbd>
              select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="bg-stone-50 border border-stone-200 rounded px-1 py-0.5">esc</kbd>
              close
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
