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
import { parseDownloadName } from "./watch.mjs";

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
