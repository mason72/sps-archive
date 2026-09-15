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
import { parseDownloadName, parseBeacon, beaconError, scanBeacons, FIDELITY_ACCEPTED } from "./watch.mjs";

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

test("Web Size acceptances are named, exact and signed", () => {
  // Each entry waives the guard for ONE collection at ONE width. A new entry is
  // a human decision, so the list is pinned here and cannot grow by accident.
  assert.deepEqual(Object.keys(FIDELITY_ACCEPTED), ["cemacovers"]);
  for (const [slug, a] of Object.entries(FIDELITY_ACCEPTED)) {
    assert.ok(Number.isInteger(a.width) && a.width > 0, `${slug}: an exact width`);
    assert.ok(a.why && a.approved, `${slug}: the reason and the approval are recorded`);
  }
});

test("POST /status is written to disk with the watcher's own receipt time; junk is refused", async () => {
  const { startDiskServer } = await import("./watch.mjs");
  const dir = await mkdtemp(join(tmpdir(), "px-status-"));
  const statusFile = join(dir, "logs", "extension-status.json");
  const server = startDiskServer(0, { statusFile });
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const ok = await fetch(`${base}/status`, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ running: false, stoppedReason: "queue drained" }) });
    assert.equal(ok.status, 204);
    const written = JSON.parse(await (await import("node:fs/promises")).readFile(statusFile, "utf8"));
    assert.equal(written.stoppedReason, "queue drained");
    assert.ok(Date.now() - new Date(written.receivedAt).getTime() < 5000, "receivedAt is stamped by the watcher, not the sender");

    const bad = await fetch(`${base}/status`, { method: "POST", headers: { "content-type": "text/plain" }, body: "[1,2]" });
    assert.equal(bad.status, 400, "an array is not a status");
    const still = JSON.parse(await (await import("node:fs/promises")).readFile(statusFile, "utf8"));
    assert.equal(still.stoppedReason, "queue drained", "a refused body must not clobber the last good one");

    const disk = await (await fetch(`${base}/disk`)).json();
    assert.equal(typeof disk.manifestVersion, "string", "the brake carries the on-disk extension version");
    const pre = await fetch(`${base}/status`, { method: "OPTIONS" });
    assert.equal(pre.status, 204);
  } finally {
    server.close();
  }
});
