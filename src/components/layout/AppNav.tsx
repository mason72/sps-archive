"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { BrandButton } from "@/components/ui/brand-button";

/**
 * The signed-in navigation, in ONE place.
 *
 * Every page used to hand-roll its own list of links — fourteen copies of the
 * same four `<Link>`s. They had already drifted, and adding a destination meant
 * editing fourteen files, which is exactly why /intel shipped unreachable.
 *
 * Structure is Mason's (2026-08-14):
 *
 *   Archive · Search · People · New Event ▾ · Ops* · Account ▾
 *
 *   *Ops is admin-only and rendered only when the server says so. Not a
 *   security boundary — /ops re-gates on every page — but a link to a place
 *   you cannot go is worse than no link.
 */

export interface AppNavProps {
  /**
   * Controls whether Ops is OFFERED, never whether it is allowed — /ops
   * re-gates server-side on every page.
   *
   * Server pages pass it via `AppNavServer`. Client pages cannot read the
   * session synchronously, so leaving it undefined makes the nav ask once
   * (see below) rather than silently hiding Ops — which is exactly the bug
   * that unifying the nav introduced.
   */
  isAdmin?: boolean;
  /**
   * Whether to OFFER Event Intel. Same contract as `isAdmin`: undefined means
   * "ask", never "no", and /intel plus every intel route re-gate server-side
   * regardless (`src/lib/event-intel/access.ts`).
   *
   * Separate from `isAdmin` because they are genuinely different accounts —
   * `is_admin` is mason@'s and every crew, venue and event row belongs to
   * info@, the shared team login. Folding them into one flag would have shown
   * Intel to the account with no data and hidden it from the one with all of
   * it.
   */
  hasIntel?: boolean;
  current?: "archive" | "search" | "people" | "intel" | "account" | "ops";
}

const LINK =
  "editorial-link text-stone-400 transition-colors duration-300 hover:text-stone-700";
const LINK_ON = "editorial-link text-stone-800";

/**
 * A nav item that is BOTH a destination and a menu.
 *
 * The first version made these pure menu buttons, and "New Event" — a thing
 * Mason clicks constantly — stopped being clickable. The parent is a real link
 * again; the menu holds only what the parent ISN'T.
 *
 * Three ways in, deliberately:
 *   · click the LABEL     → go to the primary destination
 *   · hover the group     → the menu appears (desktop convenience)
 *   · click the CHEVRON   → the menu opens and stays
 *
 * The chevron exists because hover does not, on a phone. Without it the
 * secondary items would simply not exist on touch, which is the failure this
 * app has a standing rule against.
 *
 * `group-hover:` is safe here — VERIFIED against the compiled stylesheet rather
 * than assumed, because "sticky hover" leaving a menu stuck open after a tap is
 * exactly the kind of thing that is invisible until someone is holding a phone.
 * Tailwind v4 emits:
 *
 *   .group-hover\:visible { &:is(:where(.group):hover *) { @media (hover: hover) { … } } }
 *
 * so the reveal never engages on a touch device. Writing an explicit
 * `[@media(hover:hover)]:` prefix on top of that only nests a second identical
 * media query inside the first.
 */
