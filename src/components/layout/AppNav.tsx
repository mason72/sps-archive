"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SignOutButton } from "@/components/auth/SignOutButton";

/**
 * The signed-in navigation, in ONE place.
 *
 * Every page used to hand-roll its own list of links — fourteen copies of the
 * same four `<Link>`s. They had already drifted (some carried People, some
 * didn't), and adding a destination meant editing fourteen files, which is
 * exactly why /intel shipped with no way to reach it.
 *
 * Structure is Mason's (2026-08-14):
 *
 *   Search · People · New Event ▾ (Import) · Ops* · Account ▾ (Intel, Sign out)
 *
 *   *Ops is admin-only and rendered ONLY when the server says so. It is not a
 *   security boundary — /ops checks `assertAdminPage()` on every page — but a
 *   link to a place you cannot go is a worse experience than no link.
 */

export interface AppNavProps {
  /** From the server. Controls whether Ops is offered, never whether it is allowed. */
  isAdmin?: boolean;
  /** Highlights the current section. */
  current?: "archive" | "search" | "people" | "intel" | "account" | "ops";
}

const LINK =
  "editorial-link text-stone-400 transition-colors duration-300 hover:text-stone-700";
const LINK_ON = "editorial-link text-stone-800";

/**
 * A menu that opens on CLICK, not hover.
 *
 * Hover menus are unusable on touch and hostile with a keyboard. Click-to-open
 * with Escape-to-close and an outside-click handler works everywhere, which is
 * the same rule the rest of the app follows about hover never being the only
 * path to something.
 */
function Menu({
  label,
  active,
  children,
}: {
  label: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`${active ? LINK_ON : LINK} inline-flex items-center gap-1`}
      >
        {label}
        <span
          aria-hidden="true"
          className={`text-[9px] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 min-w-[150px] rounded-md border border-stone-200 bg-white py-1 shadow-lg"
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
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

export function AppNav({ isAdmin = false, current }: AppNavProps) {
  const cls = (k: AppNavProps["current"]) => (current === k ? LINK_ON : LINK);
  return (
    <>
      <Link href="/" className={cls("archive")}>Archive</Link>
      <Link href="/search" className={cls("search")}>Search</Link>
      <Link href="/people" className={cls("people")}>People</Link>

      <Menu label="New Event">
        <Item href="/events/new">Blank event</Item>
        <Item href="/events/import">Import from SPS</Item>
      </Menu>

      {isAdmin && <Link href="/ops" className={cls("ops")}>Ops</Link>}

      <Menu label="Account" active={current === "account" || current === "intel"}>
        <Item href="/account">Account</Item>
        <Item href="/intel">Intel</Item>
        <Item href="/settings/connections">Connections</Item>
        <div className="my-1 h-px bg-stone-100" />
        <div className="px-3 py-1.5">
          <SignOutButton />
        </div>
      </Menu>
    </>
  );
}
