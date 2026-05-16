import Link from "next/link";
import { Nav } from "./Nav";
import { SignOutButton } from "../auth/SignOutButton";
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
  return (
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
    </Nav>
  );
}
