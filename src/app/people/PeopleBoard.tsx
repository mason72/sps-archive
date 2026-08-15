"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { EventChip, PersonSpotlight } from "./PersonSpotlight";
import { CrewWall } from "@/components/crew/CrewWall";

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
  /** 800px rendition — the podium is far too big for thumb-md. */
  heroUrlLg?: string | null;
  events: PersonAppearance[];
}

type SortMode = "rank" | "photos" | "alpha";

/**
 * "Not a person."
 *
 * A filename makes a convincing name — "Twodudes Arizona" is a filename prefix
 * that arrived with 439 conference photos; "Jordan BackToSchool Banner.ai" is
 * an Illustrator artboard. Both look exactly like a person to any pattern, so
 * the only fix is letting Mason say so.
 *
 * Optimistic and reversible: the card leaves immediately, and an undo sits in
 * the toast until it is dismissed. Nothing about the PHOTOS changes — this
 * decides only whether the identity appears in the index.
 */
function useNotAPerson() {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [undo, setUndo] = useState<{ name: string } | null>(null);

  const exclude = async (name: string) => {
    setHidden((h) => new Set(h).add(name));
    setUndo({ name });
    const res = await fetch("/api/people/exclude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    // Put it back if the write failed — a card that vanishes on a 500 is a lie.
    if (!res.ok) {
      setHidden((h) => { const n = new Set(h); n.delete(name); return n; });
      setUndo(null);
    }
  };

  const restore = async (name: string) => {
    setHidden((h) => { const n = new Set(h); n.delete(name); return n; });
    setUndo(null);
    await fetch(`/api/people/exclude?name=${encodeURIComponent(name)}`, { method: "DELETE" });
  };

  return { hidden, undo, exclude, restore, dismissUndo: () => setUndo(null) };
}

export function PeopleBoard({ people }: { people: PersonCard[] }) {
  const notAPerson = useNotAPerson();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("rank");
  const [repeatOnly, setRepeatOnly] = useState(false);
  /** The open person, held by KEY rather than index: sorting or searching
   *  while the spotlight is open must not silently swap who you're reading. */
  const [openKey, setOpenKey] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = people.filter((p) => !notAPerson.hidden.has(p.name));
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
  }, [people, query, sort, repeatOnly, notAPerson.hidden]);

  // The wall of fame: the podium only means something when it's earned, so it
  // appears solely in rank order, unfiltered, and only for people who have
  // actually returned. With a partially-migrated archive that's often nobody —
  // in which case we say so instead of rendering a hollow trophy shelf.
  const podium =
    sort === "rank" && !query.trim()
      ? filtered.filter((p) => p.eventCount >= 2).slice(0, 3)
      : [];
  const rest = filtered.filter((p) => !podium.includes(p));

  const openAt = openKey ? filtered.findIndex((p) => p.key === openKey) : -1;
  const open = openAt >= 0 ? filtered[openAt] : null;

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
              <PodiumCard
                key={p.key}
                person={p}
                place={i + 1}
                onOpen={() => setOpenKey(p.key)}
                onNotAPerson={() => notAPerson.exclude(p.name)}
              />
            ))}
          </div>
        </section>
      )}

      {/* ─── Your crew ─── (self-gating: renders nothing without Event Intel) */}
      <CrewWall />

      {/* ─── Everyone ─── */}
      {rest.length > 0 && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {rest.map((p) => (
            <PersonTile
              key={p.key}
              person={p}
              onOpen={() => setOpenKey(p.key)}
              onNotAPerson={() => notAPerson.exclude(p.name)}
            />
          ))}
        </div>
      )}

      {notAPerson.undo && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-stone-300 bg-white px-4 py-2 text-[13px] text-stone-700 shadow-lg"
        >
          Hidden <span className="text-stone-900">{notAPerson.undo.name}</span>
          <button
            type="button"
            onClick={() => notAPerson.restore(notAPerson.undo!.name)}
            className="ml-3 text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={notAPerson.dismissUndo}
            aria-label="Dismiss"
            className="ml-3 text-stone-400 hover:text-stone-700"
          >
            ×
          </button>
        </div>
      )}

      {filtered.length === 0 && (
        <p className="py-16 text-center text-[14px] text-stone-400">
          {repeatOnly
            ? "Nobody's been in two events yet — this fills in as more of the archive moves over."
            : "No one matches that name."}
        </p>
      )}

      {open && (
        <PersonSpotlight
          name={open.name}
          onClose={() => setOpenKey(null)}
          onPrev={
            openAt > 0 ? () => setOpenKey(filtered[openAt - 1].key) : undefined
          }
          onNext={
            openAt < filtered.length - 1
              ? () => setOpenKey(filtered[openAt + 1].key)
              : undefined
          }
        />
      )}
    </div>
  );
}

