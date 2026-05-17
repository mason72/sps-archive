"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Nav } from "./Nav";
import { SignOutButton } from "../auth/SignOutButton";
import { ShortcutsHelp } from "@/components/command/ShortcutsHelp";
import { cn } from "@/lib/utils";

type Section = "events" | "search" | "analytics" | "templates" | "account";

interface AppNavProps {
  /**
   * Optional page-specific action buttons (Add Images, Publish, etc.).
   * Rendered before the global links on the right side of the nav.
   */
  actions?: React.ReactNode;
  /**
   * Currently active section. The matching link is rendered in the
   * primary text weight so the user knows where they are.
   */
  active?: Section;
}

const LINK_BASE = "editorial-link transition-colors duration-300";

function linkClass(section: Section, active?: Section) {
  return section === active
    ? cn(LINK_BASE, "font-medium text-stone-900")
    : cn(LINK_BASE, "text-stone-400 hover:text-stone-700");
}

/**
 * AppNav — the consistent navigation shown on every authenticated page.
 *
 * Replaces the per-page slotted Nav that previously varied across 8
 * different sites (sign-out only on home, search reachable only from
 * the search page, analytics unreachable from anywhere). Page-specific
 * actions still get a slot via `actions`, rendered before the global
 * links so the primary action remains thumb-reachable on the right.
 *
 * On small screens (< md) the secondary links (Search, Analytics,
 * Templates) collapse — they remain reachable via the ⌘K command
 * palette. Logo + actions + Account + Sign out stay visible.
 */
export function AppNav({ actions, active }: AppNavProps) {
  // Small "?" discovery affordance opens the global ShortcutsHelp panel.
  // Also binds the "?" key here so the help is reachable from any
  // authenticated page (not just the event detail page, which had its
  // own listener via useGalleryShortcuts). The two-listener overlap is
  // intentional — the event page handles its own enable/disable state,
  // and the AppNav listener is gated on an input/contenteditable check.
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "?") return;
      // Don't fight modifier chords or typing in inputs.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      setHelpOpen((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <Nav>
        {actions && (
          <div className="flex items-center gap-3 md:gap-5">{actions}</div>
        )}

        <Link href="/" className={linkClass("events", active)}>
          Events
        </Link>

        {/* Secondary links collapse on mobile; reachable via ⌘K. */}
        <Link
          href="/search"
          className={cn("hidden md:inline-flex", linkClass("search", active))}
        >
          Search
        </Link>
        <Link
          href="/analytics"
          className={cn("hidden md:inline-flex", linkClass("analytics", active))}
        >
          Analytics
        </Link>
        <Link
          href="/settings/emails"
          className={cn("hidden md:inline-flex", linkClass("templates", active))}
        >
          Templates
        </Link>

        <Link href="/account" className={linkClass("account", active)}>
          Account
        </Link>
        <SignOutButton />

        {/* Keyboard hints — small, easily overlooked when you don't need it,
            obvious once you do. */}
        <button
          type="button"
          onClick={() => setHelpOpen((v) => !v)}
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
          className="hidden md:inline-flex h-6 w-6 items-center justify-center text-[12px] text-stone-300 hover:text-stone-700 border border-stone-200 hover:border-stone-400 rounded-full transition-colors duration-200"
        >
          ?
        </button>
      </Nav>
      {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
    </>
  );
}
