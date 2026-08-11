"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";

export interface PersonAppearance {
  eventId: string;
  eventName: string;
  eventDate: string | null;
  imageCount: number;
  heroUrl: string | null;
}

export interface PersonCard {
  key: string;
  name: string;
  eventCount: number;
  imageCount: number;
  heroUrl: string | null;
  events: PersonAppearance[];
}

type SortMode = "rank" | "photos" | "alpha";

export function PeopleBoard({ people }: { people: PersonCard[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("rank");
  const [repeatOnly, setRepeatOnly] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = people;
    if (repeatOnly) list = list.filter((p) => p.eventCount >= 2);
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q));
    if (sort === "alpha") {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === "photos") {
      // Most-photographed, regardless of how many events that took — a single
      // long session outranks two quick ones, which is the honest answer to
      // "who do I have the most of".
      list = [...list].sort(
        (a, b) =>
          b.imageCount - a.imageCount ||
          b.eventCount - a.eventCount ||
          a.name.localeCompare(b.name)
      );
    }
    // "rank" arrives pre-sorted from the server (events → photos → name).
    return list;
  }, [people, query, sort, repeatOnly]);

  // The wall of fame: the podium only means something when it's earned, so it
  // appears solely in rank order, unfiltered, and only for people who have
  // actually returned. With a partially-migrated archive that's often nobody —
  // in which case we say so instead of rendering a hollow trophy shelf.
  const podium =
    sort === "rank" && !query.trim()
      ? filtered.filter((p) => p.eventCount >= 2).slice(0, 3)
      : [];
  const rest = filtered.filter((p) => !podium.includes(p));

  return (
    <div className="px-8 pb-24 md:px-16">
      {/* Controls */}
      <div className="mb-10 flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-stone-100 pb-4">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-300" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people…"
            className="w-full border-b border-transparent bg-transparent py-2 pl-6 text-[15px] text-stone-900 placeholder:text-stone-300 focus:border-stone-300 focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-0 top-1/2 -translate-y-1/2 text-stone-300 hover:text-stone-600"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-4 text-[12px]">
          <button
            onClick={() => setSort("rank")}
            className={`uppercase tracking-[0.12em] transition-colors ${
              sort === "rank" ? "text-stone-900" : "text-stone-400 hover:text-stone-600"
            }`}
          >
            Most events
          </button>
          <span className="h-3 w-px bg-stone-200" />
          <button
            onClick={() => setSort("photos")}
            className={`uppercase tracking-[0.12em] transition-colors ${
              sort === "photos" ? "text-stone-900" : "text-stone-400 hover:text-stone-600"
            }`}
          >
            Most photos
          </button>
          <span className="h-3 w-px bg-stone-200" />
          <button
            onClick={() => setSort("alpha")}
            className={`uppercase tracking-[0.12em] transition-colors ${
              sort === "alpha" ? "text-stone-900" : "text-stone-400 hover:text-stone-600"
            }`}
          >
            A–Z
          </button>
          <span className="h-3 w-px bg-stone-200" />
          <button
            onClick={() => setRepeatOnly((v) => !v)}
            className={`uppercase tracking-[0.12em] transition-colors ${
              repeatOnly ? "text-emerald-700" : "text-stone-400 hover:text-stone-600"
            }`}
            title="Only people who've been in more than one event"
          >
            Repeat only
          </button>
        </div>

        <span className="text-[12px] tabular-nums text-stone-300">
          {filtered.length.toLocaleString()} shown
        </span>
      </div>

      {/* ─── Wall of fame ─── */}
      {podium.length > 0 && (
        <section className="mb-16">
          <p className="label-caps mb-6">Wall of fame</p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {podium.map((p, i) => (
              <PodiumCard key={p.key} person={p} place={i + 1} />
            ))}
          </div>
        </section>
      )}

      {/* ─── Everyone ─── */}
      {rest.length > 0 && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {rest.map((p) => (
            <PersonTile key={p.key} person={p} />
          ))}
        </div>
      )}

      {filtered.length === 0 && (
        <p className="py-16 text-center text-[14px] text-stone-400">
          {repeatOnly
            ? "Nobody's been in two events yet — this fills in as more of the archive moves over."
            : "No one matches that name."}
        </p>
      )}
    </div>
  );
}

/* ─── Podium: bigger frame, editorial numeral, and the time strip ─── */
function PodiumCard({ person, place }: { person: PersonCard; place: number }) {
  return (
    <div className="group relative">
      <div className="relative aspect-[4/5] overflow-hidden bg-stone-100">
        {person.heroUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={person.heroUrl}
            alt={person.name}
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
            style={{ objectPosition: "center 25%" }}
          />
        ) : (
          <div className="h-full w-full bg-stone-100" />
        )}
        {/* The place numeral, set in the editorial serif and bled off the
            corner — a laurel or a medal emoji would read as a template. */}
        <span
          className="font-editorial pointer-events-none absolute -left-1 -top-6 select-none text-[110px] leading-none text-white/85 mix-blend-overlay"
          aria-hidden="true"
        >
          {place}
        </span>
      </div>
      <p className="font-editorial mt-3 text-[20px] leading-tight text-stone-900">
        {person.name}
      </p>
      <p className="mt-1 text-[12px] text-stone-400">
        {person.eventCount} events · {person.imageCount.toLocaleString()} photos
      </p>
      <TimeStrip person={person} />
    </div>
  );
}

/** One frame per event, oldest first — the same face across years. */
function TimeStrip({ person }: { person: PersonCard }) {
  return (
    <div className="mt-3 flex items-end gap-1.5">
      {person.events.map((e) => (
        <Link
          key={e.eventId}
          href={`/events/${e.eventId}`}
          title={`${e.eventName}${e.eventDate ? ` · ${e.eventDate}` : ""} — ${e.imageCount} photos`}
          className="group/strip relative block h-12 w-9 shrink-0 overflow-hidden bg-stone-100"
        >
          {e.heroUrl && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={e.heroUrl}
              alt=""
              className="h-full w-full object-cover opacity-80 transition-opacity duration-300 group-hover/strip:opacity-100"
              style={{ objectPosition: "center 25%" }}
            />
          )}
        </Link>
      ))}
    </div>
  );
}

/* ─── Everyone else ─── */
function PersonTile({ person }: { person: PersonCard }) {
  const target =
    person.events.length === 1
      ? `/events/${person.events[0].eventId}`
      : `/search?q=${encodeURIComponent(person.name)}`;
  return (
    <Link href={target} className="group block" title={`${person.imageCount} photos`}>
      <div className="relative aspect-[4/5] overflow-hidden bg-stone-100">
        {person.heroUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={person.heroUrl}
            alt={person.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            style={{ objectPosition: "center 25%" }}
          />
        ) : (
          <div className="h-full w-full bg-stone-100" />
        )}
        {person.eventCount > 1 && (
          <span className="absolute right-2 top-2 rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-stone-900">
            {person.eventCount}
          </span>
        )}
      </div>
      <p className="mt-2 truncate text-[13px] text-stone-900" title={person.name}>
        {person.name}
      </p>
      <p className="text-[11px] tabular-nums text-stone-400">
        {person.imageCount} photo{person.imageCount === 1 ? "" : "s"}
      </p>
    </Link>
  );
}
