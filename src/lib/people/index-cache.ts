/**
 * The /people index, cached in R2 — built once, served many times.
 *
 * Measured 2026-09-11: a cold `buildPeopleIndex` took 26s even from a machine
 * next to the database (≈190 parallel OFFSET pages over ≈190k photos, each
 * averaging 925ms in pg_stat_statements — the single biggest consumer of
 * database time since February) and produced 4.4 MB of JSON. /people ran it
 * on EVERY visit, so the page took 57s. The index only changes when photos
 * land or a human names, merges or excludes someone; rebuilding it per visit
 * bought nothing.
 *
 * Stale-while-revalidate. A snapshot is served whenever one exists. Rebuilds
 * run as ONE Inngest job per photographer at a time (`people-index-refresh`),
 * requested by every write that changes who is on the wall and by any read of
 * a snapshot older than PEOPLE_INDEX_FRESH_MS. One-at-a-time is the point: a
 * build that joined one already running, or two that overlapped and finished
 * out of order, would store a snapshot older than the write that asked for it
 * — "Not a person" then Undo would leave the restored person missing. Caught in
 * review before it shipped.
 *
 * Exclusions are ALSO applied at read time, so "Not a person" holds on the very
 * next load instead of after the rebuild lands; merges and confirms lag one
 * rebuild.
 *
 * R2, not Next's data cache: it is one ~4 MB blob, and R2 is already this
 * app's blob store — no new service and no per-item size question.
 *
 * The cache is an OPTIMIZATION. A failure to read or write it is reported and
 * the page falls back to a live build — it must never be able to fail the
 * page it exists to speed up.
 */
import { gunzipSync, gzipSync } from "node:zlib";
import { after } from "next/server";

