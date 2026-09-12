/**
 * Don't migrate a shoot that is already in the archive (2026-09-11).
 *
 * The Pixieset migration imported six shoots Mason had ALREADY delivered from
 * Pixeltrunk — 5,231 duplicate frames, cleaned up with
 * scripts/consolidate-duplicates.ts — because the ingest never asks whether a
 * collection is already here. With ~1,200 collections to go, every 2026 shoot
 * he also delivered from Pixeltrunk would do it again.
 *
 * A frame is a TWIN when an existing image shares its capture second AND its
 * exact byte size. Filenames cannot be used: Pixieset's copy carries its own
 * names, which is why a (filename, bytes) scan found only half the pairs.
 *
 * Cost discipline: the check is two-phase, because reading every entry to
 * extract EXIF is only worth it when the collection really is a duplicate.
 *   1. SAMPLE (~40 frames, a second or two): do these capture seconds already
 *      exist, and in which event? A normal collection stops here.
 *   2. FULL (only if one event holds most of the sample): read the rest and
 *      drop the twins, before a single byte is uploaded — uploads are the
 *      migration's bottleneck (~100-200 KB/s up), so skipping beats trimming.
 *
 * It never skips on a guess: a sample match under MIN_SAMPLE_SHARE means
 * "not a duplicate" and the ingest proceeds untouched.
 */
import type { createServiceClient } from "../../src/lib/supabase/server";

type SupabaseDB = ReturnType<typeof createServiceClient>;

/** A frame's fingerprint: capture second + exact bytes. */
const twinKey = (takenAt: string | Date, bytes: number) =>
  `${new Date(takenAt).toISOString()}|${bytes}`;

/** Frames sampled before deciding whether a full check is worth it. */
const SAMPLE = 40;
/** Share of the sample one event must already hold to suspect a duplicate. */
const MIN_SAMPLE_SHARE = 0.6;

export interface TwinScanEntry {
  /** The key the caller uses for this frame (its base filename). */
  base: string;
  /** Read the frame's bytes — called for the sample, then for the rest. */
  read: () => Promise<Buffer>;
}

export interface TwinScanResult {
  /** Bases to leave out of the import. */
  skip: Set<string>;
  /** The event these frames already live in, if one was found. */
  matchedEventId: string | null;
  matchedEventName: string | null;
  sampled: number;
  sampleHits: number;
  /** Frames read but carrying no capture time — never skipped. */
  withoutCaptureTime: number;
}

async function keysFor(
  entries: TwinScanEntry[],
  extractExif: (buffer: ArrayBuffer) => Promise<{ takenAt?: string | Date | null } | null>
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const e of entries) {
    try {
      const buf = await e.read();
      const exif = await extractExif(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
      );
      if (exif?.takenAt) out.set(e.base, twinKey(exif.takenAt, buf.byteLength));
    } catch {
      // A frame we cannot read here is a frame we do not skip. The import path
      // will report it properly if it is genuinely broken.
    }
  }
  return out;
}

/**
 * Which of `entries` are already in the archive. `excludeEventId` is this
 * collection's own event on a resumed run — its rows are this same import.
 */
export async function findTwinsToSkip({
  supabase,
  userId,
  excludeEventId,
  entries,
  extractExif,
  log = () => {},
}: {
  supabase: SupabaseDB;
  userId: string;
  excludeEventId: string | null;
  entries: TwinScanEntry[];
  extractExif: (buffer: ArrayBuffer) => Promise<{ takenAt?: string | Date | null } | null>;
  log?: (line: string) => void;
}): Promise<TwinScanResult> {
  const empty: TwinScanResult = {
    skip: new Set(),
    matchedEventId: null,
    matchedEventName: null,
    sampled: 0,
    sampleHits: 0,
    withoutCaptureTime: 0,
  };
  if (entries.length === 0) return empty;

  // ── 1. sample ──
  const step = Math.max(1, Math.floor(entries.length / SAMPLE));
  const sample: TwinScanEntry[] = [];
  for (let i = 0; i < entries.length && sample.length < SAMPLE; i += step) sample.push(entries[i]);
  const sampleKeys = await keysFor(sample, extractExif);
  if (sampleKeys.size === 0) {
    log(`twin check: ${sample.length} sampled, none carry a capture time — importing everything`);
    return { ...empty, sampled: sample.length, withoutCaptureTime: sample.length };
  }

  const times = [...new Set([...sampleKeys.values()].map((k) => k.split("|")[0]))];
  const { data: hits, error } = await supabase
    .from("images")
    // `images` and `events` are related TWICE (event_id up, cover_image_id
    // back), so the embed MUST name the foreign key or PostgREST refuses it
    // outright (lesson 86 — it failed exactly this way on the first run).
    .select("event_id, taken_at, file_size, events!images_event_id_fkey!inner(user_id, name)")
    .eq("events.user_id", userId)
    .in("taken_at", times)
    .limit(2000);
  if (error) throw error;

  const wanted = new Set(sampleKeys.values());
  const byEvent = new Map<string, { name: string; hits: number }>();
  for (const row of hits ?? []) {
    if (!row.taken_at || row.file_size == null) continue;
    if (excludeEventId && row.event_id === excludeEventId) continue;
    if (!wanted.has(twinKey(row.taken_at, row.file_size))) continue;
    const ev = row.events as unknown as { name: string };
    const cur = byEvent.get(row.event_id) ?? { name: ev.name, hits: 0 };
    cur.hits += 1;
    byEvent.set(row.event_id, cur);
  }
  const best = [...byEvent.entries()].sort((a, b) => b[1].hits - a[1].hits)[0];
  const share = best ? best[1].hits / sampleKeys.size : 0;
  if (!best || share < MIN_SAMPLE_SHARE) {
    log(
      `twin check: ${sampleKeys.size} sampled frames, ${best ? `best match "${best[1].name}" holds ${best[1].hits}` : "no event holds any"} — importing everything`
    );
    return { ...empty, sampled: sampleKeys.size, sampleHits: best?.[1].hits ?? 0 };
  }
  const [matchedEventId, matched] = best;
  log(
    `twin check: "${matched.name}" already holds ${matched.hits} of ${sampleKeys.size} sampled frames — checking every frame`
  );

  // ── 2. full check ──
  const existing = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error: pageErr } = await supabase
      .from("images")
      .select("id, taken_at, file_size")
      .eq("event_id", matchedEventId)
      // Paged reads ORDER BY a unique column, always (lesson 88).
      .order("id")
      .range(from, from + 999);
    if (pageErr) throw pageErr;
    for (const r of data ?? []) {
      if (r.taken_at && r.file_size != null) existing.add(twinKey(r.taken_at, r.file_size));
    }
    if (!data || data.length < 1000) break;
  }

  const allKeys = new Map(sampleKeys);
  const rest = entries.filter((e) => !allKeys.has(e.base));
  for (const [base, key] of await keysFor(rest, extractExif)) allKeys.set(base, key);

  const skip = new Set<string>();
  for (const [base, key] of allKeys) if (existing.has(key)) skip.add(base);
  const withoutCaptureTime = entries.length - allKeys.size;

  return {
    skip,
    matchedEventId,
    matchedEventName: matched.name,
    sampled: sampleKeys.size,
    sampleHits: matched.hits,
    withoutCaptureTime,
  };
}
