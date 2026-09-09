#!/usr/bin/env node
/**
 * ~/Downloads watcher: ZIP → matched → verified → staged.
 *
 *   node scripts/pixieset/watch.mjs sweep     one pass over ~/Downloads, then exit
 *   node scripts/pixieset/watch.mjs watch     keep sweeping every 20s
 *   node scripts/pixieset/watch.mjs orphans   list ZIPs that matched nothing
 *
 * Chrome saves the ZIPs; this moves them off the download path, proves them, and
 * records the result in the queue. It never talks to Pixieset.
 *
 * It also reads RETIREMENT BEACONS (`px-retired-*.json`, added 2026-09-08) — the
 * downloader's word that a collection was given up on and its bytes will never
 * arrive. That is the only channel by which a NEGATIVE outcome reaches the
 * ledger; without it a retired collection reads `queued` forever, which is
 * exactly how five of them (14,516 photos) went missing for a week. See
 * `parseBeacon`.
 *
 * FOUR THINGS THAT WILL BITE, all learned the hard way on 2026-08-12:
 *
 *  1. **The filename does not encode fidelity.** A Web Size archive and a High
 *     Resolution archive of the same collection are BYTE-IDENTICAL in name, part
 *     count and file count. Only pixel dimensions separate them, so verification
 *     here always samples them — never skip `checkFidelity`.
 *
 *  2. **Chrome dedupes with " (N)".** A re-request lands as `…-1of1 (1).zip`
 *     beside the original. Matching the exact predicted name would happily verify
 *     the STALE archive and leave the fresh one unmatched, so the parser strips
 *     the suffix and the newest file wins. Staging moves files OUT of ~/Downloads
 *     precisely so this collision stops recurring.
 *
 *  3. **An unmatched ZIP is never dropped silently.** It goes to the orphans list
 *     with its reason. Silent truncation reads as "covered everything" when it
 *     did not — the same rule as the Dropbox `Output` resolver.
 *
 *  4. **`.crdownload` means still downloading.** Verifying one gets a CRC failure
 *     on a perfectly healthy archive, which would then be re-requested for no
 *     reason. Files are skipped until the partial is gone AND the size is stable.
 *
 * Staging lives OUTSIDE ~/Projects on purpose: that tree is Syncthing-replicated
 * between Mason's two Macs, and pushing terabytes of transient ZIPs through it
 * would be its own outage.
 */
import { readdir, stat, rename, mkdir, readFile, writeFile, copyFile, unlink } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { load, save, get, transition, withQueue } from "./lib/store.mjs";