function SplitMenu({
  label,
  href,
  active,
  button,
  children,
}: {
  /** Text-link form (Account). */
  label?: string;
  href: string;
  active?: boolean;
  /** Button form (New Event) — rendered instead of the text label. */
  button?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [pinned, setPinned] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setPinned(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPinned(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pinned]);

  return (
    <div ref={box} className="group relative">
      <span className="inline-flex items-center gap-1">
        <Link href={href} className={button ? "" : active ? LINK_ON : LINK}>
          {button ?? label}
        </Link>
        <button
          type="button"
          onClick={() => setPinned((v) => !v)}
          aria-expanded={pinned}
          aria-haspopup="menu"
          aria-label={`${label ?? "New Event"} menu`}
          className="p-0.5 text-[9px] leading-none text-stone-300 transition-colors duration-200 hover:text-stone-600"
        >
          <span
            aria-hidden="true"
            className={`inline-block transition-transform duration-200 ${pinned ? "rotate-180" : ""}`}
          >
            ▾
          </span>
        </button>
      </span>

      {/*
        Rendered always, revealed by hover OR by the pinned state. `invisible`
        rather than unmounted so the hover transition has something to animate,
        and `pointer-events-none` so a hidden menu can never swallow a click
        aimed at the page behind it.
      */}
      {/*
        The gap is PADDING on the wrapper, not a margin on the panel.
        A margin would put 8px of dead space between the button and the menu:
        the pointer leaves the group crossing it, hover ends, and the menu shuts
        before you reach it. Padding keeps the hover area continuous while the
        visible panel still sits clear of the button.
      */}
      <div
        className={`absolute right-0 top-full z-50 pt-2 transition-opacity duration-150
          ${pinned
            ? "visible opacity-100"
            : "invisible opacity-0 pointer-events-none group-hover:visible group-hover:opacity-100 group-hover:pointer-events-auto"}`}
      >
        <div
          role="menu"
          className="min-w-[160px] rounded-md border border-stone-200 bg-white py-1 shadow-lg"
          onClick={() => setPinned(false)}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function Item({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      role="menuitem"
      className="block px-3 py-2 text-[13px] text-stone-600 transition-colors duration-150 hover:bg-stone-50 hover:text-stone-900"
    >
      {children}
    </Link>
  );
}

export function AppNav({ isAdmin, hasIntel, current }: AppNavProps) {
  const cls = (k: AppNavProps["current"]) => (current === k ? LINK_ON : LINK);

  /**
   * When the caller could not tell us (a client page), ask.
   *
   * One cheap request, and only when the answer is unknown — a server page
   * that already passed the flag never fires it. The alternative was defaulting
   * to false, which is what made Ops disappear from six pages.
   */
  const [asked, setAsked] = useState<{ isAdmin: boolean; hasIntel: boolean } | null>(null);
  useEffect(() => {
    // Ask only when SOMETHING is unknown — a server page that passed both flags
    // never fires it, and one request answers both.
    if (isAdmin !== undefined && hasIntel !== undefined) return;
    let live = true;
    fetch("/api/ops/whoami")
      .then((r) => (r.ok ? r.json() : { isAdmin: false, hasIntel: false }))
      .then((j) => {
        if (live) setAsked({ isAdmin: !!j.isAdmin, hasIntel: !!j.hasIntel });
      })
      .catch(() => {
        if (live) setAsked({ isAdmin: false, hasIntel: false });
      });
    return () => { live = false; };
  }, [isAdmin, hasIntel]);
  const showOps = isAdmin ?? asked?.isAdmin ?? false;
  const showIntel = hasIntel ?? asked?.hasIntel ?? false;
  return (
    <>
      <Link href="/" className={cls("archive")}>Archive</Link>
      <Link href="/search" className={cls("search")}>Search</Link>
      <Link href="/people" className={cls("people")}>People</Link>

      {/*
        New Event is a BUTTON, as it was before the nav was unified.
        Mason: "it's a dumb text link... now it just feels like a menu title."
        Right — it is the primary action on every screen, and flattening it into
        the same editorial link as Search and People stripped the one visual cue
        that said so. Back to the emerald BrandButton it always was, celebrate
        and all; the chevron beside it opens Import.
      */}
      <SplitMenu href="/events/new" button={<BrandButton color="emerald" celebrate size="sm">New Event</BrandButton>}>
        <Item href="/events/import">Import from SPS</Item>
      </SplitMenu>

      {showOps && <Link href="/ops" className={cls("ops")}>Ops</Link>}

      <SplitMenu
        label="Account"
        href="/account"
        active={current === "account" || current === "intel"}
      >
        {showIntel && <Item href="/intel">Intel</Item>}
        {showIntel && <Item href="/intel/notes/new">Add BTS photos</Item>}
        <Item href="/settings/connections">Connections</Item>
        <div className="my-1 h-px bg-stone-100" />
        <div className="px-3 py-1.5">
          <SignOutButton />
        </div>
      </SplitMenu>
    </>
  );
}
