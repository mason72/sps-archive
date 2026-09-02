"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, RotateCcw, Users } from "lucide-react";
import { useIntelAccess } from "@/lib/event-intel/use-intel-access";

/**
 * "That's crew" on an import-review tile — keep the face, still skip the frame.
 *
 * Mason's decision (2026-08-15), choosing between this and importing setup
 * frames into a hidden section: the review grid is the ONLY moment those
 * frames are on screen before being discarded, and the archive stays curated.
 * Tagging saves a face reference (the server fetches the full-size frame and
 * runs detection) and the caller unchecks the tile, because keeping the face
 * IS the reason the frame can go.
 *
 * Picking a name is the whole interaction (2026-09-02). The popover used to
 * stay open on "Finding the face…" until the server answered, which is 0.6s
 * on a warm detector and 23–44s on a cold one — Mason tagged three crew this
 * morning and watched three panels sit there. Now the pick closes the panel,
 * the tile unchecks at once, and the tile itself carries the receipt:
 * saving → "Moved to crew photos · Joey" → or a Retry on failure, which also
 * re-checks the tile (no face saved means the frame has no reason to go).
 * Nothing on screen waits on the detector, and several tags run at once.
 *
 * Renders nothing without Event Intel — the roster is crew data, and the
 * import screen itself is open to every account.
 *
 * The roster is fetched ONCE per page at module level: a 6,000-frame review
 * grid must not make 6,000 roster requests because each tile carries this
 * button.
 */

interface RosterRow {
  id: string;
  display_name: string;
  is_regular: boolean;
}

let rosterCache: RosterRow[] | null = null;
let rosterInFlight: Promise<RosterRow[]> | null = null;

function fetchRoster(): Promise<RosterRow[]> {
  if (rosterCache) return Promise.resolve(rosterCache);
  if (!rosterInFlight) {
    rosterInFlight = fetch("/api/crew")
      .then((r) => (r.ok ? r.json() : { crew: [] }))
      .then((j) => {
        rosterCache = j.crew ?? [];
        return rosterCache!;
      })
      .catch(() => {
        rosterInFlight = null;
        return [];
      });
  }
  return rosterInFlight;
}

type Phase =
  | { kind: "idle" }
  | { kind: "saving"; crew: RosterRow }
  | { kind: "saved"; crew: RosterRow }
  | { kind: "failed"; crew: RosterRow; error: string };

/** First name is enough on a 200px tile; the full name is in the title. */
function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] || displayName;
}

