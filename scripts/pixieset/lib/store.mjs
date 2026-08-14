/**
 * Queue state for the Pixieset → Pixeltrunk migration.
 *
 * One JSON file, one entry per collection, written atomically. 1,371 entries is
 * far too small to justify SQLite, and a plain file stays greppable when a run
 * goes wrong at 3am — which matters more here than write throughput.
 *
 * The state machine is deliberately linear:
 *
 *   queued → requested → ready → downloaded → verified → ingested
 *                  ↘         ↘          ↘
 *                   └──────── failed ────┘        (retryable, keeps its history)
 *
 * Two rules are load-bearing and encoded here rather than left to callers:
 *
 *  1. A ZIP link expires 7 days after it is REQUESTED. `requested` and `ready`
 *     entries therefore rot. `isExpired()` is the only definition of that, and
 *     `expire()` walks them back to `queued` so a stale link is re-requested
 *     rather than downloaded as a 404. Never hand out a batch larger than can
 *     actually be downloaded inside that window.
 *
 *  2. `photoCount` from the inventory DOUBLE-COUNTS — a photo in two sets is two
 *     records with the same filename. It is an UPPER BOUND, never an equality
 *     target. Any verification that asserts `files === photoCount` will fail on
 *     healthy collections; see `verify()` in watch.mjs.
 */
