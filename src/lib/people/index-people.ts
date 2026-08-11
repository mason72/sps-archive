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
import { personNameFromParts } from "@/lib/gallery/stacks";

type SupabaseDB = ReturnType<typeof createServiceClient>;

/**
 * Galleries that duplicate the same marketing photos across each other. Their
 * filenames parse into venues and clients ("MOSCONE CENTER", "Stripe BTS"),
 * which otherwise dominate the leaderboard — the first draft of this query
 * reported them as the four most-photographed "people" in the archive.
 */
const NON_PERSON_GALLERIES = new Set([
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

/**
 * Display casing. Filenames arrive shouted or lowercased ("ANDREW MC CARTNEY",
 * "andrew dorman") and a wall of those reads like a spreadsheet. Title-case
 * ONLY when the whole name is single-case — mixed case is left exactly as
 * typed, because that's where the real ones live (McCartney, de Vries, O'Neil)
 * and "fixing" them is how you misspell someone's name on a wall of fame.
 */
export function displayName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  const isSingleCase =
    trimmed === trimmed.toLowerCase() || trimmed === trimmed.toUpperCase();
  if (!isSingleCase) return trimmed;
  return trimmed
    .split(" ")
    .map((w) =>
      w
        // Hyphenated and apostrophe'd parts each get their own capital
        // (Anne-Marie, O'Neil).
        .split(/([-'’])/)
        .map((part) =>
          /^[-'’]$/.test(part)
            ? part
            : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
        )
        .join("")
    )
    .join(" ");
}

export function normalizeNameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "");
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
  const rows: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("images")
      .select("id, event_id, r2_key, parsed_name, original_filename, aesthetic_score")
      .in("event_id", [...eventById.keys()])
      .eq("media_type", "image")
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < PAGE) break;
  }

  // person key → event id → appearance
  const people = new Map<
    string,
    { name: string; events: Map<string, PersonEventAppearance & { bestScore: number }> }
  >();

  for (const row of rows) {
    const name = personNameFromParts(row.parsed_name, row.original_filename)?.trim();
    if (!name || !looksLikePersonName(name)) continue;
    const key = normalizeNameKey(name);
    if (!key) continue;
    const ev = eventById.get(row.event_id);
    if (!ev) continue;

    const person = people.get(key) ?? { name, events: new Map() };
    // Keep the most complete-looking spelling (longest) as the display name.
    if (name.length > person.name.length) person.name = name;

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