/* ─── Podium: bigger frame, editorial numeral, and the event chips ─── */
function PodiumCard({
  person,
  place,
  onOpen,
  onNotAPerson,
}: {
  person: PersonCard;
  place: number;
  onOpen: () => void;
  onNotAPerson?: () => void;
}) {
  return (
    <div className="group relative">
      {onNotAPerson && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onNotAPerson(); }}
          title="Not a person — hide this from the index"
          /* Visible by default on touch, revealed on hover at desktop widths.
             Hover must never be the ONLY way to reach a control — there is no
             hover on a phone, and this would simply not exist there. */
          className="absolute right-2 top-2 z-10 rounded-full border border-stone-300 bg-white/90 px-2 py-1 text-[11px] text-stone-600 backdrop-blur transition-opacity duration-200 hover:border-stone-800 hover:text-stone-900 focus:opacity-100 md:opacity-0 md:group-hover:opacity-100"
        >
          Not a person
        </button>
      )}
      <button
        onClick={onOpen}
        className="relative block aspect-[4/5] w-full overflow-hidden bg-stone-100"
        title={`All ${person.imageCount.toLocaleString()} photos of ${person.name}`}
      >
        {person.heroUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={person.heroUrlLg ?? person.heroUrl}
            srcSet={
              person.heroUrlLg
                ? `${person.heroUrl} 400w, ${person.heroUrlLg} 800w`
                : undefined
            }
            sizes="(max-width: 640px) 90vw, 33vw"
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
      </button>
      <button
        onClick={onOpen}
        className="font-editorial mt-3 block text-left text-[20px] leading-tight text-stone-900 hover:text-emerald-700"
      >
        {person.name}
      </button>
      <p className="mt-1 text-[12px] text-stone-400">
        {person.eventCount} events · {person.imageCount.toLocaleString()} photos
      </p>
      <EventChips person={person} />
    </div>
  );
}

/**
 * Where they've appeared. Two chips fit a podium column comfortably; beyond
 * that a "+N" opens the spotlight, which lists every shoot without trying to
 * cram them into a card (the wrapping problem Mason flagged before it bit).
 */
function EventChips({ person }: { person: PersonCard }) {
  const MAX = 2;
  const shown = person.events.slice(0, MAX);
  const extra = person.events.length - shown.length;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {shown.map((e) => (
        <EventChip key={e.eventId} event={e} personName={person.name} compact />
      ))}
      {extra > 0 && (
        <span className="text-[11px] text-stone-400">+{extra} more</span>
      )}
    </div>
  );
}

/* ─── Everyone else ─── */
function PersonTile({
  person,
  onOpen,
  onNotAPerson,
}: {
  person: PersonCard;
  onOpen: () => void;
  onNotAPerson?: () => void;
}) {
  // Always the spotlight. The old tile guessed — one event meant a link into
  // that event (which loaded 5,787 photos and filtered to none of them), two
  // meant a semantic search for their name. Clicking a face should show you
  // that face's photos; nothing else is a defensible answer.
  return (
    // Wrapped rather than nested: the tile itself is a <button>, and a button
    // inside a button is invalid HTML — the browser silently un-nests it and
    // the inner click never fires.
    <div className="group relative">
      {onNotAPerson && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onNotAPerson(); }}
          title="Not a person — hide this from the index"
          className="absolute right-1.5 top-1.5 z-10 rounded-full border border-stone-300 bg-white/90 px-2 py-0.5 text-[10px] text-stone-600 backdrop-blur transition-opacity duration-200 hover:border-stone-800 hover:text-stone-900 focus:opacity-100 md:opacity-0 md:group-hover:opacity-100"
        >
          Not a person
        </button>
      )}
    <button
      onClick={onOpen}
      className="block w-full text-left"
      title={`All ${person.imageCount.toLocaleString()} photos of ${person.name}`}
    >
      <div className="relative aspect-[4/5] overflow-hidden bg-stone-100">
        {person.heroUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={person.heroUrl}
            srcSet={
              person.heroUrlLg
                ? `${person.heroUrl} 400w, ${person.heroUrlLg} 800w`
                : undefined
            }
            sizes="(max-width: 640px) 45vw, 16vw"
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
    </button>
    </div>
  );
}