import { readFile, writeFile, rename, mkdir, stat, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
export const DATA_DIR = join(HERE, "data");
export const QUEUE_PATH = join(DATA_DIR, "queue.json");
const TRIAGE = join(HERE, "..", "triage", "data");

/** Pixieset's ZIP links die after 7 days. One day of slack so we never race it. */
export const EXPIRY_DAYS = 7;
export const EXPIRY_MS = EXPIRY_DAYS * 86400_000;
const SAFE_WINDOW_MS = 6 * 86400_000;

export const STATES = ["queued", "requested", "ready", "downloaded", "verified", "ingested", "failed"];

/** Legal transitions. `failed` is reachable from anywhere and exits back to `queued`. */
const NEXT = {
  queued: ["requested", "failed"],
  requested: ["ready", "queued", "failed"],
  ready: ["downloaded", "queued", "failed"],
  downloaded: ["verified", "failed"],
  verified: ["ingested", "failed"],
  ingested: [],
  failed: ["queued"],
};

const nowIso = () => new Date().toISOString();

/** Read the inventory + triage decisions and derive the keep set. */
export async function loadDecided() {
  const [inv, dec] = await Promise.all([
    readFile(join(TRIAGE, "inventory.json"), "utf8").then(JSON.parse),
    readFile(join(TRIAGE, "decisions.json"), "utf8").then(JSON.parse),
  ]);
  const byId = new Map(inv.map((r) => [String(r[0]), r]));
  const out = [];
  for (const [id, d] of Object.entries(dec)) {
    if (d.verdict !== "keep") continue;
    const row = byId.get(id);
    if (!row) throw new Error(`decision ${id} has no inventory row — refusing to build a partial queue`);
    const [, name, eventDate, photoCount, , slug] = row;
    if (!slug) throw new Error(`collection ${id} (${name}) has no url_key — cannot be downloaded`);
    out.push({
      id,
      slug,
      name,
      eventDate: eventDate || null,
      year: eventDate ? Number(eventDate.slice(0, 4)) : null,
      photoCount: photoCount || 0,
    });
  }
  return out;
}

export async function load() {
  if (!existsSync(QUEUE_PATH)) return null;
  return JSON.parse(await readFile(QUEUE_PATH, "utf8"));
}

/** Atomic write — a half-written queue after a crash would be worse than none. */
export async function save(queue) {
  await mkdir(DATA_DIR, { recursive: true });
  queue.updatedAt = nowIso();
  const tmp = `${QUEUE_PATH}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(queue, null, 2));
  await rename(tmp, QUEUE_PATH);
  return queue;
}

const LOCK = `${QUEUE_PATH}.lock`;

/**
 * Read-modify-write the queue under an exclusive lock.
 *
 * The atomic write above makes each SAVE safe; it does nothing about two
 * processes reading the same queue, each editing its own copy, and the second
 * write erasing the first. That is not hypothetical — running the watcher and
 * the ingest loop together silently reverted two collections from `verified`
 * back to `queued` (2026-08-14). The state was wrong in the direction that
 * causes a re-download of something already on disk.
 *
 * `wx` is the lock: an exclusive create fails if the file exists, which is
 * atomic on every filesystem we care about. The PID goes inside so a stale lock
 * can be identified, and any lock older than the timeout is broken rather than
 * deadlocking the pipeline forever — a crashed process must not stop the queue.
 */
export async function withQueue(mutate, { timeoutMs = 30000, staleMs = 120000 } = {}) {
  await mkdir(DATA_DIR, { recursive: true });
  const started = Date.now();
  for (;;) {
    try {
      await writeFile(LOCK, String(process.pid), { flag: "wx" });
      break;
    } catch (err) {
      if (err?.code !== "EEXIST") throw err;
      const age = await stat(LOCK).then((s) => Date.now() - s.mtimeMs).catch(() => Infinity);
      if (age > staleMs) {
        await rm(LOCK, { force: true });   // holder died; do not deadlock the pipeline
        continue;
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error(`queue lock held for ${Math.round(age / 1000)}s — another pixieset process is running`);
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  try {
    // Re-read INSIDE the lock. Anything loaded before it is already stale.
    const queue = await load();
    if (!queue) throw new Error("no queue to mutate");
    const result = await mutate(queue);
    await save(queue);
    return result;
  } finally {
    await rm(LOCK, { force: true });
  }
}

/**
 * Build the queue from the triage decisions. Oldest-first: pre-2024 is the
 * at-risk set where Pixieset is the only copy, so it earns the front of the line.
 * Undated collections sort last rather than being dropped.
 */
export async function build({ onlyAtRisk = false } = {}) {
  const decided = await loadDecided();
  const chosen = onlyAtRisk ? decided.filter((c) => c.year !== null && c.year < 2024) : decided;
  chosen.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || String(a.eventDate).localeCompare(String(b.eventDate)));

  const collections = {};
  for (const c of chosen) {
    collections[c.id] = {
      ...c,
      state: "queued",
      atRisk: c.year !== null && c.year < 2024,
      attempts: 0,
      requestedAt: null,
      zips: [],       // { url, filename, part, of }
      files: null,    // verified JPEG count from the archive
      bytes: null,
      error: null,
      history: [{ state: "queued", at: nowIso() }],
    };
  }
  return save({ version: 1, createdAt: nowIso(), updatedAt: nowIso(), collections });
}

export function get(queue, id) {
  const c = queue.collections[String(id)];
  if (!c) throw new Error(`collection ${id} is not in the queue`);
  return c;
}

/** Move a collection to a new state, rejecting transitions the machine forbids. */
export function transition(queue, id, state, patch = {}) {
  const c = get(queue, id);
  if (!STATES.includes(state)) throw new Error(`unknown state "${state}"`);
  if (c.state !== state && !NEXT[c.state].includes(state)) {
    throw new Error(`illegal transition for ${id}: ${c.state} → ${state}`);
  }
  Object.assign(c, patch, { state });
  if (state === "queued") { c.requestedAt = null; c.zips = []; }
  if (state !== "failed") c.error = null;
  c.history.push({ state, at: nowIso(), ...(patch.error ? { error: patch.error } : {}) });
  return c;
}

/** True once a requested ZIP link is too old to trust. The ONLY expiry definition. */
export function isExpired(c, now = Date.now()) {
  if (!c.requestedAt) return false;
  if (c.state !== "requested" && c.state !== "ready") return false;
  return now - Date.parse(c.requestedAt) > EXPIRY_MS;
}

/** Walk every rotted link back to `queued` so it gets re-requested, not 404'd. */
export function expire(queue, now = Date.now()) {
  const expired = [];
  for (const c of Object.values(queue.collections)) {
    if (!isExpired(c, now)) continue;
    transition(queue, c.id, "queued", { error: null });
    expired.push(c.id);
  }
  return expired;
}

/**
 * The next collections to request, oldest-first.
 *
 * `limit` exists because of the 7-day expiry: requesting more than the
 * downloader can drain inside a week guarantees re-requesting. Callers should
 * size it from measured throughput, not optimism.
 */
export function nextBatch(queue, { limit = 25, atRiskOnly = false } = {}) {
  return Object.values(queue.collections)
    .filter((c) => c.state === "queued" && (!atRiskOnly || c.atRisk))
    .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || String(a.eventDate).localeCompare(String(b.eventDate)))
    .slice(0, limit);
}

/** Counts by state, plus the numbers worth watching during a long run. */
export function summarize(queue, now = Date.now()) {
  const all = Object.values(queue.collections);
  const byState = Object.fromEntries(STATES.map((s) => [s, 0]));
  let photos = 0, done = 0, files = 0, bytes = 0, expiring = 0;
  for (const c of all) {
    byState[c.state]++;
    photos += c.photoCount;
    if (c.files != null) files += c.files;
    if (c.bytes != null) bytes += c.bytes;
    if (c.state === "ingested") done += c.photoCount;
    if (c.requestedAt && (c.state === "requested" || c.state === "ready")) {
      const age = now - Date.parse(c.requestedAt);
      if (age > SAFE_WINDOW_MS && age <= EXPIRY_MS) expiring++;
    }
  }
  return {
    total: all.length, byState, photos, done, files, bytes,
    expired: all.filter((c) => isExpired(c, now)).length,
    expiringSoon: expiring,
    atRisk: all.filter((c) => c.atRisk).length,
    atRiskRemaining: all.filter((c) => c.atRisk && c.state !== "ingested").length,
  };
}
