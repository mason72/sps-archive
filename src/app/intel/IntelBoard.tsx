"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { RosterManager } from "./RosterManager";
import type {
  IntelIndex,
  IntelPerson,
  IntelVenue,
  IntelCity,
  IntelOrg,
} from "@/lib/event-intel/index-intel";
import type { RehireStanding } from "@/lib/event-intel/roles";
import { willTravel } from "@/lib/event-intel/roles";
import { formatLastHired } from "@/lib/event-intel/last-hired";
import { MonthPicker } from "@/components/ui/date-picker";
import {
  isMappable,
  mappableMetros,
  metroDistance,
  metroLabel,
} from "@/lib/event-intel/geo";
import { CrewAvatar, type CrewAvatarFace } from "@/components/crew/CrewAvatar";
import { CrewFacesSection } from "@/components/crew/CrewFacesSection";

/**
 * The pivot, as a UI.
 *
 * ONE selection model across four axes. Picking a person, a venue, a city or a
 * client all resolve to the same `{axis, id}` pair, which is why every panel can
 * link into every other panel without a special case — a person's venues are
 * clickable for the same reason a venue's crew are.
 *
 * Emerald is state ONLY: the active axis underline and the selected row's rail.
 * Rebook judgements use the severity ramp (red-700 / amber-700 / stone-600) and
 * never the accent, because a green "yes" beside an emerald selection makes the
 * accent mean two different things at once.
 */

type Axis = "people" | "venues" | "cities" | "clients" | "roster";

const AXES: { key: Axis; label: string }[] = [
  // "Crew" not "People": /people is the archive-wide index of everyone
  // PHOTOGRAPHED. These are the people who worked the gig. Two different
  // populations, and one word for both is how someone clicks the wrong tab.
  { key: "people", label: "Crew" },
  { key: "venues", label: "Venues" },
  { key: "cities", label: "Cities" },
  { key: "clients", label: "Clients" },
  // Not a pivot axis — the place the roster is EDITED. It sits here because
  // this is where someone already comes to look at people.
  { key: "roster", label: "Roster" },
];

/**
 * Written out rather than computed. Chopping the last letter off the axis name
 * gave "Pick a peopl", which is what the first screenshot said back.
 */
const SINGULAR: Record<Axis, string> = {
  people: "a crew member",
  venues: "a venue",
  cities: "a city",
  clients: "a client",
  roster: "someone",
};

const fmtDate = (d: string | null) =>
  d
    ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "undated";

/**
 * Which band a crew member falls in — one predicate, so the flat list and the
 * radius groups can never disagree about who "Non-regulars" means.
 *
 * Alumni is checked FIRST and is exclusive: an archived regular is alumni, not
 * a regular. Archiving is the statement that you stopped working with them,
 * and it outranks what they were while you did.
 */
function inCrewBand(
  p: { isRegular: boolean; archived: boolean },
  band: "all" | "regular" | "other" | "alumni"
): boolean {
  if (band === "alumni") return p.archived;
  if (p.archived) return false;
  if (band === "regular") return p.isRegular;
  if (band === "other") return !p.isRegular;
  return true;
}

/* ── Small shared pieces ──────────────────────────────────────────────────── */

function Rule() {
  return <div className="h-px bg-stone-200" />;
}

function Meta({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] uppercase tracking-[0.14em] text-stone-400">
      {children}
    </span>
  );
}

function Chip({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
}) {
  /**
   * TWO TIERS, and the difference is visible at rest.
   *
   * A chip that navigates and a chip that merely states a fact looked
   * identical, so the only clue that "The Alder Room" opens the venue was
   * hovering it — and hover is not a thing on a phone. Actionable chips are
   * bordered and darker; facts are a flat tint with no border and lighter text.
   * Nobody has to discover anything.
   */
  const shared = "inline-flex items-center rounded-full px-2.5 py-1 text-[12px]";
  if (!onClick) {
    return (
      <span className={`${shared} bg-stone-100 text-stone-500`} title={title}>
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`${shared} border border-stone-300 bg-white text-stone-800 transition-colors duration-200 hover:border-stone-800 hover:bg-stone-900 hover:text-white`}
    >
      {children}
    </button>
  );
}

/** Rehire signal. Severity ramp, never the brand accent. */
const REHIRE_DOT: Record<string, [string, string]> = {
  first_call: ["bg-stone-800", "first call"],
  solid: ["bg-stone-500", "solid"],
  last_resort: ["bg-amber-700", "last resort"],
  never: ["bg-red-700", "never again"],
};

function RebookDot({ value, count }: { value: string | null; count?: number }) {
  if (!value) return null;
  const hit = REHIRE_DOT[value];
  if (!hit) return null;
  return (
    <span className="inline-flex items-center gap-1.5" title={hit[1]}>
      <span className={`h-1.5 w-1.5 rounded-full ${hit[0]}`} />
      <span className="text-[12px] text-stone-500">
        {count != null && <span className="tabular-nums text-stone-700">{count} </span>}
        {hit[1]}
      </span>
    </span>
  );
}

/**
 * A person's standing: the most recent judgement, with the distribution on
 * hover.
 *
 * Mason asked for an "average rebook rating" and then agreed this is better:
 * "most recent rating and on hover show a distribution". An average over an
 * ordinal ladder gives "2.3", which names no action — and it buries one
 * disastrous gig under four fine ones, which is the single fact you most need.
 *
 * `fromBaseline` means nobody has rated a real gig and this is the standing
 * opinion someone seeded. Said out loud rather than shown as if it were earned.
 */
function StandingBadge({ s }: { s: RehireStanding }) {
  if (!s.headline) return null;
  const hit = REHIRE_DOT[s.headline];
  if (!hit) return null;
  const parts = (["first_call", "solid", "last_resort", "never"] as const)
    .filter((k) => s.tally[k] > 0)
    .map((k) => `${s.tally[k]} × ${REHIRE_DOT[k][1]}`);
  const title = s.fromBaseline
    ? "Seeded by hand — no rated gigs yet"
    : parts.length
      ? `Most recent: ${hit[1]}\nAcross ${s.total} rated ${s.total === 1 ? "gig" : "gigs"}: ${parts.join(", ")}`
      : hit[1];
  return (
    <span className="inline-flex items-center gap-1.5" title={title}>
      <span className={`h-1.5 w-1.5 rounded-full ${hit[0]}`} />
      <span className={`text-[12px] ${s.fromBaseline ? "italic text-stone-400" : "text-stone-500"}`}>
        {hit[1]}
        {s.total > 1 && <span className="ml-1 tabular-nums text-stone-400">·{s.total}</span>}
      </span>
      {/* A hard no is stated even when the latest gig went fine — the downside
          is the thing you are checking for, and it must not be averaged away. */}
      {s.hardNo && s.headline !== "never" && (
        <span className="text-[11px] text-red-700" title="A 'never again' exists in their history">
          !
        </span>
      )}
    </span>
  );
}

/**
 * An empty dimension is explained, never hidden.
 *
 * Roles and venue notes are both empty today. A panel that simply omits them
 * teaches nothing and leaves you wondering whether the feature exists; one that
 * says what is missing and how it gets filled is a to-do list.
 */
