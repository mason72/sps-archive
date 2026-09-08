/**
 * Tests for the download scheduler.
 *
 *   node --test scripts/pixieset/extension/background.test.mjs
 *
 * Both bugs these guard were live in production and both were SILENT:
 *
 *  1. A gated collection was deferred but still chosen as "first job not done",
 *     so it came back to the head of the queue every 20 minutes. Measured:
 *     `sjcbubblebash-2026` requested and deferred 104 times across 32 hours
 *     while 1,191 collections behind it were never reached.
 *
 *  2. A collection was retired the moment `chrome.downloads.download()` accepted
 *     a URL — success at the REQUEST, not the ARRIVAL. When the disk filled on
 *     2026-09-01/02, five collections (14,516 photos) left the queue without
 *     their bytes ever landing.
 *
 * `background.js` is a service worker, so it is loaded here against a stub
 * `chrome` and re-exported from a temp copy. The stub is deliberately literal:
 * `downloads.search` returns [] for an id Chrome has forgotten, exactly as the
 * real API does, because that case is one of the failure paths.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SRC = new URL("./background.js", import.meta.url);

/** A chrome stub, plus the levers a test needs to drive it. */
function harness(state, { drive, arm, downloads = {} } = {}) {
  const store = { "px.state": { ...state } };
  const asked = [];
  const requested = [];
  let nextId = 100;
  const chrome = {
    storage: { local: {
      get: async (k) => ({ [k]: store[k] }),
      set: async (o) => { Object.assign(store, o); },
    } },
    downloads: {
      download: async ({ url }) => { const id = nextId++; requested.push({ id, url }); return id; },
      // The real API returns an empty array for an unknown id — it does not throw.
      search: async ({ id }) => (downloads[id] ? [{ id, ...downloads[id] }] : []),
    },
    alarms: { create() {}, clear: async () => {}, onAlarm: { addListener() {} } },
    offscreen: { createDocument: async () => {} },
    runtime: {
      getContexts: async () => [{}],
      getURL: (p) => p,
      sendMessage: async (msg) => {
        if (msg.type === "arm") return arm ? arm(msg) : { ok: false };
        asked.push(msg.slug);
        return drive ? drive(msg) : { ok: false, error: "no stub" };
      },
      onMessage: { addListener: (fn) => chrome._onMessage.push(fn) },
      onStartup: { addListener() {} },
      onInstalled: { addListener() {} },
    },
    _onMessage: [],
  };
  return { chrome, store, asked, requested, downloads, state: () => store["px.state"] };
}

