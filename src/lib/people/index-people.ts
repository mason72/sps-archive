/**
 * Archive-wide people index — every person the photographer has photographed,
 * across every event, keyed on the name their filenames carry.
 *
 * Identity comes from `personNameFromParts` (the SAME helper the gallery
 * stacks and auto-sections use) so "who is this" can never mean two different
 * things in two places — the drift that produced the "AaronCote Appfolio"
 * stacks bug.
 *
 * The "wall of fame" is not a separate feature: it's this list ranked by
 * event count. Measured 2026-08-10, the archive held 1,570 named people and
 * exactly ONE with two events (the migration is partial), so a repeat-only
 * page would have shipped empty. Index everyone; the ranking fills in.
 */

import type { createServiceClient } from "@/lib/supabase/server";
import { displayName, personNameFromParts } from "@/lib/gallery/stacks";

type SupabaseDB = ReturnType<typeof createServiceClient>;

/**
 * Galleries that duplicate the same marketing photos across each other. Their
 * filenames parse into venues and clients ("MOSCONE CENTER", "Stripe BTS"),
 * which otherwise dominate the leaderboard — the first draft of this query
 * reported them as the four most-photographed "people" in the archive.
 */
export const NON_PERSON_GALLERIES = new Set([
  "TDP Website",
  "TDP Work",
  "Two Dudes Sample Images",
  "Two Dudes Samples",
]);

/**
 * A parsed name that looks like a human: two+ words, each starting with a
 * letter, no digits. Camera codes ("IMG_4532"), venues ("MOSCONE CENTER" —
 * all caps, admitted deliberately since real names can be capitalised) and
 * tags ("GitHub Universe5") mostly fall out here; the gallery exclusion above
 * catches the rest.
 */
