"use client";

import { useEffect, useRef, useState } from "react";
import { VenuePicker } from "./VenuePicker";
import { ClientPicker } from "./ClientPicker";
import type { ComboValue } from "./Combobox";

/**
 * "Where does this land" — venue, client, and which gig.
 *
 * ONE block shared by the single-subject composer (event tab, venue/client
 * panels) and every group on the bulk screen, so the suggestion rules live
 * once: GPS offers the nearest known venue and biases Maps; the photos' date
 * proposes the gig only when EXACTLY one event sits within a day of it; picking
 * a gig fills in the venue and client the gig already knows, where nothing was
 * chosen yet. All of it is a pre-filled picker, never a silent write.
 */

export interface Gig { id: string; name: string; date: string | null }

export interface Subject {
  venue: ComboValue | null;
  client: ComboValue | null;
  gig: Gig | null;
}

export const FIELD =
  "w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-[14px] text-stone-900 placeholder:text-stone-300 focus:border-stone-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/25";

/** A gig knows its venue and its payer; fill whatever the subject lacks. */
export async function completeFromGig(s: Subject): Promise<Subject> {
  if (!s.gig || (s.venue && s.client)) return s;
  try {
    const r = await fetch(`/api/events/${s.gig.id}/intel`);
    if (!r.ok) return s;
    const j = await r.json();
    const payer = (j.orgs ?? []).find((o: { role: string }) => o.role === "payer") ?? (j.orgs ?? [])[0];
    return {
      ...s,
      venue: s.venue ?? (j.venue ? { id: j.venue.id, name: j.venue.name, city: j.venue.city ?? null, region: j.venue.region ?? null } : null),
      client: s.client ?? (payer ? { id: payer.orgId, name: payer.name } : null),
    };
  } catch { return s; }
}

export function SubjectFields({
  value,
  onChange,
  eventId,
  near,
  takenOn,
  lockVenue,
  lockClient,
}: {
  value: Subject;
  onChange: (s: Subject) => void;
  /** The host already knows the gig — no gig picker. */
  eventId?: string;
  near?: { lat: number; lng: number } | null;
  /** ISO date the photos were taken (median), for the gig suggestion. */
  takenOn?: string | null;
  lockVenue?: boolean;
  lockClient?: boolean;
}) {
  const [gigs, setGigs] = useState<Gig[]>([]);
  const [gigHint, setGigHint] = useState<string | null>(null);
  const proposed = useRef(false);
  const { venue, client, gig } = value;
  // The fetch callback below must merge into the LATEST value, not the one it
  // closed over — a venue picked mid-flight would otherwise be reverted.
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (eventId) return;
    const sp = new URLSearchParams();
    if (venue) sp.set("venueId", venue.id);
    if (client) sp.set("orgId", client.id);
    if (takenOn) sp.set("on", takenOn);
    if (![...sp.keys()].length) { setGigs([]); return; }
    let alive = true;
    fetch(`/api/intel/gigs?${sp}`).then((r) => r.json()).then((j) => {
      if (!alive) return;
      const list = (j.gigs ?? []) as Gig[];
      setGigs(list);
      if (takenOn && !gig && !proposed.current && list.length === 1) {
        proposed.current = true;
        setGigHint("from the photos’ date");
        // The same fill a hand-picked gig gets: its venue and payer, where
        // nothing was chosen yet. A proposal that stops at the gig leaves the
        // client blank on a row whose gig already knows it.
        void completeFromGig({ ...latest.current, gig: list[0] }).then((next) => { if (alive) onChange(next); });
      }
    }).catch(() => { if (alive) setGigs([]); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue?.id, client?.id, takenOn, eventId]);

  const pickGig = async (g: Gig | null) => {
    setGigHint(null);
    if (!g) { onChange({ ...value, gig: null }); return; }
    onChange(await completeFromGig({ ...value, gig: g }));
  };

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-stone-400">Venue</span>
          <VenuePicker value={venue} onChange={(v) => onChange({ ...value, venue: v })} near={near} disabled={lockVenue} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-stone-400">Client</span>
          <ClientPicker value={client} onChange={(c) => onChange({ ...value, client: c })} disabled={lockClient} />
        </label>
      </div>
      {!eventId && (
        <label className="mt-3 block">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-stone-400">
            Which gig <span className="normal-case tracking-normal text-stone-300">— optional</span>
            {gigHint && <span className="ml-2 normal-case tracking-normal text-emerald-700">{gigHint}</span>}
          </span>
          <select
            value={gig?.id ?? ""}
            onChange={(e) => void pickGig(gigs.find((g) => g.id === e.target.value) ?? null)}
            className={`${FIELD} min-h-[40px]`}
          >
            <option value="">
              {gigs.length ? "No particular gig" : venue || client || takenOn ? "No gigs found here yet" : "Pick a venue or client first"}
            </option>
            {gig && !gigs.some((g) => g.id === gig.id) && (
              <option value={gig.id}>{gig.name}{gig.date ? ` · ${gig.date}` : ""}</option>
            )}
            {gigs.map((g) => (
              <option key={g.id} value={g.id}>{g.name}{g.date ? ` · ${g.date}` : ""}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
