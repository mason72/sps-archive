"use client";

import { useEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
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

export function CrewFaceTag({
  imageUrl,
  onTagged,
}: {
  /** The frame's FULL-SIZE source — a thumbnail makes a bad reference. */
  imageUrl: string;
  /** Fired on success with the person's name; the caller unchecks the tile. */
  onTagged: (crewName: string) => void;
}) {
  const hasIntel = useIntelAccess();
  const [open, setOpen] = useState(false);
  const [roster, setRoster] = useState<RosterRow[] | null>(rosterCache);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (roster === null) fetchRoster().then(setRoster);
    // Focus after the popover paints.
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open, roster]);

  if (hasIntel !== true) return null;

  const pick = async (c: RosterRow) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/crew/${c.id}/faces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? "Couldn't save the face.");
        return;
      }
      setOpen(false);
      setQ("");
      onTagged(c.display_name);
    } catch {
      setError("Couldn't save the face.");
    } finally {
      setBusy(false);
    }
  };

  const visible = (roster ?? []).filter(
    (c) => !q.trim() || c.display_name.toLowerCase().includes(q.trim().toLowerCase())
  );

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
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

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-1.5 top-10 z-20 w-52 border border-stone-200 bg-white text-left shadow-[0_8px_24px_-12px_rgba(12,10,9,0.28)]"
        >
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "Enter" && visible.length === 1) {
                e.preventDefault();
                pick(visible[0]);
              }
            }}
            placeholder="Whose face is this?"
            className="w-full border-b border-stone-100 px-3 py-2 text-[13px] text-stone-800 placeholder:text-stone-300 focus:outline-none"
          />
          <div className="max-h-48 overflow-y-auto">
            {busy ? (
              <p className="px-3 py-2 text-[12px] text-stone-400">Finding the face…</p>
            ) : roster === null ? (
              <p className="px-3 py-2 text-[12px] text-stone-400">Loading…</p>
            ) : visible.length === 0 ? (
              <p className="px-3 py-2 text-[12px] text-stone-400">Nobody matches.</p>
            ) : (
              visible.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={busy}
                  onClick={() => pick(c)}
                  className="block w-full px-3 py-1.5 text-left text-[13px] text-stone-700 transition-colors hover:bg-stone-50 hover:text-stone-900"
                >
                  {c.is_regular && <span className="mr-1 text-accent">★</span>}
                  {c.display_name}
                </button>
              ))
            )}
          </div>
          {error && <p className="border-t border-stone-100 px-3 py-2 text-[12px] text-amber-700">{error}</p>}
        </div>
      )}
    </>
  );
}