import type { createServiceClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";
import { reportSystemError } from "@/lib/monitoring/report";
import {
  getCachedThumbnailUrl,
  getObjectBuffer,
  getObjectMetadata,
  getThumbnailKey,
  uploadToR2WithMetadata,
} from "@/lib/r2/client";

import { buildPeopleIndex, loadExcludedPersonKeys, type IndexedPerson } from "./index-people";

type SupabaseDB = ReturnType<typeof createServiceClient>;

/** Bump when IndexedPerson changes shape — older snapshots are then never read. */
const SNAPSHOT_VERSION = 1;
/** A snapshot older than this is served once more and a rebuild is requested. */
export const PEOPLE_INDEX_FRESH_MS = 10 * 60 * 1000;
/**
 * Per-instance reuse for the hero route, which reads the snapshot once per
 * scroll batch and needs only each person's hero key. Pages never use it: a
 * page read must see a rebuild that landed a second ago on another instance.
 */
const MEMO_MS = 60 * 1000;

interface Snapshot {
  builtAt: number;
  people: IndexedPerson[];
}

const snapshotKey = (userId: string) =>
  `cache/people-index/v${SNAPSHOT_VERSION}/${userId}.json.gz`;

const memo = new Map<string, { snap: Snapshot; readAt: number }>();
const coldBuilds = new Map<string, Promise<Snapshot>>();

async function readSnapshot(userId: string, allowMemo: boolean): Promise<Snapshot | null> {
  const hit = memo.get(userId);
  if (allowMemo && hit && Date.now() - hit.readAt < MEMO_MS) return hit.snap;
  try {
    const buf = await getObjectBuffer(snapshotKey(userId));
    const snap = JSON.parse(gunzipSync(buf).toString("utf8")) as Snapshot;
    memo.set(userId, { snap, readAt: Date.now() });
    return snap;
  } catch (err) {
    // No snapshot yet is the normal first visit, not an error (verified: R2
    // answers a missing key with NoSuchKey, 2026-09-11).
    if ((err as { name?: string } | null)?.name !== "NoSuchKey") {
      await reportSystemError("people.index-cache.read", err, { userId });
    }
    return null;
  }
}

async function buildSnapshot(supabase: SupabaseDB, userId: string): Promise<Snapshot> {
  // Stamped at the START: the snapshot is as old as the first row it read.
  const builtAt = Date.now();
  return { builtAt, people: await buildPeopleIndex(supabase, userId) };
}

/**
 * Store, unless a NEWER snapshot is already there. The Inngest job never
 * overlaps itself, but a cold page build can overlap it, and the older of the
 * two must not have the last word.
 */
async function storeSnapshot(userId: string, snap: Snapshot): Promise<boolean> {
  const key = snapshotKey(userId);
  const meta = await getObjectMetadata(key);
  if (Number(meta?.builtat ?? 0) > snap.builtAt) return false;
  await uploadToR2WithMetadata(key, gzipSync(JSON.stringify(snap)), "application/gzip", {
    builtat: String(snap.builtAt),
  });
  memo.set(userId, { snap, readAt: Date.now() });
  return true;
}

/**
 * The Inngest job's entry point. A failure to store fails the run, so Inngest
 * retries it — this is the one caller whose whole purpose is the write.
 */
export async function rebuildPeopleIndexSnapshot(
  supabase: SupabaseDB,
  userId: string
): Promise<{ people: number; stored: boolean }> {
  const snap = await buildSnapshot(supabase, userId);
  const stored = await storeSnapshot(userId, snap);
  return { people: snap.people.length, stored };
}

/**
 * No snapshot at all (a first visit, or a version bump): build inline.
 * Concurrent first visits on one instance share the build — all of them are
 * reads, so sharing cannot hide a write.
 */
function coldBuild(supabase: SupabaseDB, userId: string): Promise<Snapshot> {
  const running = coldBuilds.get(userId);
  if (running) return running;
  const job = (async () => {
    const snap = await buildSnapshot(supabase, userId);
    try {
      await storeSnapshot(userId, snap);
    } catch (err) {
      await reportSystemError("people.index-cache.write", err, { userId });
    }
    return snap;
  })().finally(() => coldBuilds.delete(userId));
  coldBuilds.set(userId, job);
  return job;
}

export interface PeopleIndexRead {
  people: IndexedPerson[];
  /** When the served snapshot was built — shown on the page, never hidden. */
  builtAt: number;
}

export async function getPeopleIndex(
  supabase: SupabaseDB,
  userId: string
): Promise<PeopleIndexRead> {
  const [snap, excluded] = await Promise.all([
    readSnapshot(userId, false),
    loadExcludedPersonKeys(supabase, userId),
  ]);
  const served = snap ?? (await coldBuild(supabase, userId));
  if (snap && Date.now() - snap.builtAt > PEOPLE_INDEX_FRESH_MS) {
    // Asked for after the response, so the stale page is not held up by it.
    after(() => requestPeopleIndexRefresh(userId));
  }
  return {
    people: served.people.filter((p) => !excluded.has(p.key)),
    builtAt: served.builtAt,
  };
}

/**
 * The snapshot or nothing — never a build and never a refresh. For the hero
 * route, which runs once per scroll batch: letting it build would turn a
 * stale snapshot into a 26-second scan per batch per instance.
 */
export async function readPeopleIndexSnapshot(userId: string): Promise<IndexedPerson[] | null> {
  return (await readSnapshot(userId, true))?.people ?? null;
}

/**
 * Ask for a rebuild. Every write that changes who is on the wall calls this —
 * aliases, rename, confirm, exclude and its undo. Best-effort (the write
 * stands either way) but never silent; the 10-minute staleness check is the
 * backstop.
 */
export async function requestPeopleIndexRefresh(userId: string): Promise<void> {
  try {
    await inngest.send({ name: "people/index-refresh.requested", data: { userId } });
  } catch (err) {
    await reportSystemError("people.index-cache.request", err, { userId });
  }
}

export interface HeroUrls {
  md: string;
  lg: string;
}

/**
 * A person's hero frame, both renditions. Deterministic signing (see
 * getCachedThumbnailUrl), so the same face is the same URL across loads and
 * the browser cache actually holds.
 */
export async function heroUrlsFor(heroKey: string): Promise<HeroUrls> {
  const [md, lg] = await Promise.all([
    getCachedThumbnailUrl(getThumbnailKey(heroKey), 14400),
    getCachedThumbnailUrl(getThumbnailKey(heroKey, "thumb-lg"), 14400),
  ]);
  return { md, lg };
}