function Blank({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] leading-relaxed text-stone-400">{children}</p>;
}

function EventLine({
  id,
  name,
  date,
  coverUrl,
  coverFocal,
  trailing,
}: {
  id: string;
  name: string;
  date: string | null;
  /** The gallery's cover thumb — "for some color" (Mason). Resolved through
      enrichEvents upstream, so it can never disagree with the archive card. */
  coverUrl?: string | null;
  coverFocal?: { x: number; y: number } | null;
  trailing?: React.ReactNode;
}) {
  return (
    <li className="flex items-center justify-between gap-4 py-2">
      {coverUrl !== undefined && (
        <Link href={`/events/${id}`} className="shrink-0" tabIndex={-1}>
          <span className="block h-8 w-12 overflow-hidden rounded-[3px] bg-stone-100">
            {coverUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={coverUrl}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
                style={coverFocal ? { objectPosition: `${coverFocal.x}% ${coverFocal.y}%` } : undefined}
              />
            )}
          </span>
        </Link>
      )}
      <Link
        href={`/events/${id}`}
        className="text-[14px] text-stone-800 underline-offset-4 transition-colors duration-200 hover:text-stone-950 hover:underline"
      >
        {name}
      </Link>
      <span className="flex shrink-0 items-baseline gap-3">
        {trailing}
        <span className="text-[12px] tabular-nums text-stone-400">{fmtDate(date)}</span>
      </span>
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <Meta>{title}</Meta>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/* ── The board ────────────────────────────────────────────────────────────── */

export function IntelBoard({ index }: { index: IntelIndex }) {
  const [axis, setAxis] = useState<Axis>("people");
  const [selected, setSelected] = useState<Record<Axis, string | null>>({
    people: null,
    venues: null,
    cities: null,
    clients: null,
    roster: null,
  });
  const [query, setQuery] = useState("");

  /**
   * The radius search — Crew axis only.
   *
   * Mason: "choose a location and then have a slider/field for MILES FROM so I
   * can find anyone within 500 miles of any city I want." The distance control
   * is his own better framing from the same conversation: drivable / a short
   * flight / anywhere, because "how do I get them there" is the actual staffing
   * question a miles number only approximates.
   *
   * Survives an axis switch on purpose: mid-staffing-search you check a venue
   * and come back; wiping the search would mean retyping it. (`query` does
   * reset per axis — that one is scoped to the list under it.)
   */
  const [near, setNear] = useState("");
  const [reach, setReach] = useState<"drivable" | "short flight" | "any">("any");

  /**
   * Which cut of the roster the Crew axis shows — the same four bands the
   * Roster tab and the /people wall use, so one vocabulary answers "who am I
   * looking at" everywhere.
   *
   * It matters MORE here than on those surfaces: this axis silently mixed
   * alumni in with working crew, so a staffing search could surface someone
   * you stopped hiring in 2017 with nothing to say so. Alumni are their own
   * band now and every alumni row is badged wherever it appears.
   *
   * Search still spans EVERYONE regardless of band, same rule as the roster:
   * a typed name is a question about a person, not a browse of a cut.
   */
  const [crewBand, setCrewBand] = useState<"all" | "regular" | "other" | "alumni">("all");

  /**
   * One avatar per crew member, fetched ONCE for the whole board.
   *
   * A face beside every name is the point of crew faces — "wherever their
   * names show up" — and 61 circles must not be 61 requests. `avatarBump`
   * refetches after the panel changes a reference, so the list circle never
   * disagrees with the panel that just edited it.
   */
  const [avatars, setAvatars] = useState<Record<string, CrewAvatarFace | null>>({});
  const [avatarBump, setAvatarBump] = useState(0);
  useEffect(() => {
    if (!index.people.length) return;
    let live = true;
    const ids = index.people.map((p) => p.id).join(",");
    fetch(`/api/crew/avatars?ids=${ids}`)
      .then((r) => (r.ok ? r.json() : { avatars: {} }))
      .then((j) => { if (live) setAvatars(j.avatars ?? {}); })
      .catch(() => {});
    return () => { live = false; };
  }, [index.people, avatarBump]);

  const personById = useMemo(() => new Map(index.people.map((p) => [p.id, p])), [index.people]);
  const venueById = useMemo(() => new Map(index.venues.map((v) => [v.id, v])), [index.venues]);
  const cityByKey = useMemo(() => new Map(index.cities.map((c) => [c.key, c])), [index.cities]);
  const orgById = useMemo(() => new Map(index.orgs.map((o) => [o.id, o])), [index.orgs]);

  /** Cross-axis jump — the whole point of a pivot. */
  const jump = (to: Axis, id: string) => {
    setAxis(to);
    setSelected((s) => ({ ...s, [to]: id }));
    setQuery("");
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (...fields: (string | null | undefined)[]) =>
      !q || fields.some((f) => (f ?? "").toLowerCase().includes(q));

    if (axis === "people")
      return index.people
        .filter((p) => (q ? true : inCrewBand(p, crewBand)))
        .filter((p) => match(p.name, p.fullName, p.email, p.homeCity, p.kind))
        .map((p) => ({
          id: p.id,
          primary: p.name,
          // "alumni" rides the meta line because SEARCH SPANS EVERY BAND —
          // a found-by-name alumni row must not look like working crew.
          secondary: [
            p.homeCity,
            p.kind !== "other" ? p.kind : null,
            p.archived ? "alumni" : null,
          ]
            .filter(Boolean)
            .join(" · "),
          count: p.eventCount,
          // Mason: "show the 'regular' stars next to their name". Scanning for
          // your own team in a list of 61 is the common case; a badge you have
          // to open a panel to see does not help with that.
          star: p.isRegular,
        }));
    if (axis === "venues")
      return index.venues
        .filter((v) => match(v.name, v.city, v.address))
        .map((v) => ({
          id: v.id,
          primary: v.name,
          secondary: [v.city, v.region].filter(Boolean).join(", "),
          count: v.eventCount,
        }));
    if (axis === "cities")
      return index.cities
        .filter((c) => match(c.name, c.region))
        .map((c) => ({
          id: c.key,
          primary: c.name,
          secondary: c.localCrewIds.length ? `${c.localCrewIds.length} local crew` : "",
          count: c.eventCount,
        }));
    return index.orgs
      .filter((o) => match(o.name, o.kind, ...(o.domains ?? [])))
      .map((o) => ({
        id: o.id,
        primary: o.name,
        secondary: o.kind !== "unknown" ? o.kind.replace(/_/g, " ") : "",
        count: o.eventCount,
      }));
  }, [axis, query, index, crewBand]);

  /**
   * The crew list, regrouped by distance when a "near" place is set.
   *
   * GROUPS, not a filter. The reach chips decide where the "within reach" line
   * falls — nobody is dropped for being past it, because two of this roster's
   * standing rules forbid exactly that: a traveler beyond the band is precisely
   * who you fly in (and 35 of 61 have `travels` unset, which is *unknown*, not
   * "no"), and the three people no map can read ("EU", "Kentucky",
   * "Orlando? Florida?") must surface as fixable work, not vanish. The grouping
   * IS the answer to "who can work San Diego": locals, then who would travel,
   * then the unknowns, each sorted nearest-first.
   *
   * Null when the search is off; `{unresolved}` when the typed place itself
   * cannot be put on the map. The text query composes — it narrows within the
   * groups, same as it narrows the flat list.
   */
  const nearGroups = useMemo(() => {
    if (axis !== "people") return null;
    const place = near.trim();
    if (!place) return null;
    if (!isMappable(place)) return { unresolved: place, groups: [] };

    const q = query.trim().toLowerCase();
    const match = (...fields: (string | null | undefined)[]) =>
      !q || fields.some((f) => (f ?? "").toLowerCase().includes(q));

    const maxMiles = reach === "drivable" ? 300 : reach === "short flight" ? 1200 : Infinity;

    type Placed = { p: IntelPerson; miles: number; fromKey: string };
    const placed: Placed[] = [];
    const unplaced: IntelPerson[] = [];
    for (const p of index.people) {
      if (!q && !inCrewBand(p, crewBand)) continue;
      if (!match(p.name, p.fullName, p.email, p.homeCity, p.kind)) continue;
      const d = metroDistance(p.homeCity, place);
      if (d) placed.push({ p, miles: d.miles, fromKey: d.fromKey });
      else unplaced.push(p);
    }

    // A hard no sinks here exactly as it does in every picker — this list is
    // "who do I book near X", which is the picker question wearing a map.
    const sink = (a: IntelPerson, b: IntelPerson) =>
      a.standing.hardNo !== b.standing.hardNo ? (a.standing.hardNo ? 1 : -1) : 0;
    placed.sort((a, b) => sink(a.p, b.p) || a.miles - b.miles || a.p.name.localeCompare(b.p.name));
    unplaced.sort((a, b) => sink(a, b) || a.name.localeCompare(b.name));

    const row = ({ p, miles, fromKey }: Placed) => ({
      id: p.id,
      primary: p.name,
      secondary:
        `${Math.round(miles).toLocaleString()} mi · ${metroLabel(fromKey)}` +
        (p.travels === false ? " · local only" : ""),
      count: p.eventCount,
      star: p.isRegular,
    });

    const within = placed.filter((x) => x.miles <= maxMiles);
    const beyond = placed.filter((x) => x.miles > maxMiles);
    const travelers = beyond.filter((x) =>
      willTravel({ is_regular: x.p.isRegular, travels: x.p.travels })
    );
    const others = beyond.filter(
      (x) => !willTravel({ is_regular: x.p.isRegular, travels: x.p.travels })
    );

    return {
      unresolved: null,
      groups: [
        {
          label:
            reach === "drivable" ? "Drivable" : reach === "short flight" ? "A short flight" : "Nearest first",
          rows: within.map(row),
        },
        { label: "Would travel", rows: travelers.map(row) },
        { label: "Further out", rows: others.map(row) },
        {
          label: "Can’t place",
          rows: unplaced.map((p) => ({
            id: p.id,
            primary: p.name,
            secondary: p.homeCity ? `“${p.homeCity}” isn’t on the map` : "no location on file",
            count: p.eventCount,
            star: p.isRegular,
          })),
        },
      ].filter((g) => g.rows.length > 0),
    };
  }, [axis, near, reach, query, index.people, crewBand]);

  const currentId = selected[axis];
  const coverage = index.totalEventCount - index.uncoveredEventCount;

  return (
    <div>
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header>
        <h1 className="font-editorial text-[clamp(34px,4.5vw,52px)] leading-[0.95] text-stone-900">
          Who worked <span className="font-serif italic text-emerald-600">what</span>, and where
        </h1>
        <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-stone-500">
          Back-office only — never visible to a client.{" "}
          <span className="tabular-nums text-stone-700">{coverage}</span> of{" "}
          <span className="tabular-nums text-stone-700">{index.totalEventCount}</span> galleries
          have intel attached
          {index.uncoveredEventCount > 0 && (
            <>
              ; <span className="tabular-nums text-stone-700">{index.uncoveredEventCount}</span>{" "}
              still to match
            </>
          )}
          .
        </p>
      </header>

      {/* ── Axis tabs ─────────────────────────────────────────────────────── */}
      <div className="mt-10 flex flex-wrap items-end justify-between gap-6">
        {/*
          Wraps rather than scrolls. Four axes at 375px overflowed the row and
          took the whole page into horizontal scroll with it — a body that
          scrolls sideways is a bug, not a layout. Wrapping keeps every axis
          reachable without a swipe nobody knows is available.
        */}
        <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Pivot axis">
          {AXES.map((a) => {
            const active = a.key === axis;
            const n =
              a.key === "people" ? index.people.length
              : a.key === "venues" ? index.venues.length
              : a.key === "cities" ? index.cities.length
              : a.key === "clients" ? index.orgs.length
              : null;   // Roster manages its own list; a stale count would lie
            return (
              <button
                key={a.key}
                type="button"
                onClick={() => { setAxis(a.key); setQuery(""); }}
                className={`group relative pb-2 text-[13px] uppercase tracking-[0.14em] transition-colors duration-200 ${
                  active ? "text-stone-900" : "text-stone-400 hover:text-stone-600"
                }`}
              >
                {a.label}
                {n != null && <span className="ml-2 text-[11px] tabular-nums text-stone-300">{n}</span>}
                <span
                  className={`absolute inset-x-0 bottom-0 h-[2px] origin-left transition-transform duration-200 ${
                    active ? "scale-x-100 bg-emerald-500" : "scale-x-0 bg-stone-300 group-hover:scale-x-100"
                  }`}
                />
              </button>
            );
          })}
        </nav>

      </div>

      <div className="mt-px"><Rule /></div>

      {/**
       * Search sits ABOVE THE LIST IT SEARCHES, not in the header.
       *
       * Mason, 2026-08-15: "the search is top-right, but I feel like it would be
       * better just above the list it's searching (e.g. above the list of venues
       * or cities)." Right — in the header it read as a search over the whole
       * page, and its scope (this axis only, and it resets when you switch axes)
       * was invisible. Directly over the column, the thing it filters is the
       * next thing you look at.
       *
       * Still hidden on Roster: that tab owns its own search, and two boxes
       * where only one works is worse than none.
       */}
      {axis !== "roster" && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${axis === "people" ? "crew" : axis}…`}
              className="w-full max-w-sm rounded-md border border-stone-200 bg-white px-3 py-2 text-[14px] text-stone-800 placeholder:text-stone-400 focus:border-stone-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
            />

            {/* Which cut of the roster — the same four bands as the Roster tab
                and the /people wall. Search overrides the band, so a typed name
                finds anyone; the chips are for browsing. */}
            {axis === "people" && (
              <div className="flex flex-wrap items-center gap-1">
                {([
                  ["all", "All"],
                  ["regular", "Regulars"],
                  ["other", "Non-regulars"],
                  ["alumni", "Alumni"],
                ] as const).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setCrewBand(k)}
                    className={`rounded-full px-2.5 py-1 text-[12px] transition-colors ${
                      crewBand === k
                        ? "bg-stone-900 text-white"
                        : "border border-stone-200 text-stone-500 hover:border-stone-400 hover:text-stone-800"
                    }`}
                  >
                    {label}
                    {k !== "all" && (
                      <span className="ml-1.5 tabular-nums opacity-60">
                        {index.people.filter((p) => inCrewBand(p, k)).length}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* The radius search — see the nearGroups memo for the rules. */}
            {axis === "people" && (
              <div className="flex flex-wrap items-center gap-2">
                <label
                  htmlFor="intel-near"
                  className="text-[11px] uppercase tracking-[0.14em] text-stone-400"
                >
                  Near
                </label>
                <input
                  id="intel-near"
                  list="intel-metros"
                  value={near}
                  onChange={(e) => setNear(e.target.value)}
                  placeholder="a city…"
                  className="w-44 rounded-md border border-stone-200 bg-white px-3 py-2 text-[14px] text-stone-800 placeholder:text-stone-400 focus:border-stone-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
                />
                <datalist id="intel-metros">
                  {mappableMetros().map((m) => (
                    <option key={m.key} value={m.label} />
                  ))}
                </datalist>

                {near.trim() && (
                  <>
                    {/* One track, one answer — same control grammar as the
                        discipline picker on the create screen. */}
                    <span
                      role="radiogroup"
                      aria-label="How far is bookable"
                      className="inline-flex overflow-hidden rounded-full border border-stone-200 bg-white"
                    >
                      {([
                        ["drivable", "Drivable"],
                        ["short flight", "Short flight"],
                        ["any", "Anywhere"],
                      ] as const).map(([value, label], i) => (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={reach === value}
                          onClick={() => setReach(value)}
                          className={`px-2.5 py-1.5 text-[12px] transition-colors first:pl-3.5 last:pr-3.5 ${
                            i > 0 ? "border-l border-stone-200" : ""
                          } ${
                            reach === value
                              ? "bg-emerald-600 text-white"
                              : "text-stone-500 hover:bg-stone-50 hover:text-stone-800"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </span>
                    <button
                      type="button"
                      onClick={() => setNear("")}
                      className="text-[12px] text-stone-400 underline-offset-4 transition-colors hover:text-stone-700 hover:underline"
                    >
                      Clear
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* The bands are set against straight-line miles; never let them read
              as road distance (see DISTANCE_BANDS in geo.ts). One honest line. */}
          {axis === "people" && near.trim() && !nearGroups?.unresolved && (
            <p className="mt-2 text-[12px] text-stone-400">
              Straight-line miles — the drive runs longer.
            </p>
          )}
          {nearGroups?.unresolved && (
            <p className="mt-2 text-[12px] text-stone-400">
              Can’t put “{nearGroups.unresolved}” on the map — pick a metro from the list.
            </p>
          )}
        </div>
      )}

      {/* ── List + detail ─────────────────────────────────────────────────── */}
      {axis === "roster" ? (
        <div className="mt-8">
          <RosterManager />
        </div>
      ) : (
      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(260px,340px)_1fr]">
        {/**
         * The list STICKS beside the panel instead of scrolling away with it.
         *
         * Mason, 2026-08-15: "the crew list on the left doesn't go down the
         * whole page, so when I scrolled down on the right side, the list ended
         * prematurely." It was a fixed 70vh box in normal flow, so a tall
         * detail panel scrolled the list off the top and left dead space where
         * it used to be — in a master-detail view, the master should still be
         * there when you look back at it.
         *
         * Sticky from `lg` only: below that the columns stack, and a pinned
         * list would sit on top of the detail you just tapped through to.
         */}
        <div className="pr-1 lg:sticky lg:top-6 lg:max-h-[calc(100vh-4rem)] lg:self-start lg:overflow-y-auto">
          {nearGroups ? (
            nearGroups.groups.length === 0 ? (
              <Blank>
                {nearGroups.unresolved
                  ? "Pick a metro the map knows."
                  : `Nothing matches “${query}”.`}
              </Blank>
            ) : (
              nearGroups.groups.map((g) => (
                <div key={g.label}>
                  <p className="mb-1 mt-6 flex items-baseline gap-2 pl-3 text-[11px] uppercase tracking-[0.14em] text-stone-400 first:mt-0">
                    {g.label}
                    <span className="tabular-nums text-stone-300">{g.rows.length}</span>
                  </p>
                  <ul>
                    {g.rows.map((r) => (
                      <ListRow
                        key={r.id}
                        r={r}
                        active={r.id === currentId}
                        leading={<CrewAvatar face={avatars[r.id]} name={r.primary} size={30} />}
                        onClick={() =>
                          setSelected((s) => ({
                            ...s,
                            [axis]: r.id === currentId ? null : r.id,
                          }))
                        }
                      />
                    ))}
                  </ul>
                </div>
              ))
            )
          ) : rows.length === 0 ? (
            <Blank>Nothing matches “{query}”.</Blank>
          ) : (
            <ul>
              {rows.map((r) => (
                <ListRow
                  key={r.id}
                  r={r}
                  active={r.id === currentId}
                  leading={
                    axis === "people" ? (
                      <CrewAvatar face={avatars[r.id]} name={r.primary} size={30} />
                    ) : undefined
                  }
                  onClick={() =>
                    setSelected((s) => ({ ...s, [axis]: r.id === currentId ? null : r.id }))
                  }
                />
              ))}
            </ul>
          )}
        </div>

        <div className="min-w-0">
          {!currentId ? (
            <div className="rounded-lg border border-dashed border-stone-200 bg-white/60 px-8 py-16 text-center">
              <p className="font-editorial text-[20px] text-stone-500">
                Pick {SINGULAR[axis]}
              </p>
              <p className="mt-2 text-[13px] text-stone-400">
                Every panel links into the others — a person&apos;s venues open the venue,
                a venue&apos;s crew open the person.
              </p>
            </div>
          ) : axis === "people" ? (
            <PersonPanel
              p={personById.get(currentId)!}
              venueById={venueById}
              orgById={orgById}
              personById={personById}
              jump={jump}
              avatar={avatars[currentId] ?? null}
              onAvatarChange={() => setAvatarBump((b) => b + 1)}
            />
          ) : axis === "venues" ? (
            <VenuePanel v={venueById.get(currentId)!} personById={personById} orgById={orgById} jump={jump} />
          ) : axis === "cities" ? (
            <CityPanel c={cityByKey.get(currentId)!} personById={personById} venueById={venueById} jump={jump} />
          ) : (
            <OrgPanel o={orgById.get(currentId)!} personById={personById} venueById={venueById} jump={jump} />
          )}
        </div>
      </div>
      )}
    </div>
  );
}

