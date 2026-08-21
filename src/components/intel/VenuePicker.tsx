"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Combobox, type ComboOption, type ComboValue } from "./Combobox";
import { metresBetween } from "@/lib/intel-notes/client-image";
import { venues as venueRegistry, useRegistry, type KnownVenue } from "./registry-cache";

export type { KnownVenue } from "./registry-cache";

/**
 * Pick a venue: yours first, then Google Maps, then "create by name".
 *
 * A Maps pick becomes a real venue row on selection (POST /api/venues with the
 * place id and coordinates), so by the time the caller sees an id it is one
 * that can be linked to. The same building picked twice comes back as the
 * SAME row — the route answers the place-id collision with the existing id.
 *
 * `near` is the photo's GPS when the composer has one: a known venue within
 * 300 m is offered first and marked, and the Maps search is biased there.
 */
export function VenuePicker({
  value,
  onChange,
  near,
  autoFocus,
  disabled,
}: {
  value: ComboValue | null;
  onChange: (v: ComboValue | null) => void;
  near?: { lat: number; lng: number } | null;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  // Shared across every picker on the page (the bulk screen has one per photo).
  const known = useRegistry(venueRegistry);
  const [query, setQuery] = useState("");
  const [maps, setMaps] = useState<{ placeId: string; name: string; secondary: string }[]>([]);
  const [mapsOn, setMapsOn] = useState<boolean | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useRef<string>(crypto.randomUUID());

  // Maps, debounced, one session token per typing session.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setMaps([]); return; }
    let alive = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const sp = new URLSearchParams({ q, session: session.current });
        if (near) { sp.set("lat", String(near.lat)); sp.set("lng", String(near.lng)); }
        const res = await fetch(`/api/places/autocomplete?${sp}`);
        const j = await res.json();
        if (!alive) return;
        if (!res.ok) { setError(j.error ?? "Maps search failed"); setMaps([]); return; }
        setMapsOn(j.configured !== false);
        setMaps(j.suggestions ?? []);
        setError(null);
      } catch {
        if (alive) setMaps([]);
      } finally {
        if (alive) setSearching(false);
      }
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [query, near]);

  const nearby = useMemo(() => {
    if (!near || !known) return [];
    return known
      .filter((v) => v.lat != null && v.lng != null)
      .map((v) => ({ v, m: metresBetween(near, { lat: v.lat!, lng: v.lng! }) }))
      .filter((x) => x.m <= 300)
      .sort((a, b) => a.m - b.m)
      .map((x) => x.v);
  }, [near, known]);

  const options = useMemo<ComboOption[]>(() => {
    const q = query.trim().toLowerCase();
    const out: ComboOption[] = [];
    const seen = new Set<string>();
    for (const v of nearby) {
      seen.add(v.id);
      out.push({ key: `near:${v.id}`, label: v.name, sub: `${[v.address, v.city].filter(Boolean).join(", ")} · where this photo was taken`, group: "Near this photo" });
    }
    const mine = (known ?? []).filter((v) => !seen.has(v.id) && (!q || `${v.name} ${v.address ?? ""} ${v.city ?? ""}`.toLowerCase().includes(q)));
    for (const v of mine.slice(0, 8)) {
      out.push({ key: `mine:${v.id}`, label: v.name, sub: [v.address, v.city].filter(Boolean).join(", ") || undefined, group: "Your venues" });
    }
    for (const m of maps.slice(0, 6)) {
      out.push({ key: `maps:${m.placeId}`, label: m.name, sub: m.secondary, group: "Google Maps" });
    }
    if (q.length >= 2 && !mine.some((v) => v.name.toLowerCase() === q)) {
      out.push({ key: `new:${query.trim()}`, label: `Create “${query.trim()}”`, sub: "A venue with no map behind it — you can add the address later", group: "New" });
    }
    return out;
  }, [query, known, maps, nearby]);

  const pick = async (o: ComboOption) => {
    setError(null);
    const [kind, rest] = [o.key.slice(0, o.key.indexOf(":")), o.key.slice(o.key.indexOf(":") + 1)];
    if (kind === "mine" || kind === "near") {
      const v = known?.find((x) => x.id === rest);
      if (v) onChange({ id: v.id, name: v.name, sub: [v.address, v.city].filter(Boolean).join(", ") || undefined });
      return;
    }
    if (kind === "maps") {
      const d = await fetch(`/api/places/details?id=${encodeURIComponent(rest)}&session=${session.current}`);
      const dj = await d.json();
      if (!d.ok) { setError(dj.error ?? "Could not load that place"); return; }
      session.current = crypto.randomUUID();
      const p = dj.place as { placeId: string; name: string; address: string; city: string | null; region: string | null; country: string | null; lat: number | null; lng: number | null };
      const c = await fetch("/api/venues", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: p.name, address: p.address, city: p.city ?? "", region: p.region ?? "", country: p.country ?? "", placeId: p.placeId, lat: p.lat, lng: p.lng }),
      });
      const cj = await c.json();
      if (!c.ok) { setError(cj.error ?? "Could not add venue"); return; }
      const row: KnownVenue = { id: cj.id, name: cj.name ?? p.name, address: p.address, city: p.city, lat: p.lat, lng: p.lng, eventCount: 0 };
      venueRegistry.add(row);
      onChange({ id: row.id, name: row.name, sub: [p.address, p.city].filter(Boolean).join(", ") || undefined });
      return;
    }
    if (kind === "new") {
      const c = await fetch("/api/venues", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: rest }),
      });
      const cj = await c.json();
      if (!c.ok) { setError(cj.error ?? "Could not add venue"); return; }
      const row: KnownVenue = { id: cj.id, name: rest, address: null, city: null, lat: null, lng: null, eventCount: 0 };
      venueRegistry.add(row);
      onChange({ id: row.id, name: row.name });
    }
  };

  const hint = error
    ? error
    : mapsOn === false && query.trim().length >= 2
      ? "Google Maps search is off — add GOOGLE_PLACES_KEY to turn it on."
      : near && nearby.length === 0 && query.trim().length < 2
        ? "No known venue within 300 m of this photo — type to search Maps."
        : null;

  return (
    <Combobox
      value={value}
      placeholder={known === null ? "Loading venues…" : "Venue — yours, or search Google Maps"}
      query={query}
      onQuery={setQuery}
      options={options}
      onPick={pick}
      onClear={() => { onChange(null); setQuery(""); }}
      loading={searching && query.trim().length >= 2}
      hint={hint}
      disabled={disabled}
      autoFocus={autoFocus}
    />
  );
}
