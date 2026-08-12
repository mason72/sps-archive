/**
 * Tests for the queue state machine.
 *
 *   node --test scripts/pixieset/lib/store.test.mjs
 *
 * These exercise the two rules that cost real money if they are wrong: the
 * 7-day link expiry (a missed expiry downloads a dead link and reports success)
 * and the transition guard (a skipped state means an unverified collection can
 * reach `ingested`). The clock is injected so expiry is tested by arithmetic,
 * not by waiting a week.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { transition, isExpired, expire, nextBatch, summarize, EXPIRY_MS } from "./store.mjs";

/** A queue built by hand — no disk, no triage files, no shared assumptions. */
const fixture = (overrides = {}) => ({
  version: 1,
  collections: {
    a: { id: "a", slug: "a", name: "A", eventDate: "2014-01-01", year: 2014, photoCount: 100, atRisk: true, state: "queued", attempts: 0, requestedAt: null, zips: [], files: null, bytes: null, error: null, history: [], ...overrides.a },
    b: { id: "b", slug: "b", name: "B", eventDate: "2019-01-01", year: 2019, photoCount: 200, atRisk: true, state: "queued", attempts: 0, requestedAt: null, zips: [], files: null, bytes: null, error: null, history: [], ...overrides.b },
    c: { id: "c", slug: "c", name: "C", eventDate: "2025-01-01", year: 2025, photoCount: 300, atRisk: false, state: "queued", attempts: 0, requestedAt: null, zips: [], files: null, bytes: null, error: null, history: [], ...overrides.c },
  },
});

test("the happy path walks every state in order", () => {
  const q = fixture();
  for (const s of ["requested", "ready", "downloaded", "verified", "ingested"]) transition(q, "a", s);
  assert.equal(q.collections.a.state, "ingested");
  assert.deepEqual(q.collections.a.history.map((h) => h.state),
    ["requested", "ready", "downloaded", "verified", "ingested"]);
});

test("a collection cannot skip verification on its way to ingested", () => {
  const q = fixture();
  transition(q, "a", "requested");
  transition(q, "a", "ready");
  transition(q, "a", "downloaded");
  assert.throws(() => transition(q, "a", "ingested"), /illegal transition/);
});

test("queued cannot jump straight to downloaded", () => {
  const q = fixture();
  assert.throws(() => transition(q, "a", "downloaded"), /illegal transition/);
});

test("ingested is terminal", () => {
  const q = fixture();
  for (const s of ["requested", "ready", "downloaded", "verified", "ingested"]) transition(q, "a", s);
  assert.throws(() => transition(q, "a", "queued"), /illegal transition/);
});

test("failure is retryable and preserves the attempt count", () => {
  const q = fixture();
  transition(q, "a", "requested");
  transition(q, "a", "failed", { error: "boom", attempts: 1 });
  assert.equal(q.collections.a.error, "boom");
  transition(q, "a", "queued");
  assert.equal(q.collections.a.attempts, 1, "attempts survive the retry");
  assert.equal(q.collections.a.error, null, "a fresh attempt does not inherit the old error");
});

test("re-queueing clears the dead link so it can never be downloaded", () => {
  const q = fixture();
  transition(q, "a", "requested", { requestedAt: new Date().toISOString() });
  transition(q, "a", "ready", { zips: [{ url: "https://x/a.zip", part: 1, of: 1 }] });
  transition(q, "a", "queued");
  assert.deepEqual(q.collections.a.zips, []);
  assert.equal(q.collections.a.requestedAt, null);
});

test("a link is live at 6 days and dead at 8", () => {
  const now = Date.now();
  const at = (days) => new Date(now - days * 86400_000).toISOString();
  const live = { state: "ready", requestedAt: at(6) };
  const dead = { state: "ready", requestedAt: at(8) };
  assert.equal(isExpired(live, now), false);
  assert.equal(isExpired(dead, now), true);
});

test("expiry is measured from request, and only for states holding a link", () => {
  const now = Date.now();
  const old = new Date(now - EXPIRY_MS - 1000).toISOString();
  // `downloaded` already has the bytes — its link going stale is irrelevant.
  assert.equal(isExpired({ state: "downloaded", requestedAt: old }, now), false);
  assert.equal(isExpired({ state: "ingested", requestedAt: old }, now), false);
  assert.equal(isExpired({ state: "queued", requestedAt: null }, now), false);
  assert.equal(isExpired({ state: "requested", requestedAt: old }, now), true);
});

test("expire() walks rotted links back to queued", () => {
  const now = Date.now();
  const old = new Date(now - EXPIRY_MS - 1000).toISOString();
  const q = fixture({
    a: { state: "ready", requestedAt: old, zips: [{ url: "https://x/a.zip" }] },
    b: { state: "ready", requestedAt: new Date(now - 86400_000).toISOString() },
  });
  const dead = expire(q, now);
  assert.deepEqual(dead, ["a"]);
  assert.equal(q.collections.a.state, "queued");
  assert.deepEqual(q.collections.a.zips, [], "the dead link is gone, not just re-labelled");
  assert.equal(q.collections.b.state, "ready", "a fresh link is left alone");
});

test("batches come oldest-first and honour the at-risk filter", () => {
  const q = fixture();
  assert.deepEqual(nextBatch(q, { limit: 3 }).map((c) => c.id), ["a", "b", "c"]);
  assert.deepEqual(nextBatch(q, { limit: 10, atRiskOnly: true }).map((c) => c.id), ["a", "b"]);
  assert.deepEqual(nextBatch(q, { limit: 1 }).map((c) => c.id), ["a"]);
});

test("a batch only ever offers queued work", () => {
  const q = fixture({ a: { state: "ready" } });
  assert.deepEqual(nextBatch(q, { limit: 10 }).map((c) => c.id), ["b", "c"]);
});

test("summarize counts progress against the at-risk set", () => {
  const now = Date.now();
  const q = fixture({ a: { state: "ingested", files: 90, bytes: 1000 } });
  const s = summarize(q, now);
  assert.equal(s.total, 3);
  assert.equal(s.byState.ingested, 1);
  assert.equal(s.byState.queued, 2);
  assert.equal(s.done, 100);
  assert.equal(s.files, 90);
  assert.equal(s.atRisk, 2);
  assert.equal(s.atRiskRemaining, 1);
});

test("links inside 24h of death are flagged before they die", () => {
  const now = Date.now();
  const q = fixture({
    a: { state: "ready", requestedAt: new Date(now - 6.5 * 86400_000).toISOString() },
    b: { state: "ready", requestedAt: new Date(now - 1 * 86400_000).toISOString() },
  });
  const s = summarize(q, now);
  assert.equal(s.expiringSoon, 1);
  assert.equal(s.expired, 0, "a warning is not a death certificate");
});