export function looksLikePersonName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 4 || /\d/.test(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  return words.length >= 2 && words.every((w) => /^[A-Za-z][A-Za-z'’.-]*$/.test(w));
}

export interface PersonEventAppearance {
  eventId: string;
  eventName: string;
  eventDate: string | null;
  imageCount: number;
  /** Best frame from THIS event (highest aesthetic score). */
  heroImageId: string | null;
  heroKey: string | null;
}

export interface IndexedPerson {
  /** Normalized key (lowercased, punctuation-stripped) — the identity. */
  key: string;
  /** Display name, taken from the most recent appearance. */
  name: string;
  eventCount: number;
  imageCount: number;
  /** Chronological, oldest first — the "time strip". */
  events: PersonEventAppearance[];
  /** Overall best frame across every event. */
  heroKey: string | null;
}

export { displayName };

export function normalizeNameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * Of two spellings of the SAME identity, the one to show a human.
 * Person-like ("Brittany Reed") always beats a run-together filename blob
 * ("brittanyreed"); between two of the same kind, the longer one carries more
 * information. Order-independent, so the label doesn't depend on which shoot
 * the scan reached first.
 */
export function preferredSpelling(a: string, b: string): string {
  const aPerson = looksLikePersonName(a);
  const bPerson = looksLikePersonName(b);
  if (aPerson !== bPerson) return aPerson ? a : b;
  return b.length > a.length ? b : a;
}

/**
 * The identity of the person in one photo, as a comparable key — the whole
 * chain (parse → normalize) in one place.
 *
 * Anything that asks "is this photo this person's" must call THIS: the index
 * that counts them, the detail builder behind the spotlight, and the event
 * page resolving a `?person=` deep link. Three call sites re-typing
 * `normalizeNameKey(personNameFromParts(...))` is three chances for the chip
 * to promise 77 photos and the event to show 0.
 */
export function personKeyForImage(
  parsedName: string | null | undefined,
  originalFilename: string
): string {
  return normalizeNameKey(
    personNameFromParts(parsedName, originalFilename)?.trim() ?? ""
  );
}

export interface PersonDetailImage {
  id: string;
  r2Key: string;
  filename: string;
  aestheticScore: number | null;
}

export interface PersonDetailEvent {
  eventId: string;
  eventName: string;
  eventDate: string | null;
  /** Best-first — the spotlight leads with the frame worth leading with. */
  images: PersonDetailImage[];
}

export interface PersonDetail {
  key: string;
  name: string;
  imageCount: number;
  events: PersonDetailEvent[];
}

/**
 * Every photo of ONE person, across every event — what the spotlight shows.
 *
 * Identity is still `personNameFromParts` + `normalizeNameKey`, exactly as in
 * the index, so the count here always equals the count on the tile you clicked.
 * The SQL `ilike` is a CANDIDATE filter and nothing more: it narrows 17k rows
 * to a handful before the real membership test runs in TypeScript. Widening it
 * can only cost time; it can never change who belongs, which is the property
 * that keeps the identity rule single-homed.
 */
/**
 * Identities the photographer has said are NOT people.
 *
 * A filename produces convincing fake names — "Twodudes Arizona" (a filename
 * prefix that arrived with 439 conference photos and became the archive's
 * most-photographed "person"), "Jordan BackToSchool Banner.ai" (an Illustrator
 * artboard). Both are two capitalised words with no digits, which is precisely
 * what a real name looks like, so no amount of pattern-tightening separates
 * them. The only reliable signal is a human saying so once.
 *
 * Returns the NORMALISED keys, so excluding one spelling excludes them all.
 * Fails LOUD: a failed read here would silently re-admit every non-person the
 * photographer has already dismissed, which reads as the feature not working.
 */
export async function loadExcludedPersonKeys(
  supabase: SupabaseDB,
  userId: string
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("excluded_people")
    .select("person_key")
    .eq("user_id", userId);
  if (error) throw error;
  return new Set((data ?? []).map((r: { person_key: string }) => r.person_key));
}

export async function buildPersonDetail(
  supabase: SupabaseDB,
  userId: string,
  name: string
): Promise<PersonDetail | null> {
  const key = normalizeNameKey(name);
  if (!key) return null;

  const { data: events, error: eventsError } = await supabase
    .from("events")
    .select("id, name, event_date")
    .eq("user_id", userId);
  if (eventsError) throw eventsError;

  const eventById = new Map(
    (events ?? [])
      .filter((e) => !NON_PERSON_GALLERIES.has(e.name))
      .map((e) => [e.id, e])
  );
  if (eventById.size === 0) return null;

  // Longest word — the most selective token, and the one least likely to be an
  // initial. PostgREST `or` needs the value inline, so strip anything that
  // could terminate the filter expression.
  const token = name
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z]/g, ""))
    .sort((a, b) => b.length - a.length)[0];
  if (!token || token.length < 2) return null;

  const PAGE = 1000;
  type Row = {
    id: string;
    event_id: string;
    r2_key: string;
    parsed_name: string | null;
    original_filename: string;
    aesthetic_score: number | null;
  };
  const rows: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("images")
      .select("id, event_id, r2_key, parsed_name, original_filename, aesthetic_score")
      .in("event_id", [...eventById.keys()])
      .eq("media_type", "image")
      // Presign-created rows exist BEFORE their bytes do. Counting them
      // promises photos the gallery can't show — Jeff Roark's tile said 77
      // when 9 were ghosts from a died-mid-upload session, and the spotlight
      // rendered them as blank tiles.
      .eq("processing_status", "complete")
      .or(`parsed_name.ilike.%${token}%,original_filename.ilike.%${token}%`)
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < PAGE) break;
  }

  const byEvent = new Map<string, PersonDetailEvent>();
  let display = name;
  let count = 0;

  for (const row of rows) {
    if (personKeyForImage(row.parsed_name, row.original_filename) !== key) continue;
    const parsed = personNameFromParts(row.parsed_name, row.original_filename).trim();
    const ev = eventById.get(row.event_id);
    if (!ev) continue;
    // Same spelling rule as the index — the two must agree on her label as
    // well as her count.
    display = preferredSpelling(display, parsed);

    const group =
      byEvent.get(row.event_id) ??
      ({
        eventId: ev.id,
        eventName: ev.name,
        eventDate: ev.event_date,
        images: [],
      } satisfies PersonDetailEvent);
    group.images.push({
      id: row.id,
      r2Key: row.r2_key,
      filename: row.original_filename,
      aestheticScore: row.aesthetic_score,
    });
    byEvent.set(row.event_id, group);
    count += 1;
  }

  if (count === 0) return null;

  const grouped = [...byEvent.values()].sort((a, b) => {
    // Newest shoot first here — the index's time strip reads as history,
    // but a spotlight opens on the most recent work.
    const ad = a.eventDate ?? "";
    const bd = b.eventDate ?? "";
    if (ad && bd) return bd.localeCompare(ad);
    return a.eventName.localeCompare(b.eventName);
  });
  for (const g of grouped) {
    g.images.sort((a, b) => (b.aestheticScore ?? 0) - (a.aestheticScore ?? 0));
  }

  return { key, name: displayName(display), imageCount: count, events: grouped };
}

/**
 * Build the index for one photographer. One paged scan of their images —
 * grouping happens here rather than in SQL because the identity rule lives in
 * TypeScript (personNameFromParts), and duplicating it as SQL is exactly the
 * two-homes drift this module exists to avoid.
 */