/**
 * Read `.env.local` for PIXIESET_STAGING, exactly as the ingest half does.
 *
 * Both halves must agree on where collections are staged, and an export the
 * caller forgets means the watcher stages to the internal disk while the ingest
 * looks on the external one — or worse, fills a disk that has 25 GB free. One
 * file, read by both, removes that whole class of mistake. Silent if absent.
 */
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*(PIXIESET_[A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* not run from the repo root, or no .env.local — defaults apply */ }
import { verifyArchive, parseParts } from "./lib/archive.mjs";

const run = promisify(execFile);

export const DOWNLOADS = join(homedir(), "Downloads");

/**
 * Where whole collections are staged between download and ingest.
 *
 * Overridable because the internal disk cannot hold this job. A collection must
 * fit ENTIRELY on disk before it can be verified (`partsComplete` needs every
 * part at once), and the largest is ~128 GB against ~25 GB free internally.
 * `PIXIESET_STAGING` points it at a volume with room — the external SSD, in
 * practice. Set it in one place; the ingest reads the same variable.
 *
 * The staged files are TRANSIENT: each archive is released once its collection
 * is ingested AND verified in Pixeltrunk. This is scratch space, not storage.
 */
export const STAGING = process.env.PIXIESET_STAGING || join(homedir(), "pixieset-staging");
export const VERIFIED = join(STAGING, "verified");
export const QUARANTINE = join(STAGING, "quarantine");
/** Consumed retirement beacons, kept as the audit trail of what was given up on. */
export const RETIRED = join(STAGING, "retired");
const ORPHAN_LOG = join(STAGING, "orphans.json");

/**
 * Stop requesting new work below this — the pipeline stages whole collections.
 * Measured on the STAGING volume, not on `/`, since that is where the ZIPs land.
 * Raisable via PIXIESET_MIN_FREE_GB when staging shares a disk with something
 * that also needs room (the external SSD also holds Time Machine).
 */
export const MIN_FREE_GB = Number(process.env.PIXIESET_MIN_FREE_GB) || 25;

/**
 * Loopback port for the disk brake (see `startDiskServer`).
 *
 * 8788, next door to `gates-server.mjs` on 8787, so the two loopback couriers in
 * this migration sit together and neither collides with a dev server.
 */
export const DISK_PORT = Number(process.env.PIXIESET_DISK_PORT) || 8788;

const ZIP = /\.zip$/i;
const BEACON = /^px-retired-.*\.json$/i;

/**
 * Strip Chrome's " (N)" dedupe suffix and read Pixieset's slug + part numbers.
 *
 * Pixieset names archives `{slug}-photo-download-{N}of{M}.zip`, which is
 * deterministic and lets ZIP→collection matching be exact rather than fuzzy.
 */
export function parseDownloadName(filename) {
  const name = basename(filename);
  const bare = name.replace(/\s+\((\d+)\)(?=\.zip$)/i, "");
  const dupe = name !== bare ? Number(name.match(/\s+\((\d+)\)\.zip$/i)[1]) : 0;
  const m = bare.match(/^(.+?)-photo-download-(\d+)of(\d+)\.zip$/i);
  if (!m) return { name, bare, dupe, slug: null, part: null, of: null };
  return { name, bare, dupe, slug: m[1], part: Number(m[2]), of: Number(m[3]) };
}

/** True once the file is fully written: no sibling .crdownload and a stable size. */
async function isSettled(path) {
  if (existsSync(`${path}.crdownload`)) return false;
  const a = await stat(path).catch(() => null);
  if (!a) return false;
  await new Promise((r) => setTimeout(r, 1200));
  const b = await stat(path).catch(() => null);
  return !!b && a.size === b.size && b.size > 0;
}

/**
 * Read a retirement beacon — the downloader's word that it gave a collection up.
 *
 * Written by the Chrome extension when it retires a collection WITHOUT its
 * bytes: gone from Pixieset, downloads switched off, password refused, or three
 * failed attempts. Before this existed, those left `queue.json` reading
 * `queued` forever — the ledger and the scheduler disagreeing, with no surface
 * that compared them. Five collections and 14,516 photos sat that way for a
 * week (2026-09-01 → 09-08).
 *
 * The SLUG COMES FROM THE BODY, never from the filename. Chrome dedupes a
 * repeat as `px-retired-x (1).json`, and identity read out of a filename is one
 * suffix away from being wrong — the same trap as the ZIP names, which is why
 * that parser strips " (N)" rather than trusting it.
 *
 * Returns null for anything that is not a well-formed beacon, so a stray JSON
 * file in ~/Downloads is an orphan with a reason rather than a state change.
 */
export function parseBeacon(text) {
  let b;
  try { b = JSON.parse(text); } catch { return null; }
  if (!b || b.kind !== "px-retired") return null;
  if (typeof b.slug !== "string" || !b.slug) return null;
  const reasons = ["gone", "no-download", "password-rejected", "failed"];
  return {
    slug: b.slug,
    reason: reasons.includes(b.reason) ? b.reason : "failed",
    detail: typeof b.detail === "string" ? b.detail.slice(0, 300) : "",
    attempts: Number.isFinite(b.attempts) ? b.attempts : null,
    at: typeof b.at === "string" ? b.at : null,
  };
}

/** Human sentence for the ledger's `error` column. */
export function beaconError(b) {
  const why = {
    gone: "deleted on Pixieset",
    "no-download": "bulk download switched off on the collection",
    "password-rejected": "gallery password refused",
    failed: "the downloader gave up after repeated failures",
  }[b.reason];
  return `retired by the downloader: ${why}${b.detail ? ` — ${b.detail}` : ""}`;
}

/** Every beacon settled in ~/Downloads, parsed. */
export async function scanBeacons(dir = DOWNLOADS) {
  const files = (await readdir(dir).catch(() => [])).filter((f) => BEACON.test(f));
  const found = [];
  const orphans = [];
  for (const f of files) {
    const path = join(dir, f);
    if (!(await isSettled(path))) continue;
    const parsed = parseBeacon(await readFile(path, "utf8").catch(() => ""));
    if (!parsed) { orphans.push({ name: f, reason: "not a readable px-retired beacon" }); continue; }
    found.push({ ...parsed, path, name: f });
  }
  return { found, orphans };
}

export async function freeGB(dir = STAGING) {
  const { stdout } = await run("df", ["-k", dir]);
  const line = stdout.trim().split("\n").pop().split(/\s+/);
  return Math.floor(Number(line[3]) / 1048576);
}

async function readOrphans() {
  if (!existsSync(ORPHAN_LOG)) return [];
  try { return JSON.parse(await readFile(ORPHAN_LOG, "utf8")); } catch { return []; }
}
async function noteOrphan(entry) {
  const all = await readOrphans();
  if (!all.some((o) => o.name === entry.name)) all.push({ ...entry, at: new Date().toISOString() });
  await mkdir(STAGING, { recursive: true });
  await writeFile(ORPHAN_LOG, JSON.stringify(all, null, 2));
}

/**
 * Group settled ZIPs in ~/Downloads by collection slug.
 *
 * When a duplicate exists, the NEWEST file wins for that part — a re-request is
 * always the one we want, and preferring the older one is precisely the trap in
 * note 2 above.
 */
export async function scanDownloads(dir = DOWNLOADS) {
  const files = (await readdir(dir).catch(() => [])).filter((f) => ZIP.test(f));
  const bySlug = new Map();
  const skipped = [];
  const orphans = [];

  for (const f of files) {
    const path = join(dir, f);
    const parsed = parseDownloadName(f);
    if (!parsed.slug) { orphans.push({ name: f, reason: "filename does not match {slug}-photo-download-NofM.zip" }); continue; }
    if (!(await isSettled(path))) { skipped.push({ name: f, reason: "still downloading" }); continue; }
    const st = await stat(path);
    const bucket = bySlug.get(parsed.slug) || new Map();
    const prev = bucket.get(parsed.part);
    if (!prev || st.mtimeMs > prev.mtimeMs) bucket.set(parsed.part, { path, ...parsed, mtimeMs: st.mtimeMs, size: st.size });
    bySlug.set(parsed.slug, bucket);
  }
  return { bySlug, skipped, orphans };
}

/** Every collection in the queue, indexed by slug — the matching authority. */
function slugIndex(queue) {
  const idx = new Map();
  for (const c of Object.values(queue.collections)) idx.set(c.slug, c);
  return idx;
}

export async function sweep({ dryRun = false } = {}) {
  const queue = await load();
  if (!queue) throw new Error("no queue — run: node scripts/pixieset/queue.mjs build");
  await mkdir(VERIFIED, { recursive: true });
  await mkdir(QUARANTINE, { recursive: true });

  const { bySlug, skipped, orphans } = await scanDownloads();
  const beaconScan = await scanBeacons();
  orphans.push(...beaconScan.orphans);
  /** Final state per collection, applied under the lock once the slow work is done. */
  const pendingStates = [];
  const idx = slugIndex(queue);
  const done = [];

  /**
   * Retirement beacons, classified now and applied with everything else.
   *
   * A beacon is the downloader's CLAIM. Bytes on disk are stronger: a
   * collection that is already `verified` or `ingested` really did arrive —
   * by a re-request, by hand, from another route — and marking it failed on
   * the strength of a file would walk the ledger backwards over the evidence.
   * Those beacons are filed and ignored, never obeyed.
   */
  const retired = [];
  for (const b of beaconScan.found) {
    const collection = idx.get(b.slug);
    if (!collection) {
      await noteOrphan({ name: b.name, reason: `beacon slug "${b.slug}" is not in the queue` });
      orphans.push({ name: b.name, reason: `beacon slug "${b.slug}" is not in the queue` });
      continue;
    }
    const state = get(queue, collection.id).state;
    const stale = state === "verified" || state === "ingested";
    retired.push({ ...b, id: collection.id, name: collection.name, from: state, stale });
  }

  for (const [slug, parts] of bySlug) {
    const collection = idx.get(slug);
    if (!collection) {
      for (const p of parts.values()) await noteOrphan({ name: p.name, reason: `slug "${slug}" is not in the queue` });
      orphans.push({ name: `${slug} (${parts.size} file(s))`, reason: "slug not in queue" });
      continue;
    }

    // Wait for the whole part set. A missing middle part looks exactly like
    // success — several valid ZIPs and no error anywhere.
    const of = [...parts.values()][0].of;
    if (parts.size < of) {
      skipped.push({ name: slug, reason: `have ${parts.size}/${of} parts — waiting` });
      continue;
    }

    const paths = [...parts.values()].sort((a, b) => a.part - b.part).map((p) => p.path);
    const result = await verifyArchive(paths, {
      expectedPhotos: collection.photoCount,
      expectedFiles: collection.expectedFiles ?? null,   // written by apply.mjs from the set picker
      checkFidelity: true,
    });

    if (dryRun) { done.push({ slug, ok: result.ok, files: result.files, problems: result.problems }); continue; }

    // Walk the machine forward from WHEREVER this collection actually is, rather
    // than assuming it is queued.
    //
    // The state that broke this: `failed`. A collection that failed once and was
    // then re-requested and downloaded is the ordinary retry path — it is how
    // every transient error recovers — and `failed → downloaded` is illegal, so
    // the sweep threw and processed nothing else in the run. Found on the first
    // real retry (11139225, failed at the PIN gate, downloaded after the gate was
    // cleared). `failed` exits only to `queued`, so that is the first hop.
    const step = (to, patch) => { if (get(queue, collection.id).state !== to) transition(queue, collection.id, to, patch); };

    /**
     * Already past this point? Stage the files and leave the state alone.
     *
     * A collection can be `verified` or `ingested` while its ZIPs are still in
     * ~/Downloads — that is exactly what the failed cross-volume move produced.
     * Walking the machine backwards from there is illegal and throws, killing
     * the whole sweep. The archive still needs a home, so move it and move on.
     */
    const already = get(queue, collection.id).state;
    if (already === "verified" || already === "ingested") {
      const home = result.ok ? VERIFIED : QUARANTINE;
      await mkdir(home, { recursive: true });
      for (const p of paths) {
        const target = join(home, basename(p));
        try { await rename(p, target); }
        catch (err) {
          if (err?.code !== "EXDEV") throw err;
          await copyFile(p, target);
          const [a, b] = [await stat(p), await stat(target)];
          if (a.size !== b.size) throw new Error(`copy of ${basename(p)} is ${b.size} B, source is ${a.size} B`);
          await unlink(p);
        }
      }
      done.push({ slug, id: collection.id, ok: result.ok, files: result.files, restaged: already });
      continue;
    }

    if (get(queue, collection.id).state === "failed") step("queued");
    if (get(queue, collection.id).state === "queued") step("requested", { requestedAt: new Date().toISOString() });
    if (get(queue, collection.id).state === "requested") step("ready");
    step("downloaded", { files: result.files, bytes: result.bytes });

    /**
     * Move the archive to staging BEFORE advancing the state, and fail loudly.
     *
     * Two bugs lived in the one line this replaces, and they compounded:
     *
     *   `rename()` CANNOT CROSS VOLUMES. Once staging moved to the external SSD,
     *   every move from ~/Downloads (internal) failed with EXDEV.
     *
     *   `.catch(() => {})` swallowed that whole. So the collection was marked
     *   `verified` while its ZIPs sat in ~/Downloads — and the next sweep, seeing
     *   them still there, tried `verified → downloaded`, which is illegal, threw,
     *   and killed the entire run. One silent failure, one hard crash, and a
     *   state that claimed the bytes were somewhere they were not.
     *
     * The rule is the same one the ingest follows: the bytes reach their home
     * before anything records that they did.
     */
    const dest = result.ok ? VERIFIED : QUARANTINE;
    await mkdir(dest, { recursive: true });
    const moved = [];
    for (const p of paths) {
      const target = join(dest, basename(p));
      try {
        await rename(p, target);
      } catch (err) {
        if (err?.code !== "EXDEV") throw err;
        // Different volume: copy, verify the size, then drop the source. Never
        // unlink before the copy is proven, or a failure loses the archive.
        await copyFile(p, target);
        const [a, b] = [await stat(p), await stat(target)];
        if (a.size !== b.size) throw new Error(`copy of ${basename(p)} is ${b.size} B, source is ${a.size} B`);
        await unlink(p);
      }
      moved.push(target);
    }
    if (moved.length !== paths.length) {
      throw new Error(`staged ${moved.length} of ${paths.length} parts for ${slug} — refusing to advance state`);
    }

    if (result.ok) {
      transition(queue, collection.id, "verified", { files: result.files, bytes: result.bytes });
      pendingStates.push({ id: collection.id, to: "verified", patch: { files: result.files, bytes: result.bytes } });
    } else {
      const patch = {
        error: result.problems.join("; ").slice(0, 400),
        attempts: collection.attempts + 1,
      };
      transition(queue, collection.id, "failed", patch);
      pendingStates.push({ id: collection.id, to: "failed", patch });
    }
    done.push({
      slug, id: collection.id, ok: result.ok, files: result.files,
      expected: collection.expectedFiles ?? collection.photoCount,
      gb: (result.bytes / 1073741824).toFixed(2),
      width: result.dimensions?.uniformWidth ?? null,
      median: result.dimensions?.medianLongEdge ?? null,
      sets: result.sets, problems: result.problems,
    });
  }

  /**
   * Apply the state changes under the lock, against a FRESHLY re-read queue.
   *
   * The sweep holds `queue` for minutes — verifying CRCs and moving multi-GB
   * archives — and anything read before that work is stale by the time it
   * finishes. Saving that stale copy is what silently reverted two collections
   * from `verified` to `queued` while the ingest loop ran alongside
   * (2026-08-14): the ingest's own write landed in between and was erased.
   *
   * So the slow work happens unlocked, and only the final states are applied
   * here — briefly, atomically, on current data. Lock hold time is milliseconds
   * rather than minutes, so the ingest is never blocked behind a verification.
   */
  if (!dryRun && (pendingStates.length || retired.some((r) => !r.stale))) {
    await withQueue((fresh) => {
      /**
       * Beacons first, ZIPs second, deliberately.
       *
       * If a collection was retired AND its bytes turned up in the same sweep,
       * the bytes win: `failed → queued → … → verified` is the ordinary retry
       * path the loop below already walks. Doing it the other way round would
       * mark a freshly verified archive as failed.
       */
      for (const r of retired) {
        if (r.stale) continue;
        const cur = get(fresh, r.id).state;
        if (cur === "verified" || cur === "ingested") continue;   // re-checked on fresh data
        transition(fresh, r.id, "failed", { error: beaconError(r) });
      }
      for (const { id, to, patch } of pendingStates) {
        const cur = get(fresh, id).state;
        if (cur === to) continue;
        // Walk the machine forward on the fresh copy; skip anything already past.
        if (cur === "failed" && to !== "failed") transition(fresh, id, "queued");
        for (const hop of ["requested", "ready", "downloaded"]) {
          if (get(fresh, id).state === to) break;
          const order = ["queued", "requested", "ready", "downloaded", "verified", "failed"];
          if (order.indexOf(get(fresh, id).state) < order.indexOf(hop)) transition(fresh, id, hop);
        }
        if (get(fresh, id).state !== to) transition(fresh, id, to, patch);
      }
    });
  }
  /**
   * File the beacons only after the ledger has them.
   *
   * Same rule the archives follow: the record lands before the evidence is
   * moved. If this throws, the beacon stays in ~/Downloads and the next sweep
   * re-applies it — `failed → failed` is a no-op transition that appends one
   * history line, which is a far better failure than a retirement nobody kept.
   */
  if (!dryRun && retired.length) {
    await mkdir(RETIRED, { recursive: true });
    for (const r of retired) {
      await rename(r.path, join(RETIRED, basename(r.path))).catch(async (err) => {
        if (err?.code !== "EXDEV") throw err;
        await copyFile(r.path, join(RETIRED, basename(r.path)));
        await unlink(r.path);
      });
    }
  }

  for (const o of orphans) await noteOrphan(o);
  return { done, skipped, orphans, retired, freeGB: await freeGB() };
}

/**
 * Serve free space on loopback, so the DOWNLOADER can have a floor.
 *
 * Every other stage of this pipeline has one: the ingest halts below 60 GB, this
 * watcher warns below its own, the old Playwright downloader took a byte budget.
 * The Chrome extension that actually does the downloading has none, because an
 * extension cannot see the disk at all — no API exposes it. So it requested a
 * 46 GB collection against 53 GB free on 2026-09-08 and drove the startup disk
 * from 117 GB to 47 GB while the ingest sat halted, unable to drain. That is the
 * 2026-09-02 shape, where the mini reached zero and lost its shell.
 *
 * This is the missing sense. It runs inside the watcher because the watcher is
 * already the process that knows where the ZIPs land and how much room is left,
 * and because sharing its lifecycle means there is exactly one thing to restart.
 *
 * Loopback only, no secrets, read-only — the whole payload is a number anyone on
 * this Mac could get from `df`. Chrome treats http://localhost as a trustworthy
 * origin, which is what lets the extension reach it at all (the same property
 * `gates-server.mjs` relies on).
 */
export function startDiskServer(port = DISK_PORT) {
  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");   // the caller is an extension origin
    if (!req.url?.startsWith("/disk")) { res.writeHead(404).end(); return; }
    try {
      const free = await freeGB();
      const staged = existsSync(VERIFIED) ? (await readdir(VERIFIED)).filter((f) => ZIP.test(f)).length : 0;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ freeGB: free, floorGB: MIN_FREE_GB, stagedZips: staged, at: new Date().toISOString() }));
    } catch (e) {
      // No answer is better than a wrong one: the caller fails CLOSED on a
      // non-200, which is the safe direction for a guard protecting a disk.
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(e?.message ?? e).slice(0, 200) }));
    }
  });
  server.on("error", (e) => console.error(`disk server on ${port}: ${e?.message ?? e}`));
  server.listen(port, "127.0.0.1", () => console.log(`disk brake on http://127.0.0.1:${port}/disk`));
  return server;
}

