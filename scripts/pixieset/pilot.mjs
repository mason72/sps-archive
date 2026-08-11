#!/usr/bin/env node
/**
 * Pilot: measure a real Pixieset collection end to end, download side only.
 * Touches no production system — bytes land on local disk and nothing else.
 *
 *   node scripts/pixieset/pilot.mjs <collectionId> [--limit N] [--keep]
 *
 * Three stages, timed separately because they scale differently:
 *   enumerate  GET /api/v1/collections/{id}/photos?page=N   (session, 24/page)
 *   resolve    GET /api/v1/photos/{id}/download             (session, 302 → signed URL)
 *   fetch      the signed CloudFront URL                    (NO auth, range-resumable)
 *
 * Every file is verified against the `size` the API reported for it, so a
 * truncated or substituted download can't pass as success.
 */
import { chromium } from "playwright";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROFILE = join(HERE, "profile");
const API = "https://galleries.pixieset.com";

const args = process.argv.slice(2);
const COLLECTION = Number(args.find((a) => /^\d+$/.test(a)));
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const KEEP_FILES = args.includes("--keep");
if (!COLLECTION) {
  console.error("usage: node pilot.mjs <collectionId> [--limit N] [--keep]");
  process.exit(1);
}

const OUT = join(HERE, "data", String(COLLECTION));
const RESOLVE_CONCURRENCY = 5;   // authenticated — stay polite
const FETCH_CONCURRENCY = 8;     // plain CDN, no session involved
const mb = (b) => (b / 1048576).toFixed(1);
const secs = (ms) => (ms / 1000).toFixed(1);

/** Bounded worker pool; returns results in input order. */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true });
try {
  // ---- session check -------------------------------------------------------
  const who = await ctx.request.get(`${API}/api/v1/user`, { headers: { Accept: "application/json" } });
  const username = who.ok() ? (await who.json())?.data?.username : null;
  if (!username) {
    console.error("✗ no valid session. Run:  node scripts/pixieset/login.mjs");
    process.exit(2);
  }
  console.log(`session ok (${username})\n`);

  // ---- 1. enumerate --------------------------------------------------------
  let t = Date.now();
  const photos = [];
  for (let page = 1; page <= 2000; page++) {
    const r = await ctx.request.get(`${API}/api/v1/collections/${COLLECTION}/photos?page=${page}`,
      { headers: { Accept: "application/json" } });
    if (!r.ok()) break;
    const rows = (await r.json())?.data?.data || [];
    if (!rows.length) break;
    for (const p of rows) photos.push({ id: p.id, name: p.name, size: p.size, w: p.width, h: p.height });
    if (photos.length >= LIMIT) break;
    await new Promise((r) => setTimeout(r, 60));
  }
  const targets = photos.slice(0, LIMIT === Infinity ? photos.length : LIMIT);
  const enumMs = Date.now() - t;
  const expected = targets.reduce((s, p) => s + p.size, 0);
  console.log(`enumerate  ${targets.length} photos · ${mb(expected)} MB expected · ${secs(enumMs)}s ` +
    `(${(targets.length / (enumMs / 1000)).toFixed(0)}/s)`);

  // ---- 2. resolve signed URLs ---------------------------------------------
  t = Date.now();
  let resolveFails = 0;
  const urls = await pool(targets, RESOLVE_CONCURRENCY, async (p) => {
    const r = await ctx.request.get(`${API}/api/v1/photos/${p.id}/download`, { maxRedirects: 0 });
    const loc = r.headers()["location"];
    if (!loc) { resolveFails++; return null; }
    return loc;
  });
  const resolveMs = Date.now() - t;
  console.log(`resolve    ${urls.filter(Boolean).length}/${targets.length} signed URLs · ${secs(resolveMs)}s ` +
    `(${(targets.length / (resolveMs / 1000)).toFixed(1)}/s)${resolveFails ? ` · ${resolveFails} FAILED` : ""}`);

  // ---- 3. fetch bytes (no auth) -------------------------------------------
  await mkdir(OUT, { recursive: true });
  t = Date.now();
  let got = 0, bytes = 0, mismatch = 0, failed = 0;
  await pool(targets.map((p, i) => [p, urls[i]]), FETCH_CONCURRENCY, async ([p, url]) => {
    if (!url) { failed++; return; }
    try {
      const res = await fetch(url);
      if (!res.ok) { failed++; return; }
      const buf = Buffer.from(await res.arrayBuffer());
      // the integrity gate: bytes must match what enumeration promised
      if (buf.length !== p.size) {
        mismatch++;
        console.log(`  ! ${p.name}: got ${buf.length} expected ${p.size}`);
      }
      await writeFile(join(OUT, `${p.id}_${p.name}`), buf);
      got++; bytes += buf.length;
    } catch (e) { failed++; }
  });
  const fetchMs = Date.now() - t;

  console.log(`fetch      ${got}/${targets.length} files · ${mb(bytes)} MB · ${secs(fetchMs)}s ` +
    `(${mb(bytes / (fetchMs / 1000))} MB/s, ${(got / (fetchMs / 1000)).toFixed(1)} files/s)`);
  console.log(`\nintegrity  ${mismatch ? `${mismatch} SIZE MISMATCH` : "all sizes match the API"}` +
    `${failed ? ` · ${failed} failed` : ""}`);

  // ---- projection ----------------------------------------------------------
  const perPhotoMs = (resolveMs + fetchMs) / Math.max(got, 1);
  const AT_RISK = 655_686;
  console.log(`\nper photo  ${perPhotoMs.toFixed(0)} ms wall-clock (resolve+fetch, at this concurrency)`);
  console.log(`projected  655,686 at-risk photos → ${(AT_RISK * perPhotoMs / 3.6e6).toFixed(1)} hours`);
  console.log(`           ~1.13 TB at ${mb(bytes / (fetchMs / 1000))} MB/s → ` +
    `${(1.13 * 1024 * 1024 / (bytes / (fetchMs / 1000)) / 3600).toFixed(1)} hours of transfer`);

  if (!KEEP_FILES) { await rm(OUT, { recursive: true, force: true }); console.log(`\ncleaned up ${OUT}`); }
  else console.log(`\nfiles kept in ${OUT}`);
} finally {
  await ctx.close();
}