export async function buildPeopleIndex(
  supabase: SupabaseDB,
  userId: string
): Promise<IndexedPerson[]> {
  const excluded = await loadExcludedPersonKeys(supabase, userId);
  const { data: events, error: eventsError } = await supabase
    .from("events")
    .select("id, name, event_date")
    .eq("user_id", userId);
  if (eventsError) throw eventsError;

  const eventById = new Map(
    (events ?? [])
      .filter((e) => !NON_PERSON_GALLERIES.has(e.name))
      .map((e) => [e.id, e])
  );
  if (eventById.size === 0) return [];

  const PAGE = 1000;
  type Row = {
    id: string;
    event_id: string;
    r2_key: string;
    parsed_name: string | null;
    original_filename: string;
    aesthetic_score: number | null;
  };
  // Count first, then pull every page CONCURRENTLY. Sequential paging meant
  // ~18 round-trips before a single face could render, each waiting on the
  // last for no reason — the dominant cost of loading /people.
  const { count: rowCount, error: countError } = await supabase
    .from("images")
    .select("id", { count: "exact", head: true })
    .in("event_id", [...eventById.keys()])
    .eq("media_type", "image")
    .eq("processing_status", "complete");
  if (countError) throw countError;

  const rows: Row[] = [];
  const pages = await Promise.all(
    Array.from({ length: Math.ceil((rowCount ?? 0) / PAGE) }, (_, i) =>
      supabase
        .from("images")
        .select("id, event_id, r2_key, parsed_name, original_filename, aesthetic_score")
        .in("event_id", [...eventById.keys()])
        .eq("media_type", "image")
        // Presign-created rows exist BEFORE their bytes do. Counting them
        // promises photos the gallery can't show — Jeff Roark's tile said 77
        // when 9 were ghosts from a died-mid-upload session, and the spotlight
        // rendered them as blank tiles.
        .eq("processing_status", "complete")
        .range(i * PAGE, i * PAGE + PAGE - 1)
    )
  );
  for (const page of pages) {
    if (page.error) throw page.error;
    rows.push(...((page.data ?? []) as Row[]));
  }

  // person key → event id → appearance
  const people = new Map<
    string,
    { name: string; events: Map<string, PersonEventAppearance & { bestScore: number }> }
  >();

  // Pass 1: which identities has the corpus SPELLED like a person somewhere?
  //
  // `looksLikePersonName` needs two words, and a filename like
  // "brittanyreed_26-07-14_Appfolio_2237.jpg" has no camel boundary to split
  // on — so her July shoot parsed to one lowercase blob and was thrown away,
  // while the same person's "Brittany Reed_26-08-05_..." files survived. She
  // showed as one event instead of two. Both spellings normalize to the SAME
  // key, so the corpus can vouch for the blob: admit it only when some other
  // photo, anywhere in the archive, writes that identity person-like. No new
  // threshold, and a venue can't sneak in unless it also appears as a
  // plausible human name elsewhere.
  const parsedByRow = new Map<string, { name: string; key: string }>();
  const vouched = new Set<string>();
  for (const row of rows) {
    const name = personNameFromParts(row.parsed_name, row.original_filename)?.trim();
    if (!name) continue;
    const key = normalizeNameKey(name);
    if (!key) continue;
    parsedByRow.set(row.id, { name, key });
    // An excluded key never gets vouched, so it cannot become an identity —
    // cheaper and more total than filtering the finished list, and it keeps the
    // exclusion out of every downstream count as well as the display.
    if (!excluded.has(key) && looksLikePersonName(name)) vouched.add(key);
  }

  for (const row of rows) {
    const parsedRow = parsedByRow.get(row.id);
    if (!parsedRow) continue;
    const { name, key } = parsedRow;
    if (!vouched.has(key)) continue;
    const ev = eventById.get(row.event_id);
    if (!ev) continue;

    const person = people.get(key) ?? { name, events: new Map() };
    // Display name: a person-like spelling ALWAYS beats a blob, and among
    // equals the longest wins. Never show "brittanyreed" when the archive
    // also contains "Brittany Reed" — leaving this to string length alone
    // makes the label depend on which shoot happened to be longer.
    person.name = preferredSpelling(person.name, name);

    const appearance =
      person.events.get(row.event_id) ??
      ({
        eventId: ev.id,
        eventName: ev.name,
        eventDate: ev.event_date,
        imageCount: 0,
        heroImageId: null,
        heroKey: null,
        bestScore: -1,
      } as PersonEventAppearance & { bestScore: number });

    appearance.imageCount += 1;
    const score = row.aesthetic_score ?? 0;
    if (score > appearance.bestScore) {
      appearance.bestScore = score;
      appearance.heroImageId = row.id;
      appearance.heroKey = row.r2_key;
    }
    person.events.set(row.event_id, appearance);
    people.set(key, person);
  }

  const indexed: IndexedPerson[] = [];
  for (const [key, person] of people) {
    const events = [...person.events.values()].sort((a, b) => {
      // Oldest first — the time strip reads left-to-right as a history.
      const ad = a.eventDate ?? "";
      const bd = b.eventDate ?? "";
      if (ad && bd) return ad.localeCompare(bd);
      return a.eventName.localeCompare(b.eventName);
    });
    const best = events.reduce<PersonEventAppearance & { bestScore?: number }>(
      (acc, e) =>
        ((e as PersonEventAppearance & { bestScore: number }).bestScore ?? 0) >
        ((acc as { bestScore?: number }).bestScore ?? -1)
          ? e
          : acc,
      events[0]
    );
    indexed.push({
      key,
      name: displayName(person.name),
      eventCount: events.length,
      imageCount: events.reduce((n, e) => n + e.imageCount, 0),
      events: events.map(({ ...e }) => e),
      heroKey: best?.heroKey ?? null,
    });
  }

  // Default order: most events first (the wall of fame), then most photos,
  // then alphabetical so ties are stable across reloads.
  indexed.sort(
    (a, b) =>
      b.eventCount - a.eventCount ||
      b.imageCount - a.imageCount ||
      a.name.localeCompare(b.name)
  );
  return indexed;
}