// ---------------------------------------------------------------- CLI
//
// Guarded so importing this module (from tests, or from an ingest script that
// wants `sweep()`) does not start sweeping ~/Downloads as a side effect.

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const cmd = process.argv[2] || "sweep";
const fmt = (r) => {
  for (const d of r.done) {
    const head = d.ok ? "✓" : "✗";
    console.log(`${head} ${d.slug} · ${d.files} files (expected ${d.expected}) · ${d.gb} GB · median ${d.median}px`);
    if (d.sets) console.log(`    sets: ${Object.entries(d.sets).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    for (const p of d.problems || []) console.log(`    ! ${p}`);
  }
  for (const t of r.retired || []) {
    console.log(t.stale
      ? `· ${t.slug} — retirement beacon ignored, already ${t.from}`
      : `✗ ${t.slug} — RETIRED by the downloader (${t.reason}): ${t.detail || "no detail"}`);
  }
  for (const s of r.skipped) console.log(`… ${s.name} — ${s.reason}`);
  for (const o of r.orphans) console.log(`? ORPHAN ${o.name} — ${o.reason}`);
  console.log(`free ${r.freeGB} GB${r.freeGB < MIN_FREE_GB ? `  ⚠ below the ${MIN_FREE_GB} GB floor — stop requesting` : ""}`);
};

if (!isMain) {
  // imported as a library — expose sweep()/scanDownloads() and do nothing else
} else if (cmd === "sweep" || cmd === "dry") {
  fmt(await sweep({ dryRun: cmd === "dry" }));
} else if (cmd === "watch") {
  console.log(`watching ${DOWNLOADS} → ${VERIFIED} (ctrl-c to stop)`);
  startDiskServer();
  for (;;) {
    const r = await sweep();
    if (r.done.length || r.orphans.length || r.retired.length) fmt(r);
    await new Promise((res) => setTimeout(res, 20000));
  }
} else if (cmd === "orphans") {
  console.log(JSON.stringify(await readOrphans(), null, 2));
} else {
  console.error("usage: watch.mjs sweep|dry|watch|orphans");
  process.exit(1);
}
