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
