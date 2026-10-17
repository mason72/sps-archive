"use client";

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export interface OverflowItem {
  label: string;
  onClick?: () => void;
  /** Opens in a new tab, like the desktop links it stands in for. */
  href?: string;
  disabled?: boolean;
}

/**
 * "⋯" for actions that do not fit a phone's header row.
 *
 * Built for touch first: outside-close listens to `pointerdown`, because iOS
 * Safari neither focuses a tapped button (so onBlur never fires) nor sends
 * `mousedown` for a tap on a non-clickable area. The trigger is 44px.
 */
export function OverflowMenu({
  items,
  label = "More actions",
  className,
}: {
  items: OverflowItem[];
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const row =
    "block w-full px-4 py-3 text-left text-[15px] text-stone-700 transition-colors active:bg-stone-50 disabled:opacity-40";

  return (
    <div ref={box} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-11 w-11 items-center justify-center text-stone-500 transition-colors hover:text-stone-800"
      >
        <MoreHorizontal size={20} strokeWidth={1.5} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-md border border-stone-200 bg-white py-1 shadow-lg"
          style={{ animation: "editorial-fade 0.15s ease-out" }}
        >
          {items.map((it) =>
            it.href ? (
              <a
                key={it.label}
                href={it.href}
                target="_blank"
                rel="noopener noreferrer"
                role="menuitem"
                onClick={() => setOpen(false)}
                className={row}
              >
                {it.label}
              </a>
            ) : (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onClick={() => { setOpen(false); it.onClick?.(); }}
                className={row}
              >
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
