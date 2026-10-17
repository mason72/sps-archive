"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, RotateCcw, Users } from "lucide-react";
import { useIntelAccess } from "@/lib/event-intel/use-intel-access";
import { crew as crewRegistry, type KnownCrew } from "@/components/intel/registry-cache";
import { TOUCH_QUERY, useMediaQuery } from "@/hooks/useMediaQuery";

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
 * The roster comes from the page-wide registry (`registry-cache.ts`), loaded
 * on the first open rather than on mount: a 6,000-frame review grid must not
 * make 6,000 roster requests because each tile carries this button, and an
 * account without Intel must not make one at all.
 */

type RosterRow = KnownCrew;

/**
 * The people you tagged lately, newest first, on this device. Mason, 2026-10-17:
 * a gig has six to ten crew frames and they are mostly the same few people, so
 * typing "Jake" six times was the whole cost of tagging. Read when a panel
 * opens, so a pick on one tile is at the top of the next.
 */
const RECENT_KEY = "pt:crew-recent";
const RECENT_MAX = 6;
function readRecent(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}
function pushRecent(id: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter((x) => x !== id)].slice(0, RECENT_MAX)));
  } catch {
    // Private mode or a full quota: the shortcut is a convenience, never a blocker.
  }
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
  jobCrewIds,
  onTagStart,
  onTagged,
  onTagFailed,
}: {
  /** The frame's FULL-SIZE source — a thumbnail makes a bad reference. */
  imageUrl: string;
  /**
   * Roster ids of the crew on this job's calendar entry ("Which job was
   * this?"). They lead the panel as one-tap rows: the frames being tagged
   * are almost always of the people who worked it.
   */
  jobCrewIds?: string[];
  /** A name was picked: the caller unchecks the tile now, before the save. */
  onTagStart: (crewName: string) => void;
  /** The face is saved. */
  onTagged: (crewName: string) => void;
  /** The save failed: the caller puts the frame back into the import. */
  onTagFailed: (crewName: string) => void;
}) {
  const hasIntel = useIntelAccess();
  const [open, setOpen] = useState(false);
  const [roster, setRoster] = useState<RosterRow[] | null>(crewRegistry.get());
  const [q, setQ] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const isTouch = useMediaQuery(TOUCH_QUERY);

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
    const PANEL_W = 240;
    const left = Math.max(8, Math.min(r.right - PANEL_W, window.innerWidth - PANEL_W - 8));
    // The panel is ~330px tall (288px list, input, borders); flip above the
    // button when less than that, plus a margin, is left below it.
    if (window.innerHeight - r.bottom < 345) {
      setPos({ left, bottom: window.innerHeight - r.top + 4 });
    } else {
      setPos({ left, top: r.bottom + 4 });
    }
  };

  useEffect(() => {
    if (!open) return;
    if (roster === null) void crewRegistry.load().then(setRoster);
    setRecent(readRecent());
    // Focus after the portal paints. Not on touch: the keyboard would come up
    // over the one-tap rows, which are the faster way in there.
    const t = isTouch ? undefined : setTimeout(() => inputRef.current?.focus(), 0);
    // A fixed panel does not travel with the page — close rather than drift.
    // Capture-phase, so scrolls inside any container count too, except the
    // panel's own list (scrolling it used to close it).
    const close = (e?: Event) => {
      // Only a SCROLL can come from inside the panel. A resize's target is
      // `window`, which is not a Node: `contains()` would throw on it.
      if (e?.type === "scroll" && e.target instanceof Node && panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", close, { capture: true, passive: true });
    window.addEventListener("resize", close);
    return () => {
      clearTimeout(t);
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
    };
  }, [open, roster, isTouch]);

  if (hasIntel !== true) return null;

  const save = async (c: RosterRow) => {
    pushRecent(c.id);
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

  const query = q.trim().toLowerCase();
  const visible = (roster ?? []).filter(
    (c) => !query || c.display_name.toLowerCase().includes(query)
  );
  // Enter on a single match still saves (search); `visible` counts it.

  // Only while open: every review tile carries this component, and a closed
  // panel has nothing to order.
  const { onJob, recentOff, rest } = open
    ? orderCrew(roster ?? [], jobCrewIds ?? [], recent, query)
    : NO_ORDER;
  const shortcutCount = onJob.length + recentOff.length;

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
          // Hover-revealed on desktop and inert while hidden; always shown on
          // touch, where there is no hover, at a 40px target.
          className={`absolute right-1.5 top-1.5 z-10 flex h-7 w-7 pointer-coarse:h-10 pointer-coarse:w-10 items-center justify-center rounded-full transition-all ${
            open
              ? "bg-stone-900 text-white"
              : "bg-white/85 text-stone-500 opacity-0 pointer-events-none shadow-sm backdrop-blur-sm hover:text-stone-900 group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto pointer-coarse:opacity-100 pointer-coarse:pointer-events-auto"
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
          className={`absolute inset-x-1.5 bottom-1.5 z-10 flex items-start gap-1.5 px-2 py-1.5 text-[11px] leading-[1.25] shadow-sm ${
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
              <Check size={11} className="mt-px shrink-0 text-accent" />
              {/* Wraps rather than truncates: on a 200px tile "Moved to crew
                  photos · Joey Nagoshiner" lost the name, which is the part
                  that tells three tags apart (seen live, 2026-09-02). */}
              <span>Moved to crew photos · {phase.crew.display_name}</span>
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
          ref={panelRef}
          onClick={(e) => e.stopPropagation()}
          style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom }}
          className="z-50 w-60 border border-stone-200 bg-white text-left shadow-[0_8px_24px_-12px_rgba(12,10,9,0.28)]"
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
          <div className="max-h-72 overflow-y-auto overscroll-contain">
            {roster === null ? (
              <p className="px-3 py-2 text-[12px] text-stone-400">Loading…</p>
            ) : visible.length === 0 ? (
              <p className="px-3 py-2 text-[12px] text-stone-400">Nobody matches.</p>
            ) : (
              <>
                {onJob.length > 0 && <CrewGroup label="On this job" people={onJob} onPick={save} quick />}
                {recentOff.length > 0 && <CrewGroup label="Recent" people={recentOff} onPick={save} quick />}
                <CrewGroup
                  label={shortcutCount > 0 ? "Everyone" : null}
                  people={rest}
                  onPick={save}
                />
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

const NO_ORDER = { onJob: [], recentOff: [], rest: [] } as { onJob: KnownCrew[]; recentOff: KnownCrew[]; rest: KnownCrew[] };

/**
 * The panel's order. With nothing typed: "On this job" (the latest pick
 * first), then people tagged lately who are not on the job, then everyone
 * else. Typing searches the whole roster and the shortcuts step aside. Ids
 * that are not in the roster (removed crew) are dropped, never shown blank.
 */
export function orderCrew<T extends { id: string; display_name: string }>(
  roster: T[],
  jobCrewIds: string[],
  recent: string[],
  query: string,
): { onJob: T[]; recentOff: T[]; rest: T[] } {
  const q = query.trim().toLowerCase();
  const visible = roster.filter((c) => !q || c.display_name.toLowerCase().includes(q));
  if (q) return { onJob: [], recentOff: [], rest: visible };
  const byId = new Map(roster.map((c) => [c.id, c]));
  const job = new Set(jobCrewIds);
  const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter((c): c is T => !!c);
  const onJob = pick([...recent.filter((id) => job.has(id)), ...[...job].filter((id) => !recent.includes(id))]);
  const recentOff = pick(recent.filter((id) => !job.has(id)));
  const shown = new Set([...onJob, ...recentOff].map((c) => c.id));
  return { onJob, recentOff, rest: visible.filter((c) => !shown.has(c.id)) };
}

/**
 * One labelled run of names. `quick` rows are the shortcut rows: taller (a
 * 44px target on touch) and set a size up, since they are meant to be tapped
 * without reading the rest of the list.
 */
function CrewGroup({
  label,
  people,
  onPick,
  quick,
}: {
  label: string | null;
  people: RosterRow[];
  onPick: (c: RosterRow) => void;
  quick?: boolean;
}) {
  if (people.length === 0) return null;
  return (
    <div className={quick ? "border-b border-stone-100 pb-1" : undefined}>
      {label && (
        <p className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.2em] text-stone-400">{label}</p>
      )}
      {people.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onPick(c)}
          className={`block w-full px-3 text-left transition-colors hover:bg-stone-50 hover:text-stone-900 active:bg-stone-100 ${
            quick
              ? "py-2 text-[14px] text-stone-900 pointer-coarse:min-h-11"
              : "py-1.5 text-[13px] text-stone-700 pointer-coarse:py-2.5"
          }`}
        >
          {c.is_regular && <span className="mr-1 text-accent">★</span>}
          {c.display_name}
        </button>
      ))}
    </div>
  );
}
