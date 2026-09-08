/**
 * Tests for the ~/Downloads watcher's filename matching.
 *
 *   node --test scripts/pixieset/watch.test.mjs
 *
 * The trap these guard: a Web Size archive and a High Resolution archive of the
 * same collection have BYTE-IDENTICAL filenames, so a re-request lands beside the
 * original as "… (1).zip". A matcher that ignores the suffix verifies the STALE
 * file and reports success while the fresh one sits unmatched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDownloadName, parseBeacon, beaconError, scanBeacons } from "./watch.mjs";

test("parses Pixieset's deterministic download name", () => {
  const p = parseDownloadName("nachisheadshots-photo-download-1of1.zip");
  assert.equal(p.slug, "nachisheadshots");
  assert.equal(p.part, 1);
  assert.equal(p.of, 1);
  assert.equal(p.dupe, 0);
});

test("strips Chrome's ' (N)' dedupe suffix and records that it was a duplicate", () => {
  const p = parseDownloadName("nachisheadshots-photo-download-1of1 (1).zip");
  assert.equal(p.slug, "nachisheadshots", "the duplicate must still match its collection");
  assert.equal(p.part, 1);
  assert.equal(p.dupe, 1, "the suffix is the only signal that a re-request happened");
});

test("multi-part names carry their part numbers", () => {
  const p = parseDownloadName("uspartnerloungeheadshots-photo-download-2of7.zip");
  assert.equal(p.slug, "uspartnerloungeheadshots");
  assert.equal(p.part, 2);
  assert.equal(p.of, 7);
});

test("slugs containing digits and hyphens survive the parse", () => {
  const p = parseDownloadName("acme-2018-event-photos-photo-download-3of3.zip");
  assert.equal(p.slug, "acme-2018-event-photos", "the greedy split must stop at -photo-download-");
  assert.equal(p.part, 3);
});

test("an unrelated ZIP yields no slug, so it becomes a logged orphan not a silent drop", () => {
  assert.equal(parseDownloadName("DropboxInstaller.zip").slug, null);
  assert.equal(parseDownloadName("invoices (2).zip").slug, null);
});

// --- the state walk -------------------------------------------------------
// The sweep has to move a collection from wherever it actually is to
// `downloaded`. These cover the transitions the machine allows, and in
// particular the RETRY path, which is what a real run hit first.
import { STATES } from "./lib/store.mjs";

/** Reproduce the sweep's walk without touching the filesystem. */
function walkToDownloaded(state, transition) {
  if (state === "failed") state = transition(state, "queued");
  if (state === "queued") state = transition(state, "requested");
  if (state === "requested") state = transition(state, "ready");
  return transition(state, "downloaded");
}

const LEGAL = {
  queued: ["requested", "failed"],
  requested: ["ready", "queued", "failed"],
  ready: ["downloaded", "queued", "failed"],
  downloaded: ["verified", "failed"],
  verified: ["ingested", "failed"],
  ingested: [],
  failed: ["queued"],
};

const strictTransition = (from, to) => {
  if (from !== to && !LEGAL[from].includes(to)) throw new Error(`illegal transition: ${from} → ${to}`);
  return to;
};

test("a FAILED collection can be re-downloaded — the ordinary retry path", () => {
  // 11139225 failed at the PIN gate, then downloaded once the gate was cleared.
  // Before the fix this threw "illegal transition: failed → downloaded" and the
  // whole sweep aborted, processing nothing else in the run.
  assert.equal(walkToDownloaded("failed", strictTransition), "downloaded");
});

test("the walk reaches downloaded from every state that should be able to", () => {
  for (const from of ["queued", "requested", "ready", "failed"]) {
    assert.equal(walkToDownloaded(from, strictTransition), "downloaded", `stuck at ${from}`);
  }
});

test("STATES still contains every state the walk relies on", () => {
  for (const s of ["queued", "requested", "ready", "downloaded", "verified", "ingested", "failed"]) {
    assert.ok(STATES.includes(s), `${s} missing from STATES`);
  }
});

// ------------------------------------------------------------ retirement beacons
//
// The downloader retires a collection it cannot get — gone from Pixieset,
// downloads switched off, password refused, three failures — and until the
// beacon existed that never reached `queue.json`, which went on reading
// `queued` for five collections and 14,516 photos for a week. These guard the
// two claims the design rests on: the slug comes from the BODY, and anything
// malformed is an orphan rather than a state change.

test("a beacon's slug comes from its body, not its filename", async () => {
  const dir = await mkdtemp(join(tmpdir(), "px-beacon-"));
  const body = JSON.stringify({ kind: "px-retired", version: 1, slug: "mcapsseattle2026", reason: "gone", detail: "HTTP 404", at: new Date().toISOString() });
  // Chrome's dedupe suffix: the name is unparseable, the body is not.
  await writeFile(join(dir, "px-retired-mcapsseattle2026 (1).json"), body);
  const { found, orphans } = await scanBeacons(dir);
  assert.equal(orphans.length, 0);
  assert.equal(found.length, 1);
  assert.equal(found[0].slug, "mcapsseattle2026", "a duplicate suffix must not cost us the identity");
  assert.equal(found[0].reason, "gone");
});

test("anything that is not a beacon is an orphan, never a state change", async () => {
  const dir = await mkdtemp(join(tmpdir(), "px-beacon-"));
  await writeFile(join(dir, "px-retired-broken.json"), "{ not json");
  await writeFile(join(dir, "px-retired-other.json"), JSON.stringify({ kind: "something-else", slug: "x" }));
  await writeFile(join(dir, "px-retired-noslug.json"), JSON.stringify({ kind: "px-retired" }));
  const { found, orphans } = await scanBeacons(dir);
  assert.equal(found.length, 0, "a malformed file must not be able to fail a collection");
  assert.equal(orphans.length, 3);
});

test("an unknown reason degrades to failed rather than being trusted", () => {
  const b = parseBeacon(JSON.stringify({ kind: "px-retired", slug: "x", reason: "haunted" }));
  assert.equal(b.reason, "failed", "a reason we do not know is still a retirement");
});

test("the ledger's error says who retired it and why", () => {
  const e = beaconError({ reason: "no-download", detail: "bulk download is switched off" });
  assert.match(e, /retired by the downloader/);
  assert.match(e, /switched off/);
});
