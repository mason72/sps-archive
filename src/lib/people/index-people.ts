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
import { loadAliasResolver } from "./aliases";
import { loadFaceMembership } from "./face-membership";

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
  /** Other spellings merged into this identity — shown so a merge is visible
   *  and undoable, never silent. Empty for the un-merged common case. */
  aliases: string[];
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
  const rawKey = normalizeNameKey(name);
  if (!rawKey) return null;

  // Fold to the canonical identity — the SAME resolver the index folds with,
  // so the tile you clicked and the card that opens agree on who exists.
  const aliases = await loadAliasResolver(supabase, userId);
  const key = aliases.resolve(rawKey);
  // Every spelling the merge recorded. The requested name rides along for the
  // un-merged common case (no alias rows know it).
  const groupSpellings = [...new Set([name, ...aliases.groupNames(key)])];

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

  // Longest word per SPELLING — a merged identity's photos carry any of its
  // spellings, and one spelling's token can miss another's files entirely
  // ("Bob Smith" files don't contain "Robert"). The candidate filter widens to
  // an OR across every spelling's most selective token; membership below still
  // decides. PostgREST `or` needs values inline, so strip anything that could
  // terminate the filter expression.
  const tokens = [
    ...new Set(
      groupSpellings
        .map(
          (s) =>
            s
              .split(/\s+/)
              .map((w) => w.replace(/[^A-Za-z]/g, ""))
              .sort((a, b) => b.length - a.length)[0]
        )
        .filter((t): t is string => !!t && t.length >= 2)
    ),
  ];
  if (tokens.length === 0) return null;
  const candidateFilter = tokens
    .flatMap((t) => [`parsed_name.ilike.%${t}%`, `original_filename.ilike.%${t}%`])
    .join(",");

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
      .or(candidateFilter)
      // Same reason as the index scan above: OFFSET paging without an ORDER BY
      // has no defined page boundaries, so rows can repeat or vanish between
      // pages. This path only paginates for people with 1,000+ frames, which
      // is exactly when a wrong count would be least obvious.
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < PAGE) break;
  }

  // Group shots this person is IN — the same resolver the index counts with.
  // Fetched as its own set because the `ilike` candidate filter above is keyed
  // on the person's NAME, and a group shot carries somebody else's name or
  // none at all, so it can never appear in `rows`.
  const faceMembership = await loadFaceMembership(supabase, [...eventById.keys()]);
  // Union across every key in the identity group — a cluster may be named
  // with the alias spelling.
  const faceImageIds = new Set<string>();
  for (const k of aliases.groupKeys(key)) {
    for (const id of faceMembership.get(k) ?? []) faceImageIds.add(id);
  }

  const byEvent = new Map<string, PersonDetailEvent>();
  let display = name;
  let count = 0;
  const counted = new Set<string>();

  for (const row of rows) {
    if (aliases.resolve(personKeyForImage(row.parsed_name, row.original_filename)) !== key)
      continue;
    counted.add(row.id);
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

  // Group shots. Fetched by id, because they are exactly the frames the
  // name-keyed candidate filter above cannot reach.
  const extraIds = [...faceImageIds].filter((id) => !counted.has(id));
  for (let i = 0; i < extraIds.length; i += 200) {
    const slice = extraIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from("images")
      .select("id, event_id, r2_key, original_filename, aesthetic_score")
      .in("id", slice)
      .eq("media_type", "image")
      .eq("processing_status", "complete");
    if (error) throw error;
    for (const row of data ?? []) {
      const ev = eventById.get(row.event_id);
      if (!ev) continue;
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

  const finalName = displayName(display);
  return {
    key,
    name: finalName,
    imageCount: count,
    events: grouped,
    aliases: groupSpellings.filter(
      (s) => normalizeNameKey(s) !== normalizeNameKey(finalName)
    ),
  };
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

  // "Who is IN the frame" — group shots. Same resolver the card uses, so the
  // tile's number and the card's grid can never disagree.
  const faceMembership = await loadFaceMembership(supabase, [...eventById.keys()]);

  // Human-confirmed identity merges: alias keys fold into their canonical
  // EVERYWHERE a key is minted below (filename pass AND face membership), so a
  // merged person is one tile with combined counts. Exclusions are checked on
  // the folded key — excluding an identity excludes all its spellings.
  const aliases = await loadAliasResolver(supabase, userId);

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
  //
  // ⚠️ Every page MUST carry `.order("id")`. `range()` is OFFSET/LIMIT, and
  // Postgres gives no row order without an ORDER BY — its synchronized
  // sequential scans deliberately start a new scan wherever a concurrent one
  // already is, so 39 parallel pages can each see the table differently.
  // Pages then overlap and leave gaps: measured 2026-08-15, two runs in five
  // fetched one page twice (and 7,521 rows twice in the worst case), which is
  // how Jenna Loeser's tile read 64 photos for a 35-photo shoot while Steven
  // Hughes lost one to a gap. Dedupe below is the belt to this braces —
  // over-counting is the lie a human sees.
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
        .order("id")
        .range(i * PAGE, i * PAGE + PAGE - 1)
    )
  );
  const seenRowIds = new Set<string>();
  for (const page of pages) {
    if (page.error) throw page.error;
    for (const row of (page.data ?? []) as Row[]) {
      if (seenRowIds.has(row.id)) continue;
      seenRowIds.add(row.id);
      rows.push(row);
    }
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
    // Fold aliases HERE, where the key is minted — everything downstream
    // (vouching, counting, face membership, exclusion) sees only canonicals.
    const key = aliases.resolve(normalizeNameKey(name));
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

  // Pass 3: photos this person is IN, from the face clusters — group shots.
  //
  // A frame the filename already attributes to this identity was counted
  // above; adding it again is the double-count of lesson 88 wearing a
  // different hat, so `seenPerKey` is the guard. Only VOUCHED identities are
  // admitted: a cluster name reaching an identity the filename corpus never
  // spelled person-like would import the venue and banner names that
  // `looksLikePersonName` exists to keep off this page.
  const seenPerKey = new Map<string, Set<string>>();
  for (const row of rows) {
    const parsedRow = parsedByRow.get(row.id);
    if (!parsedRow || !vouched.has(parsedRow.key)) continue;
    const set = seenPerKey.get(parsedRow.key) ?? new Set<string>();
    set.add(row.id);
    seenPerKey.set(parsedRow.key, set);
  }

  const rowById = new Map(rows.map((r) => [r.id, r]));
  for (const [rawKey, imageIds] of faceMembership) {
    // Cluster names mint keys too — fold them through the same aliases, or a
    // cluster named with the alias spelling would strand its group shots on a
    // tile that no longer exists.
    const key = aliases.resolve(rawKey);
    if (!vouched.has(key) || excluded.has(key)) continue;
    const person = people.get(key);
    if (!person) continue;
    const seen = seenPerKey.get(key) ?? new Set<string>();
    for (const imageId of imageIds) {
      if (seen.has(imageId)) continue;
      const row = rowById.get(imageId);
      if (!row) continue; // not a complete image in scope
      const ev = eventById.get(row.event_id);
      if (!ev) continue;
      seen.add(imageId);

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
      // A group shot never becomes the hero: the crop that fronts a card must
      // unambiguously be this person, and a frame with several faces cannot
      // promise that. Solo frames (already counted above) own the hero.
      person.events.set(row.event_id, appearance);
    }
    seenPerKey.set(key, seen);
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