async function loadBackground(chrome) {
  globalThis.chrome = chrome;
  const src = fs.readFileSync(SRC, "utf8") + "\nexport { tick, applyRepairs };\n";
  const f = path.join(os.tmpdir(), `px-bg-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(f, src);
  try { return await import(`file://${f}`); } finally { fs.unlinkSync(f); }
}

const base = (over = {}) => ({
  running: true, jobs: [], done: [], gated: [], noDownload: [], gone: [],
  passwords: {}, results: [], log: [], attempts: {}, challenges: 0, gapMinutes: 20,
  inflight: null, repairs: ["2026-09-08-requeue-lost-downloads"], ...over,
});

test("a deferred collection leaves the head of the queue", async () => {
  const h = harness(base({ jobs: ["gatedone", "next", "third"] }), {
    drive: ({ slug }) => (slug === "gatedone" ? { phase: "gate" } : { ok: true, zips: [{ url: "u", size: "1 GB" }], expect: 1 }),
  });
  const { tick } = await loadBackground(h.chrome);

  await tick();
  assert.deepEqual(h.state().gated, ["gatedone"], "no password armed, so it is deferred");
  assert.ok(!h.state().done.includes("gatedone"), "deferring must not retire it");

  await tick();
  assert.deepEqual(h.asked, ["gatedone", "next"], "the second wake-up must move on, not re-ask the gated one");
});

test("everything left being gated stops with the reason, not 'queue drained'", async () => {
  const h = harness(base({ jobs: ["onlyone"] }), { drive: () => ({ phase: "gate" }) });
  const { tick } = await loadBackground(h.chrome);
  await tick();
  await tick();
  assert.equal(h.state().running, false);
  assert.match(h.state().stoppedReason, /deferred for passwords/, "a deferral is not a finished migration");
});

test("arming passwords puts deferred collections back in the queue", async () => {
  const h = harness(base({ jobs: ["locked"], gated: ["locked"] }), {
    arm: () => ({ ok: true, map: { locked: "hunter2" }, total: 1 }),
  });
  const { tick } = await loadBackground(h.chrome);
  const listener = h.chrome._onMessage[0];
  await new Promise((done) => listener({ target: "background", type: "arm" }, null, () => done()));
  assert.deepEqual(h.state().gated, [], "a collection whose password just arrived must be retryable");
  await tick();
  assert.deepEqual(h.asked, ["locked"]);
});

test("a collection is retired only once every byte has landed", async () => {
  const h = harness(base({ jobs: ["big"] }), {
    drive: () => ({ ok: true, expect: 2, zips: [{ url: "a", size: "3 GB" }, { url: "b", size: "2 GB" }] }),
  });
  const { tick } = await loadBackground(h.chrome);

  await tick();
  assert.equal(h.state().done.length, 0, "accepting the URL is not arrival");
  assert.equal(h.state().inflight.slug, "big");
  const [a, b] = h.state().inflight.ids;

  h.downloads[a] = { state: "complete" };
  h.downloads[b] = { state: "in_progress" };
  await tick();
  assert.equal(h.state().done.length, 0, "one part landed is not the set");
  assert.equal(h.asked.length, 1, "a tick must not stack a second collection on an unfinished one");

  h.downloads[b] = { state: "complete" };
  await tick();
  assert.deepEqual(h.state().done, ["big"]);
  assert.equal(h.state().inflight, null);
  assert.equal(h.state().results.at(-1).sizes, "3 GB+2 GB");
});

test("an interrupted download leaves the collection in the queue", async () => {
  const h = harness(base({ jobs: ["big", "after"] }), {
    drive: () => ({ ok: true, expect: 1, zips: [{ url: "a", size: "3 GB" }] }),
  });
  const { tick } = await loadBackground(h.chrome);
  await tick();
  h.downloads[h.state().inflight.ids[0]] = { state: "interrupted", error: "FILE_NO_SPACE" };

  await tick();
  assert.equal(h.state().done.length, 0, "a failed download must not retire the collection");
  assert.equal(h.state().attempts.big, 1);
  assert.match(h.state().log.join("\n"), /FILE_NO_SPACE/, "the reason has to be recorded, not just the failure");
});

test("a download Chrome has forgotten counts as failure, not success", async () => {
  const h = harness(base({ jobs: ["big"] }), {
    drive: () => ({ ok: true, expect: 1, zips: [{ url: "a", size: "1 GB" }] }),
  });
  const { tick } = await loadBackground(h.chrome);
  await tick();                       // downloads map stays empty: search() returns []
  await tick();
  assert.equal(h.state().done.length, 0, "cannot prove it arrived is not the same as it arrived");
  assert.match(h.state().log.join("\n"), /missing from Chrome's history/);
});

test("three failed attempts retire the collection with a reason and move on", async () => {
  const h = harness(base({ jobs: ["flaky", "after"], attempts: { flaky: 2 } }), {
    drive: ({ slug }) => (slug === "flaky" ? { ok: false, error: "R2 timeout" } : { phase: "nodl" }),
  });
  const { tick } = await loadBackground(h.chrome);
  await tick();
  assert.ok(h.state().done.includes("flaky"));
  assert.match(h.state().log.join("\n"), /failed 3x \(R2 timeout\)/);
  await tick();
  assert.equal(h.asked.at(-1), "after", "the queue keeps moving");
});

test("a stalled download is given up after the timeout, and the retry waits a tick", async () => {
  const long = new Date(Date.now() - 7 * 3600_000).toISOString();
  const h = harness(base({ jobs: ["stalled", "after"], inflight: { slug: "stalled", ids: [1], sizes: "9 GB", at: long } }), {
    drive: () => ({ phase: "nodl" }),
    downloads: { 1: { state: "in_progress" } },
  });
  const { tick } = await loadBackground(h.chrome);

  await tick();
  assert.equal(h.state().inflight, null);
  assert.match(h.state().log.join("\n"), /timed out after/);
  assert.deepEqual(h.asked, [], "the usual cause is a full disk, so the retry must not be instant");

  await tick();
  assert.equal(h.asked.at(-1), "stalled", "attempt 2 of 3, one gap later");
  assert.equal(h.state().attempts.stalled, 1);
});

test("a repair puts lost collections back exactly once", async () => {
  const h = harness(base({ jobs: ["mcapsseattle2026", "keepme"], done: ["mcapsseattle2026", "keepme"], repairs: [] }));
  const { applyRepairs } = await loadBackground(h.chrome);
  const s = { ...h.state() };

  const first = applyRepairs(s);
  assert.equal(first[0].count, 1);
  assert.deepEqual(s.done, ["keepme"], "only the named collections come back");

  s.done.push("mcapsseattle2026");            // pretend it downloaded again
  const second = applyRepairs(s);
  assert.deepEqual(second, [], "a reload must not undo real work a second time");
  assert.ok(s.done.includes("mcapsseattle2026"));
});
