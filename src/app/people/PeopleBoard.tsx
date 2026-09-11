"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { EventChip, PersonSpotlight } from "./PersonSpotlight";
import { IdentitySuggestions } from "./IdentitySuggestions";
import { CrewWall } from "@/components/crew/CrewWall";

export interface PersonAppearance {
  eventId: string;
  eventName: string;
  eventDate: string | null;
  imageCount: number;
  heroUrl?: string | null;
}

export interface PersonCard {
  key: string;
  name: string;
  /** Crew never take the podium — the trophy shelf is for clients and guests. */
  isCrew?: boolean;
  eventCount: number;
  imageCount: number;
  /** Signed inline for the first screenfuls only — the rest arrive from
   *  /api/people/heroes as the board scrolls (useHeroes). */
  heroUrl?: string | null;
  /** 800px rendition — the podium is far too big for thumb-md. */
  heroUrlLg?: string | null;
  /** Has a hero frame at all, so the board never asks for one that doesn't exist. */
  hasHero: boolean;
  /** Repeat people only: the podium's chips are the one reader. */
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

type Hero = { md: string; lg: string | null };

/**
 * Tiles rendered per step. ~8,300 tiles in the DOM at once was most of the
 * page's weight, and nobody scrolls past a few hundred without searching.
 */
const WINDOW = 240;
/** Faces requested per round trip as tiles approach the viewport. */
const HERO_BATCH = 120;

/**
 * Hero faces, signed on demand. The server inlines the first screenfuls; this
 * asks /api/people/heroes for whatever is about to be seen. `requested` is the
 * guard against asking twice — a failed batch is forgotten, so it is asked for
 * again the next time what's on screen changes (a scroll step, a search).
 */
function useHeroes(people: PersonCard[]) {
  const [heroes, setHeroes] = useState<Map<string, Hero>>(() => {
    const m = new Map<string, Hero>();
    for (const p of people) {
      if (p.heroUrl) m.set(p.key, { md: p.heroUrl, lg: p.heroUrlLg ?? null });
    }
    return m;
  });
  const requested = useRef<Set<string> | null>(null);
  if (requested.current === null) {
    requested.current = new Set(people.filter((p) => p.heroUrl).map((p) => p.key));
  }

  // A router.refresh brings a fresh set of inline faces — fold them in.
  useEffect(() => {
    const inline = people.filter((p) => p.heroUrl);
    for (const p of inline) requested.current!.add(p.key);
    setHeroes((prev) => {
      let next: Map<string, Hero> | null = null;
      for (const p of inline) {
        if (prev.get(p.key)?.md === p.heroUrl) continue;
        next ??= new Map(prev);
        next.set(p.key, { md: p.heroUrl!, lg: p.heroUrlLg ?? null });
      }
      return next ?? prev;
    });
  }, [people]);

  const withHero = useMemo(
    () => new Set(people.filter((p) => p.hasHero).map((p) => p.key)),
    [people]
  );

  const ensureHeroes = useCallback(
    (keys: string[]) => {
      const asked = requested.current!;
      const need = keys.filter((k) => withHero.has(k) && !asked.has(k));
      if (need.length === 0) return;
      for (const k of need) asked.add(k);
      for (let i = 0; i < need.length; i += HERO_BATCH) {
        const batch = need.slice(i, i + HERO_BATCH);
        fetch("/api/people/heroes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keys: batch }),
        })
          .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
          .then((body: { heroes: Record<string, Hero> }) => {
            setHeroes((prev) => {
              const next = new Map(prev);
              for (const [k, v] of Object.entries(body.heroes)) next.set(k, v);
              return next;
            });
          })
          .catch(() => {
            for (const k of batch) asked.delete(k);
          });
      }
    },
    [withHero]
  );

  return { heroes, ensureHeroes };
}