/**
 * One list row, shared by the flat list and the distance groups.
 *
 * Extracted the day the radius search added a second renderer of the same row
 * — two copies of this button is how the star, the rail and the count column
 * drift apart.
 */
function ListRow({
  r,
  active,
  onClick,
  leading,
}: {
  r: { id: string; primary: string; secondary?: string; count: number; star?: boolean };
  active: boolean;
  onClick: () => void;
  /** The crew list's avatar circle; other axes pass nothing. */
  leading?: React.ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full ${leading ? "items-center" : "items-baseline"} justify-between gap-3 border-l-2 py-2.5 pl-3 pr-2 text-left transition-colors duration-200 ${
          active
            ? "border-emerald-500 bg-white"
            : "border-transparent hover:border-stone-300 hover:bg-white"
        }`}
      >
        {leading}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] text-stone-800">
            {r.star && (
              <span className="mr-1.5 text-accent" title="A regular">★</span>
            )}
            {r.primary}
          </span>
          {r.secondary && (
            <span className="block truncate text-[12px] text-stone-400">{r.secondary}</span>
          )}
        </span>
        <span className="shrink-0 text-[12px] tabular-nums text-stone-400">
          {r.count || "—"}
        </span>
      </button>
    </li>
  );
}

/* ── Inline editing ───────────────────────────────────────────────────────── */

const EFIELD =
  "w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-[13px] text-stone-800 placeholder:text-stone-300 focus:border-stone-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/25";

/**
 * Edit a venue or a client in place.
 *
 * Both are real rows with real ids, so this is a plain PATCH — no derived
 * cleverness. Cities are deliberately NOT editable here: they are derived from
 * venue.city, and giving them their own edit box would create a second place to
 * keep in sync. Fixing a city means fixing the venue's city, which is what the
 * venue editor does.
 *
 * `onSaved` hands the new values back so the board updates without a refetch —
 * a refetch would rebuild every axis and lose the open selection.
 */
function InlineEdit({
  fields, endpoint, id, onSaved, onCancel,
}: {
  fields: { key: string; label: string; value: string; placeholder?: string }[];
  endpoint: string;
  id: string;
  onSaved: (patch: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, f.value]))
  );
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...v }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not save");
      onSaved(v);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 rounded-md border border-stone-200 bg-white p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f.key} className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-stone-400">{f.label}</span>
            <input
              value={v[f.key] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); if (e.key === "Escape") onCancel(); }}
              className={EFIELD}
            />
          </label>
        ))}
      </div>
      {err && <p className="mt-2 text-[12px] text-red-700">{err}</p>}
      <div className="mt-3 flex items-center gap-3">
        <button onClick={() => void submit()} disabled={saving}
          className="rounded-md border border-stone-800 bg-stone-900 px-3 py-1 text-[12px] text-white disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={onCancel} className="text-[12px] text-stone-500 hover:text-stone-800">Cancel</button>
      </div>
    </div>
  );
}

/* ── Panels ───────────────────────────────────────────────────────────────── */

function PanelHead({
  title, sub, action, portrait,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  /**
   * A control that acts on the DETAILS — sits beside them, above the rule.
   *
   * Mason: "edit details should be above the line — to the right of the actual
   * details you're editing." Right: below the rule it sat among the chips,
   * which are a different kind of thing, and read as if it edited those.
   */
  action?: React.ReactNode;
  /** The face beside the name — crew panels pass their avatar here. */
  portrait?: React.ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4 pb-5">
      <div className="flex min-w-0 items-center gap-4">
        {portrait}
        <div className="min-w-0">
          <h2 className="font-editorial text-[30px] leading-tight text-stone-900">{title}</h2>
          {sub && <p className="mt-1.5 text-[13px] text-stone-500">{sub}</p>}
        </div>
      </div>
      {action && <div className="shrink-0 pt-2">{action}</div>}
    </header>
  );
}

/**
 * Edit a person, in the panel you are already looking at.
 *
 * Mason, 2026-08-15: he wants to "go through and seed the current list" — mark
 * regulars, rate the non-regulars, and fix names, emails and locations without
 * leaving the Crew axis. The Roster tab could already do some of this, but
 * nobody investigating a person wants to go somewhere else to correct what they
 * are looking at.
 *
 * ── WHAT A REGULAR DOES NOT NEED TO BE ASKED ────────────────────────────────
 *
 * "All regulars can lead and travel" and "all regulars are photographers ... so
 * they really don't need to have the role pill either, just whether or not they
 * led an event." Verified against the live roster before hiding anything: 15
 * regulars, all `kind: photographer`; 46 non-regulars, all stylists. Hiding a
 * control on a false premise would silently mislabel people, so it was checked
 * rather than trusted.
 *
 * So a regular shows ONE control — the star — and everything else is implied
 * through `canLead()` / `willTravel()` in roles.ts. A non-regular is asked the
 * things that actually vary: discipline, whether they can lead, whether they
 * travel, and how eager you are to rehire them.
 *
 * The rating here is a person-level BASELINE (`crew.rehire`). It exists because
 * most of the roster has no gig to attach a real rating to — 89 crew against 40
 * event links — and it always yields to a real per-gig judgement the moment one
 * exists (`rehireStanding`).
 */
function CrewEditor({
  p, open, setOpen,
}: {
  p: IntelPerson;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    display_name: p.name,
    primary_email: p.email ?? "",
    city: p.homeCity ?? "",
  });

  // Re-seed when the panel switches to a different person.
  useEffect(() => {
    setF({ display_name: p.name, primary_email: p.email ?? "", city: p.homeCity ?? "" });
    setErr(null);
  }, [p.id, p.name, p.email, p.homeCity]);

  const save = async (patch: Record<string, unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/crew", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, ...patch }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? "Could not save");
        return;
      }
      // The board is derived server-side from one pass over the whole fact
      // table, so a local patch would leave every OTHER axis stale — a person's
      // venues, a city's crew. Refresh re-derives them together, which is the
      // property that makes them incapable of disagreeing.
      router.refresh();
    } catch {
      setErr("Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center gap-2">
        {/* The star IS the regular toggle — same mark the list shows. */}
        <button
          type="button"
          disabled={busy}
          onClick={() => void save({ is_regular: !p.isRegular })}
          title={p.isRegular ? "A regular — click to unmark" : "Mark as a regular"}
          className={`rounded-[3px] border px-2.5 py-1 text-[12px] transition-colors disabled:opacity-50 ${
            p.isRegular
              ? "border-accent bg-accent text-white"
              : "border-stone-200 text-stone-400 hover:border-stone-400 hover:text-stone-600"
          }`}
        >
          ★ regular
        </button>

        {p.isRegular ? (
          // Everything else is implied. Saying so beats an empty space, which
          // reads as "not recorded" rather than "not a question".
          <span className="text-[12px] text-stone-400">
            photographer · can lead · travels
          </span>
        ) : (
          <>
            <SegChoice
              label="Discipline"
              options={[
                ["photographer", "photographer"],
                ["stylist", "stylist"],
                ["makeup artist", "MUA"],
              ]}
              value={p.kind}
              busy={busy}
              onPick={(v) => void save({ kind: v })}
            />
            <SegChoice
              label="Can lead"
              options={[["yes", "can lead"], ["no", "cannot"]]}
              value={p.canLead}
              busy={busy}
              onPick={(v) => void save({ can_lead: p.canLead === v ? null : v })}
            />
            <SegChoice
              label="Travel"
              options={[["yes", "travels"], ["no", "local only"]]}
              value={p.travels == null ? null : p.travels ? "yes" : "no"}
              busy={busy}
              onPick={(v) => {
                const next = v === "yes";
                void save({ travels: p.travels === next ? null : next });
              }}
            />
          </>
        )}
        {/**
         * Alumni, as an ACTION — Mason: "we should be able to mark/restore
         * alumni from the Crew tab as well as the roster tab." Sits last in
         * the row because it is about the RELATIONSHIP, not the person's
         * abilities; and it is always offered, so the same control both
         * retires someone and brings them back.
         *
         * Never the accent: retiring someone is not a brand moment. Stone
         * when they are alumni, a quiet outline when they are not.
         */}
        <button
          type="button"
          disabled={busy}
          onClick={() => void save({ archived: !p.archived })}
          title={
            p.archived
              ? "Alumni — click to bring them back to the active roster"
              : "Move to alumni — they drop out of every picker, the record stays"
          }
          className={`rounded-[3px] border px-2.5 py-1 text-[12px] transition-colors disabled:opacity-50 ${
            p.archived
              ? "border-stone-400 bg-stone-200 text-stone-700"
              : "border-stone-200 text-stone-400 hover:border-stone-400 hover:text-stone-600"
          }`}
        >
          {p.archived ? "alumni ↩" : "alumni"}
        </button>

      </div>

      {/**
       * The rehire ladder, for non-regulars only — you do not score your own
       * team gig to gig.
       *
       * Labelled as a starting point when it is one: a seeded opinion is not the
       * same thing as four rated gigs, and the panel should never let those look
       * alike.
       */}
      {/**
       * Last hired — non-regulars only, Mason's ask verbatim: "e.g. Aug 2024
       * (2 yrs)... it should update any time they work an event."
       *
       * The DISPLAY is the effective date (seed vs newest linked event, newest
       * wins — computed in the index); the INPUT edits only the seed. When a
       * linked event is already newer than anything you could type, the input
       * is beside the point, so the row says which source is speaking.
       */}
      {!p.isRegular && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-stone-400">Last hired</span>
          {formatLastHired(p.lastHired, new Date()) ? (
            <span className="text-[12px] text-stone-700">
              {formatLastHired(p.lastHired, new Date())}
              {p.lastHired !== p.lastHiredStored && (
                <span className="ml-1.5 text-[11px] text-stone-400">from a linked gig</span>
              )}
            </span>
          ) : (
            <span className="text-[12px] text-stone-300">unknown</span>
          )}
          <MonthPicker
            value={(p.lastHiredStored ?? "").slice(0, 7)}
            onChange={(v) => void save({ last_hired_on: v || null })}
            placeholder="set month"
          />
        </div>
      )}

      {!p.isRegular && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-stone-400">
            {p.standing.total > 0 ? "Rehire (from rated gigs)" : "Rehire"}
          </span>
          {p.standing.total > 0 ? (
            <StandingBadge s={p.standing} />
          ) : (
            <SegChoice
              label="Rehire"
              options={[
                ["first_call", "First call"],
                ["solid", "Solid"],
                ["last_resort", "Last resort"],
                ["never", "Never again"],
              ]}
              value={p.rehireBaseline}
              busy={busy}
              severity
              onPick={(v) => void save({ rehire: p.rehireBaseline === v ? null : v })}
            />
          )}
        </div>
      )}

      {open && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <input
            value={f.display_name}
            onChange={(e) => setF({ ...f, display_name: e.target.value })}
            placeholder="Name"
            className="rounded-md border border-stone-200 bg-white px-3 py-2 text-[13px] text-stone-800 focus:border-stone-400 focus:outline-none"
          />
          <input
            value={f.primary_email}
            onChange={(e) => setF({ ...f, primary_email: e.target.value })}
            placeholder="Email"
            className="rounded-md border border-stone-200 bg-white px-3 py-2 text-[13px] text-stone-800 focus:border-stone-400 focus:outline-none"
          />
          <input
            value={f.city}
            onChange={(e) => setF({ ...f, city: e.target.value })}
            placeholder="City / region"
            className="rounded-md border border-stone-200 bg-white px-3 py-2 text-[13px] text-stone-800 focus:border-stone-400 focus:outline-none sm:col-span-2"
          />
          <div className="flex items-center gap-3 sm:col-span-2">
            <button
              type="button"
              disabled={busy || !f.display_name.trim()}
              onClick={() =>
                void save({
                  display_name: f.display_name.trim(),
                  primary_email: f.primary_email.trim() || null,
                  city: f.city.trim() || null,
                }).then(() => setOpen(false))
              }
              className="rounded-md border border-stone-800 bg-stone-900 px-3 py-1 text-[12px] text-white disabled:opacity-40"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setErr(null); }}
              className="text-[12px] text-stone-500 hover:text-stone-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* A failed save must SAY so — an optimistic panel that silently keeps a
          rejected change lies about what was stored. */}
      {err && <p className="mt-2 text-[12px] text-red-700">{err}</p>}
    </div>
  );
}

/**
 * A one-of-N segmented control, matching the create card's language: a fully
 * rounded track for a choice, so it never reads as a set of independent flags.
 * Clicking the current value clears it — a judgement you cannot take back is
 * one people stop making.
 */
function SegChoice({
  label, options, value, busy, onPick, severity,
}: {
  label: string;
  options: [string, string][];
  value: string | null;
  busy: boolean;
  onPick: (v: string) => void;
  severity?: boolean;
}) {
  return (
    <span
      role="radiogroup"
      aria-label={label}
      className="inline-flex overflow-hidden rounded-full border border-stone-200"
    >
      {options.map(([v, text], i) => {
        const on = value === v;
        // Severity ramp for a rehire judgement; the neutral stone for anything
        // that is merely a fact about the person.
        /**
         * Brand emerald for a FACT about the person (discipline, can lead,
         * travels). The SEVERITY ramp for a rehire judgement — "never again" in
         * the brand's green would be absurd, and severity colours are
         * deliberately separate from the accent throughout this app.
         */
        const onClass = severity
          ? REHIRE_DOT[v]
            ? `${REHIRE_DOT[v][0]} text-white`
            : "bg-stone-900 text-white"
          : "bg-accent text-white";
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={busy}
            onClick={() => onPick(v)}
            className={`px-2.5 py-1 text-[12px] transition-colors first:pl-3.5 last:pr-3.5 disabled:opacity-50 ${
              i > 0 ? "border-l border-stone-200" : ""
            } ${on ? onClass : "text-stone-500 hover:bg-stone-50 hover:text-stone-800"}`}
          >
            {text}
          </button>
        );
      })}
    </span>
  );
}

function PersonPanel({
  p, venueById, orgById, personById, jump, avatar, onAvatarChange,
}: {
  p: IntelPerson;
  venueById: Map<string, IntelVenue>;
  orgById: Map<string, IntelOrg>;
  personById: Map<string, IntelPerson>;
  jump: (a: Axis, id: string) => void;
  avatar: CrewAvatarFace | null;
  onAvatarChange: () => void;
}) {
  const roles = Object.entries(p.roleCounts).sort((a, b) => b[1] - a[1]);
  // Held here so the toggle can sit in the header — beside the name, email and
  // city it edits — while the form and the chips render below the rule.
  const [editing, setEditing] = useState(false);
  useEffect(() => { setEditing(false); }, [p.id]);
  return (
    <div>
      <PanelHead
        portrait={<CrewAvatar face={avatar} name={p.name} size={56} />}
        title={
          <>
            {p.name}
            {p.isRegular && (
              <span className="ml-2 align-middle text-[16px] text-accent" title="A regular">
                ★
              </span>
            )}
          </>
        }
        sub={
          <>
            {p.fullName && p.fullName !== p.name && <>{p.fullName} · </>}
            {p.email ?? "no email on file"}
            {p.homeCity && <> · based in {p.homeCity}</>}
          </>
        }
        action={
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="text-[12px] text-stone-400 underline-offset-4 transition-colors hover:text-stone-800 hover:underline"
          >
            {editing ? "Done" : "Edit details"}
          </button>
        }
      />
      <Rule />

      <CrewEditor p={p} open={editing} setOpen={setEditing} />

      {/* Faces first: for 49 of 61 crew there are no gigs to list below, and
          this is the section with something to DO — seed a photo, then let the
          archive search take over. */}
      <Section title="Faces">
        <CrewFacesSection crewId={p.id} crewName={p.name} onAvatarChange={onAvatarChange} />
      </Section>

      <Section title={`${p.eventCount} ${p.eventCount === 1 ? "gig" : "gigs"}`}>
        {p.events.length === 0 ? (
          <Blank>No gigs linked yet. The calendar backfill attaches these from attendee emails.</Blank>
        ) : (
          <ul className="divide-y divide-stone-100">
            {p.events.map((e) => (
              <EventLine
                key={e.id}
                id={e.id}
                name={e.name}
                date={e.date}
                coverUrl={e.coverUrl}
                coverFocal={e.coverFocal}
                trailing={
                  <>
                    {e.roles.length > 0 && (
                      <span
                        className={
                          e.rolesSource === "inferred"
                            ? "text-[12px] italic text-stone-400"
                            : "text-[12px] text-stone-500"
                        }
                        title={
                          e.rolesSource === "inferred"
                            ? "Guessed from the calendar — confirm or change it"
                            : undefined
                        }
                      >
                        {e.roles.join(", ")}
                        {e.rolesSource === "inferred" && " ?"}
                      </span>
                    )}
                    <RebookDot value={e.wouldRebook} />
                  </>
                }
              />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Roles">
        {roles.length === 0 ? (
          <Blank>
            {p.inferredRoleCount > 0 ? (
              <>
                {p.inferredRoleCount} {p.inferredRoleCount === 1 ? "gig has" : "gigs have"} a
                guessed role, shown in italics above. Nothing is counted here until you
                confirm it — the calendar names who was there, never what they did.
              </>
            ) : (
              <>
                Not recorded yet — the calendar names who was there, never what they did.
                This is the one dimension that needs a human.
              </>
            )}
          </Blank>
        ) : (
          <div className="flex flex-wrap gap-2">
            {roles.map(([r, n]) => (
              <Chip key={r}>{r} <span className="ml-1.5 tabular-nums text-stone-400">{n}</span></Chip>
            ))}
          </div>
        )}
      </Section>

      {p.standing.total > 0 && (
        <Section title="Rehire">
          <div className="flex flex-wrap gap-5">
            {(["first_call", "solid", "last_resort", "never"] as const)
              .filter((k) => p.standing.tally[k] > 0)
              .map((k) => (
                <RebookDot key={k} value={k} count={p.standing.tally[k]} />
              ))}
          </div>
        </Section>
      )}

      <div className="grid gap-8 sm:grid-cols-2">
        <Section title="Venues worked">
          {p.venueIds.length === 0 ? <Blank>None recorded.</Blank> : (
            <div className="flex flex-wrap gap-2">
              {p.venueIds.map((id) => {
                const v = venueById.get(id);
                return v ? <Chip key={id} onClick={() => jump("venues", id)}>{v.name}</Chip> : null;
              })}
            </div>
          )}
        </Section>

        <Section title="Cities worked">
          {p.cities.length === 0 ? <Blank>None recorded.</Blank> : (
            <div className="flex flex-wrap gap-2">
              {p.cities.map((c) => (
                <Chip key={c} onClick={() => jump("cities", c.trim().toLowerCase())}>{c}</Chip>
              ))}
            </div>
          )}
        </Section>
      </div>

      <div className="grid gap-8 sm:grid-cols-2">
        <Section title="Clients">
          {p.orgIds.length === 0 ? <Blank>None recorded.</Blank> : (
            <div className="flex flex-wrap gap-2">
              {p.orgIds.map((id) => {
                const o = orgById.get(id);
                return o ? <Chip key={id} onClick={() => jump("clients", id)}>{o.name}</Chip> : null;
              })}
            </div>
          )}
        </Section>

        <Section title="Works alongside">
          {p.coCrewIds.length === 0 ? <Blank>No shared gigs recorded.</Blank> : (
            <div className="flex flex-wrap gap-2">
              {p.coCrewIds.map((id) => {
                const c = personById.get(id);
                return c ? <Chip key={id} onClick={() => jump("people", id)}>{c.name}</Chip> : null;
              })}
            </div>
          )}
        </Section>
      </div>

      {p.notes && (
        <Section title="Notes">
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-stone-700">{p.notes}</p>
        </Section>
      )}
    </div>
  );
}

function VenuePanel({
  v, personById, orgById, jump,
}: {
  v: IntelVenue;
  personById: Map<string, IntelPerson>;
  orgById: Map<string, IntelOrg>;
  jump: (a: Axis, id: string) => void;
}) {
  const [edit, setEdit] = useState(false);
  const [local, setLocal] = useState<{ name: string; address: string; city: string }>({
    name: v.name, address: v.address ?? "", city: v.city ?? "",
  });
  useEffect(() => {
    setLocal({ name: v.name, address: v.address ?? "", city: v.city ?? "" });
    setEdit(false);
  }, [v.id, v.name, v.address, v.city]);

  /** A leading digit means this "name" is really the street address. */
  const unnamed = /^\d/.test(local.name.trim());

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <PanelHead
          title={local.name}
          sub={
            <>
              {[local.address, local.city].filter(Boolean).join(", ")}
              {unnamed && (
                <span className="ml-2 text-stone-400">
                  — no venue name yet; the calendar only gave an address
                </span>
              )}
            </>
          }
        />
        <button
          onClick={() => setEdit((x) => !x)}
          className="mt-1 shrink-0 text-[12px] text-stone-400 hover:text-stone-800"
        >
          {edit ? "Cancel" : unnamed ? "Add a name" : "Edit"}
        </button>
      </div>
      {edit && (
        <InlineEdit
          endpoint="/api/venues"
          id={v.id}
          fields={[
            { key: "name", label: "Name", value: local.name, placeholder: "The Alder Room" },
            { key: "address", label: "Address", value: local.address, placeholder: "418 Wharf St" },
            { key: "city", label: "City", value: local.city, placeholder: "San Jose" },
          ]}
          onSaved={(patch) => { setLocal({ ...local, ...patch } as typeof local); setEdit(false); }}
          onCancel={() => setEdit(false)}
        />
      )}
      <Rule />

      <Section title={`${v.eventCount} ${v.eventCount === 1 ? "gig" : "gigs"} here`}>
        {v.events.length === 0 ? (
          <Blank>No gigs linked to this venue yet.</Blank>
        ) : (
          <ul className="divide-y divide-stone-100">
            {v.events.map((e) => <EventLine key={e.id} {...e} />)}
          </ul>
        )}
      </Section>

      <Section title="What we know about the room">
        {v.notes ? (
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-stone-700">{v.notes}</p>
        ) : (
          <Blank>
            Nothing yet. This is where the loading dock, the power situation and the
            security lead time belong — the things that are true every time,
            not just the last time.
          </Blank>
        )}
      </Section>

      <div className="grid gap-8 sm:grid-cols-2">
        <Section title="Crew who've worked it">
          {v.crewIds.length === 0 ? <Blank>None recorded.</Blank> : (
            <div className="flex flex-wrap gap-2">
              {v.crewIds.map((id) => {
                const p = personById.get(id);
                return p ? <Chip key={id} onClick={() => jump("people", id)}>{p.name}</Chip> : null;
              })}
            </div>
          )}
        </Section>
        <Section title="Clients seen here">
          {v.orgIds.length === 0 ? <Blank>None recorded.</Blank> : (
            <div className="flex flex-wrap gap-2">
              {v.orgIds.map((id) => {
                const o = orgById.get(id);
                return o ? <Chip key={id} onClick={() => jump("clients", id)}>{o.name}</Chip> : null;
              })}
            </div>
          )}
        </Section>
      </div>

      {v.city && (
        <Section title="City">
          <Chip onClick={() => jump("cities", v.city!.trim().toLowerCase())}>{v.city}</Chip>
        </Section>
      )}
    </div>
  );
}

function CityPanel({
  c, personById, venueById, jump,
}: {
  c: IntelCity;
  personById: Map<string, IntelPerson>;
  venueById: Map<string, IntelVenue>;
  jump: (a: Axis, id: string) => void;
}) {
  return (
    <div>
      <PanelHead
        title={c.name}
        sub={`${c.eventCount} ${c.eventCount === 1 ? "gig" : "gigs"}${c.region ? ` · ${c.region}` : ""}`}
      />
      <Rule />

      <Section title="Crew based here">
        {c.localCrewIds.length === 0 ? (
          <Blank>
            Nobody on the roster lists this as home. That is the hiring question,
            and it is separate from who has flown in to work here.
          </Blank>
        ) : (
          <div className="flex flex-wrap gap-2">
            {c.localCrewIds.map((id) => {
              const p = personById.get(id);
              return p ? (
                <Chip key={id} onClick={() => jump("people", id)}>
                  {p.name}
                  {p.canLead === "yes" && <span className="ml-1.5 text-stone-400">lead</span>}
                </Chip>
              ) : null;
            })}
          </div>
        )}
      </Section>

      <Section title="Crew who've worked here">
        {c.crewIds.length === 0 ? <Blank>None recorded.</Blank> : (
          <div className="flex flex-wrap gap-2">
            {c.crewIds.map((id) => {
              const p = personById.get(id);
              return p ? <Chip key={id} onClick={() => jump("people", id)}>{p.name}</Chip> : null;
            })}
          </div>
        )}
      </Section>

      <Section title="Venues">
        {c.venueIds.length === 0 ? <Blank>None recorded.</Blank> : (
          <div className="flex flex-wrap gap-2">
            {c.venueIds.map((id) => {
              const v = venueById.get(id);
              return v ? <Chip key={id} onClick={() => jump("venues", id)}>{v.name}</Chip> : null;
            })}
          </div>
        )}
      </Section>

      {c.events.length > 0 && (
        <Section title="Gigs">
          <ul className="divide-y divide-stone-100">
            {c.events.map((e) => <EventLine key={e.id} {...e} />)}
          </ul>
        </Section>
      )}
    </div>
  );
}

function OrgPanel({
  o, personById, venueById, jump,
}: {
  o: IntelOrg;
  personById: Map<string, IntelPerson>;
  venueById: Map<string, IntelVenue>;
  jump: (a: Axis, id: string) => void;
}) {
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(o.name);
  useEffect(() => { setName(o.name); setEdit(false); }, [o.id, o.name]);

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <PanelHead
          title={name}
          sub={
            <>
              {o.kind !== "unknown" && <>{o.kind.replace(/_/g, " ")} · </>}
              {o.domains.length ? o.domains.join(", ") : "no domain on file"}
            </>
          }
        />
        <button
          onClick={() => setEdit((x) => !x)}
          className="mt-1 shrink-0 text-[12px] text-stone-400 hover:text-stone-800"
        >
          {edit ? "Cancel" : "Rename"}
        </button>
      </div>
      {edit && (
        /* Renaming never touches `domains` — the domain is the identity, and
           editing a label must not be able to split one company into two. */
        <InlineEdit
          endpoint="/api/organizations"
          id={o.id}
          fields={[{ key: "name", label: "Client name", value: name, placeholder: "Episode 1 Agency" }]}
          onSaved={(patch) => { setName(patch.name ?? name); setEdit(false); }}
          onCancel={() => setEdit(false)}
        />
      )}
      <Rule />

      <Section title={`${o.eventCount} ${o.eventCount === 1 ? "gig" : "gigs"}`}>
        {o.events.length === 0 ? <Blank>No gigs linked yet.</Blank> : (
          <ul className="divide-y divide-stone-100">
            {o.events.map((e) => (
              <EventLine
                key={`${e.id}-${e.role}`}
                id={e.id}
                name={e.name}
                date={e.date}
                coverUrl={e.coverUrl}
                coverFocal={e.coverFocal}
                trailing={
                  <span
                    className="text-[12px] text-stone-500"
                    title="payer is the client; end brand and host are different companies and all three can be true"
                  >
                    {e.role.replace(/_/g, " ")}
                  </span>
                }
              />
            ))}
          </ul>
        )}
      </Section>

      <div className="grid gap-8 sm:grid-cols-2">
        <Section title="Crew who've worked them">
          {o.crewIds.length === 0 ? <Blank>None recorded.</Blank> : (
            <div className="flex flex-wrap gap-2">
              {o.crewIds.map((id) => {
                const p = personById.get(id);
                return p ? <Chip key={id} onClick={() => jump("people", id)}>{p.name}</Chip> : null;
              })}
            </div>
          )}
        </Section>
        <Section title="Venues">
          {o.venueIds.length === 0 ? <Blank>None recorded.</Blank> : (
            <div className="flex flex-wrap gap-2">
              {o.venueIds.map((id) => {
                const v = venueById.get(id);
                return v ? <Chip key={id} onClick={() => jump("venues", id)}>{v.name}</Chip> : null;
              })}
            </div>
          )}
        </Section>
      </div>

      {o.cities.length > 0 && (
        <Section title="Cities">
          <div className="flex flex-wrap gap-2">
            {o.cities.map((c) => (
              <Chip key={c} onClick={() => jump("cities", c.trim().toLowerCase())}>{c}</Chip>
            ))}
          </div>
        </Section>
      )}

      {o.notes && (
        <Section title="Notes">
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-stone-700">{o.notes}</p>
        </Section>
      )}
    </div>
  );
}