export function CrewFaceTag({
  imageUrl,
  onTagStart,
  onTagged,
  onTagFailed,
}: {
  /** The frame's FULL-SIZE source — a thumbnail makes a bad reference. */
  imageUrl: string;
  /** A name was picked: the caller unchecks the tile now, before the save. */
  onTagStart: (crewName: string) => void;
  /** The face is saved. */
  onTagged: (crewName: string) => void;
  /** The save failed: the caller puts the frame back into the import. */
  onTagFailed: (crewName: string) => void;
}) {
  const hasIntel = useIntelAccess();
  const [open, setOpen] = useState(false);
  const [roster, setRoster] = useState<RosterRow[] | null>(rosterCache);
  const [q, setQ] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  /**
   * Where the panel goes, in VIEWPORT coordinates.
   *
   * The panel is a portal with `position: fixed`, not a child of the tile —
   * the tile is `overflow-hidden` (it has to be, for the image crop), so a
   * child popover gets cropped to the square and, in Mason's words, "I can't
   * really use it at all". A portal escapes the clipping AND the stacking
   * context a dimmed (opacity-30) tile creates. Measured from the button when
   * it opens; clamped to the viewport; flipped above the button when the
   * bottom of the screen is too close.
   */
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const place = () => {
    const r = buttonRef.current?.getBoundingClientRect();
    if (!r) return;
    const PANEL_W = 208;
    const left = Math.max(8, Math.min(r.right - PANEL_W, window.innerWidth - PANEL_W - 8));
    if (window.innerHeight - r.bottom < 320) {
      setPos({ left, bottom: window.innerHeight - r.top + 4 });
    } else {
      setPos({ left, top: r.bottom + 4 });
    }
  };

  useEffect(() => {
    if (!open) return;
    if (roster === null) fetchRoster().then(setRoster);
    // Focus after the portal paints.
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    // A fixed panel does not travel with the page — close rather than drift.
    // Capture-phase, so scrolls inside any container count too.
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    window.addEventListener("resize", close);
    return () => {
      clearTimeout(t);
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
    };
  }, [open, roster]);

  if (hasIntel !== true) return null;

  const save = async (c: RosterRow) => {
    setOpen(false);
    setQ("");
    setPhase({ kind: "saving", crew: c });
    onTagStart(c.display_name);
    try {
      const res = await fetch(`/api/crew/${c.id}/faces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPhase({ kind: "failed", crew: c, error: j.error ?? "Couldn't save the face." });
        onTagFailed(c.display_name);
        return;
      }
      setPhase({ kind: "saved", crew: c });
      onTagged(c.display_name);
    } catch {
      setPhase({ kind: "failed", crew: c, error: "Couldn't save the face." });
      onTagFailed(c.display_name);
    }
  };

  const visible = (roster ?? []).filter(
    (c) => !q.trim() || c.display_name.toLowerCase().includes(q.trim().toLowerCase())
  );

  // Once a save is in flight or done, the frame is spoken for; the button
  // would only offer to tag it twice. It comes back on failure, beside Retry.
  const offerButton = phase.kind === "idle" || phase.kind === "failed";

  return (
    <>
      {offerButton && (
        <button
          ref={buttonRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (!open) place();
            setOpen((v) => !v);
          }}
          title="That's crew — save their face, still skip the frame"
          className={`absolute right-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-full transition-all ${
            open
              ? "bg-stone-900 text-white"
              : "bg-white/85 text-stone-500 opacity-0 shadow-sm backdrop-blur-sm hover:text-stone-900 group-hover:opacity-100 focus-visible:opacity-100"
          }`}
        >
          <Users size={14} />
        </button>
      )}

      {phase.kind !== "idle" && (
        <div
          onClick={(e) => e.stopPropagation()}
          title={
            phase.kind === "failed"
              ? phase.error
              : phase.kind === "saved"
                ? `${phase.crew.display_name}: face saved to their crew references. The frame stays out of the import.`
                : `${phase.crew.display_name}: saving their face…`
          }
          className={`absolute inset-x-1.5 bottom-1.5 z-10 flex items-center gap-1.5 px-2 py-1.5 text-[11px] leading-none shadow-sm ${
            phase.kind === "failed"
              ? "border border-amber-200 bg-amber-50 text-amber-800"
              : "bg-white/92 text-stone-800 backdrop-blur-sm"
          }`}
        >
          {phase.kind === "saving" && (
            <>
              <Loader2 size={11} className="shrink-0 animate-spin text-stone-400" />
              <span className="truncate">Saving {firstName(phase.crew.display_name)}&apos;s face…</span>
            </>
          )}
          {phase.kind === "saved" && (
            <>
              <Check size={11} className="shrink-0 text-accent" />
              <span className="truncate">Moved to crew photos · {phase.crew.display_name}</span>
            </>
          )}
          {phase.kind === "failed" && (
            <>
              <span className="truncate">Couldn&apos;t save {firstName(phase.crew.display_name)}</span>
              <button
                type="button"
                onClick={() => save(phase.crew)}
                className="ml-auto inline-flex shrink-0 items-center gap-1 font-medium transition-colors hover:text-amber-950"
              >
                <RotateCcw size={10} />
                Retry
              </button>
            </>
          )}
        </div>
      )}

      {open && pos && createPortal(
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom }}
          className="z-50 w-52 border border-stone-200 bg-white text-left shadow-[0_8px_24px_-12px_rgba(12,10,9,0.28)]"
        >
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "Enter" && visible.length === 1) {
                e.preventDefault();
                save(visible[0]);
              }
            }}
            placeholder="Whose face is this?"
            className="w-full border-b border-stone-100 px-3 py-2 text-[13px] text-stone-800 placeholder:text-stone-300 focus:outline-none"
          />
          <div className="max-h-48 overflow-y-auto">
            {roster === null ? (
              <p className="px-3 py-2 text-[12px] text-stone-400">Loading…</p>
            ) : visible.length === 0 ? (
              <p className="px-3 py-2 text-[12px] text-stone-400">Nobody matches.</p>
            ) : (
              visible.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => save(c)}
                  className="block w-full px-3 py-1.5 text-left text-[13px] text-stone-700 transition-colors hover:bg-stone-50 hover:text-stone-900"
                >
                  {c.is_regular && <span className="mr-1 text-accent">★</span>}
                  {c.display_name}
                </button>
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