export function PeopleBoard({ people }: { people: PersonCard[] }) {
  const notAPerson = useNotAPerson();
  const { heroes, ensureHeroes } = useHeroes(people);
  /** Names just merged away. The wall's snapshot rebuilds behind the merge,
   *  so without this the folded tile would linger until the rebuild lands. */
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("rank");
  const [repeatOnly, setRepeatOnly] = useState(false);
  /** The open person, held by KEY rather than index: sorting or searching
   *  while the spotlight is open must not silently swap who you're reading. */
  const [openKey, setOpenKey] = useState<string | null>(null);
  /** A just-recorded merge, held for the undo bar. */
  const [mergeUndo, setMergeUndo] = useState<{ aliasName: string; canonicalName: string } | null>(
    null
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = people.filter((p) => !notAPerson.hidden.has(p.name) && !folded.has(p.name));
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
    //
    // In the RANKED views, crew sink below every guest: excluding Mason from
    // the podium only promoted him to the top of this grid (9 events beats
    // every guest's 2), which reads as the same trophy. Your Crew has its own
    // wall right above; here they close the list. Search and A–Z are exempt —
    // a typed name is a question about a person, and finding them wins.
    if (!q && (sort === "rank" || sort === "photos")) {
      list = [...list.filter((p) => !p.isCrew), ...list.filter((p) => p.isCrew)];
    }
    return list;
  }, [people, query, sort, repeatOnly, notAPerson.hidden, folded]);

  // The wall of fame: the podium only means something when it's earned, so it
  // appears solely in rank order, unfiltered, and only for people who have
  // actually returned. With a partially-migrated archive that's often nobody —
  // in which case we say so instead of rendering a hollow trophy shelf.
  // Top 6 — two rows of three (Mason, 2026-08-16) — and crew are excluded:
  // being paid to be in frame is not a trophy. They stay in Everyone below.
  const podium = useMemo(
    () =>
      sort === "rank" && !query.trim()
        ? filtered.filter((p) => p.eventCount >= 2 && !p.isCrew).slice(0, 6)
        : [],
    [filtered, sort, query]
  );
  const rest = useMemo(() => filtered.filter((p) => !podium.includes(p)), [filtered, podium]);

  // Windowed rendering. The window belongs to one shape of the list — a new
  // search, sort or filter starts again from the top rather than rendering
  // however far the last list had been scrolled.
  const shape = `${query} ${sort} ${repeatOnly}`;
  const [win, setWin] = useState({ shape, limit: WINDOW });
  const limit = win.shape === shape ? win.limit : WINDOW;
  const grow = useCallback(
    () => setWin((w) => ({ shape, limit: (w.shape === shape ? w.limit : WINDOW) + WINDOW })),
    [shape]
  );
  const shown = useMemo(() => rest.slice(0, limit), [rest, limit]);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) grow();
      },
      { rootMargin: "1200px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [grow, shown.length, rest.length]);

  // Faces for everything on screen: the podium and the rendered window.
  useEffect(() => {
    ensureHeroes([...podium, ...shown].map((p) => p.key));
  }, [podium, shown, ensureHeroes]);

  const mergeCandidates = useMemo(
    () =>
      people.map((p) => ({
        key: p.key,
        name: p.name,
        heroUrl: heroes.get(p.key)?.md ?? null,
        imageCount: p.imageCount,
      })),
    [people, heroes]
  );

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

      {/* ─── The naming engine's queue (renders nothing when empty) ─── */}
      <IdentitySuggestions />

      {/* ─── Wall of fame ─── */}
      {podium.length > 0 && (
        <section className="mb-16">
          <p className="label-caps mb-6">Wall of fame</p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {podium.map((p, i) => (
              <PodiumCard
                key={p.key}
                person={p}
                hero={heroes.get(p.key)}
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
      {shown.length > 0 && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {shown.map((p) => (
            <PersonTile
              key={p.key}
              person={p}
              hero={heroes.get(p.key)}
              onOpen={() => setOpenKey(p.key)}
              onNotAPerson={() => notAPerson.exclude(p.name)}
            />
          ))}
        </div>
      )}
      {/* The sentinel grows the window before it scrolls into view; the
          button is the same step for anyone not scrolling. */}
      {rest.length > shown.length && (
        <div ref={sentinelRef} className="mt-12 flex justify-center">
          <button
            type="button"
            onClick={grow}
            className="text-[12px] uppercase tracking-[0.12em] text-stone-400 transition-colors hover:text-stone-700"
          >
            Show more · {(rest.length - shown.length).toLocaleString()} to go
          </button>
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
          mergeCandidates={mergeCandidates}
          onNeedHeroes={ensureHeroes}
          onMerged={(aliasName, canonicalName) => {
            // Close rather than leave the spotlight pointing at an identity
            // that no longer exists, and hold the undo. The folded tile hides
            // now; the wall's snapshot catches up behind the merge.
            setOpenKey(null);
            setFolded((f) => new Set(f).add(aliasName));
            setMergeUndo({ aliasName, canonicalName });
            router.refresh();
          }}
          onUnmerged={() => {
            setOpenKey(null);
            router.refresh();
          }}
        />
      )}

      {mergeUndo && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-stone-300 bg-white px-4 py-2 text-[13px] text-stone-700 shadow-lg"
        >
          Merged <span className="text-stone-900">{mergeUndo.aliasName}</span> into{" "}
          <span className="text-stone-900">{mergeUndo.canonicalName}</span>
          <button
            type="button"
            onClick={async () => {
              const alias = mergeUndo.aliasName;
              setMergeUndo(null);
              setFolded((f) => {
                const next = new Set(f);
                next.delete(alias);
                return next;
              });
              await fetch(`/api/people/aliases?aliasName=${encodeURIComponent(alias)}`, {
                method: "DELETE",
              });
              router.refresh();
            }}
            className="ml-3 text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={() => setMergeUndo(null)}
            aria-label="Dismiss"
            className="ml-3 text-stone-400 hover:text-stone-700"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Podium: bigger frame, editorial numeral, and the event chips ─── */
function PodiumCard({
  person,
  hero,
  place,
  onOpen,
  onNotAPerson,
}: {
  person: PersonCard;
  hero?: Hero;
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
        {hero ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={hero.lg ?? hero.md}
            srcSet={hero.lg ? `${hero.md} 400w, ${hero.lg} 800w` : undefined}
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
  hero,
  onOpen,
  onNotAPerson,
}: {
  person: PersonCard;
  hero?: Hero;
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
        {hero ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={hero.md}
            srcSet={hero.lg ? `${hero.md} 400w, ${hero.lg} 800w` : undefined}
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
