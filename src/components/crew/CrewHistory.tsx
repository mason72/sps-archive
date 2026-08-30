"use client";

import { useEffect, useState } from "react";
import { REHIRE_LABEL, type Rehire } from "@/lib/event-intel/roles";

/**
 * What has been claimed about this person, and by whom.
 *
 * Built 2026-08-29, after Joey Nagoshiner — a founder of the company and the
 * most-booked name on the roster — turned up in Non-regulars rated
 * `last_resort`, and the database could not say who had done it or what the
 * value had been before. `crew.rehire` carried a verdict with no author and no
 * history; all `updated_at` could report was that the row had changed.
 *
 * The point of the panel is that Mason answers that himself now, rather than
 * asking someone to go read a table. Everything here comes from
 * `crew_change_log` (migration 073), written by trigger so it covers every
 * writer — including the ones nobody has written yet, and including scripts.
 */

interface Entry {
  seq: number;
  field: string;
  label: string;
  oldValue: string | null;
  newValue: string | null;
  actor: string | null;
  source: string | null;
  changedAt: string;
  event: { id: string; name: string | null; date: string | null } | null;
}

/**
 * Column values are stored as text by the trigger, so `true` arrives as the
 * string "true". Rendered in the words the roster itself uses — and the rehire
 * ladder borrows `REHIRE_LABEL` rather than respelling four keys that already
 * have one home in `roles.ts`.
 */
function display(field: string, raw: string | null): string {
  if (raw === null) return "—";
  if (field === "is_regular") return raw === "true" ? "Regular" : "Not a regular";
  if (field === "archived") return raw === "true" ? "Alumni" : "Active";
  if (field === "rehire" || field === "would_rebook") {
    return REHIRE_LABEL[raw as Rehire] ?? raw;
  }
  return raw.length > 90 ? `${raw.slice(0, 90)}…` : raw;
}

/**
 * The ladder keeps its severity ramp here, exactly as it does on the crew card.
 * Emerald is deliberately absent: in this design system the accent means STATE
 * (the active tab, the selection rail), and a historical record is not a state
 * you are in. Severity is stone → amber → red, never stoplight primaries.
 */
function toneFor(field: string, raw: string | null): string {
  if (field !== "rehire" && field !== "would_rebook") return "text-stone-700";
  if (raw === "never") return "text-red-700";
  if (raw === "last_resort") return "text-amber-700";
  return "text-stone-700";
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export function CrewHistory({ crewId }: { crewId: string }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`/api/crew/${crewId}/history`);
        if (!res.ok) throw new Error((await res.json()).error ?? "Could not load the history");
        const json = await res.json();
        if (live) setEntries(json.history as Entry[]);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "Could not load the history");
      }
    })();
    return () => { live = false; };
  }, [crewId]);

  if (error) return <p className="mt-3 text-[12px] text-red-700">{error}</p>;
  if (!entries) return <p className="mt-3 text-[12px] text-stone-400">Loading…</p>;

  /**
   * An empty history is the normal state for the 87 people who predate this
   * table, and saying so beats an empty box — the same reason the Intel panel
   * explains its zero-of-42 roles dimension instead of hiding it.
   */
  if (entries.length === 0) {
    return (
      <p className="mt-3 text-[12px] leading-relaxed text-stone-400">
        Nothing recorded yet. History starts from 29 Aug 2026 — changes made
        before then were not kept.
      </p>
    );
  }

  return (
    <ol className="mt-3 border-t border-stone-100">
      {entries.map((e) => (
        <li key={e.seq} className="border-b border-stone-100 py-2.5">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-[10px] uppercase tracking-[0.14em] text-stone-400">
              {e.label}
            </span>
            {e.field === "created" ? (
              <span className="text-[13px] text-stone-700">{e.newValue}</span>
            ) : (
              <span className="text-[13px]">
                <span className="text-stone-400">{display(e.field, e.oldValue)}</span>
                <span className="mx-1.5 text-stone-300">→</span>
                <span className={toneFor(e.field, e.newValue)}>
                  {display(e.field, e.newValue)}
                </span>
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-stone-400">
            {/* An unsigned write is named as such. A blank would read as
                "nobody knows"; the truth is "not done through a screen". */}
            {e.actor ?? <span className="italic">unattributed</span>}
            {e.source && ` · ${e.source}`}
            {e.event && ` · ${e.event.name ?? "an event"}`}
            {` · ${when(e.changedAt)}`}
          </p>
        </li>
      ))}
    </ol>
  );
}
