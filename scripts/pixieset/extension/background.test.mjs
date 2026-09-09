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
  const cancelled = [];
  const blobs = [];        // beacon bodies, as the offscreen doc would receive them
  const revoked = [];
  let nextId = 100;
  const chrome = {
    storage: { local: {
      get: async (k) => ({ [k]: store[k] }),
      set: async (o) => { Object.assign(store, o); },
    } },
    downloads: {
      download: async ({ url, filename }) => {
        const id = nextId++;
        requested.push({ id, url, filename });
        // A beacon is ~300 bytes; the real API completes it before the poll.
        if (filename) downloads[id] = { state: "complete" };
        return id;
      },
      cancel: async (id) => { cancelled.push(id); },
      // The real API returns an empty array for an unknown id — it does not throw.
      // filenameRegex is how downloadAll asks "do I already have this part?".
      search: async ({ id, filenameRegex, state }) => {
        if (filenameRegex) {
          const re = new RegExp(filenameRegex);
          return Object.entries(downloads)
            .filter(([, d]) => d.filename && re.test(d.filename) && (!state || d.state === state))
            .map(([k, d]) => ({ id: Number(k), ...d }));
        }
        return downloads[id] ? [{ id, ...downloads[id] }] : [];
      },
    },
    alarms: { create() {}, clear: async () => {}, onAlarm: { addListener() {} } },
    offscreen: { createDocument: async () => {} },
    runtime: {
      getContexts: async () => [{}],
      getURL: (p) => p,
      sendMessage: async (msg) => {
        if (msg.type === "blob") { blobs.push(JSON.parse(msg.text)); return { ok: true, url: `blob:px/${blobs.length}` }; }
        if (msg.type === "revoke") { revoked.push(msg.url); return { ok: true }; }
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
  return { chrome, store, asked, requested, cancelled, blobs, revoked, downloads, state: () => store["px.state"] };
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
  inflight: null, driving: null, repairs: ["2026-09-08-requeue-lost-downloads"], ...over,
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
  assert.deepEqual(h.cancelled, [1], "an abandoned transfer must be cancelled, or it lands beside the retry's copy");

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

// ------------------------------------------------------------ retirement beacons
//
// Retiring a collection without its bytes used to be recorded ONLY in a 60-line
// in-memory log that nothing reads unless a human opens the popup, so
// `queue.json` went on saying `queued` for work that had permanently left the
// queue. A beacon is a small JSON file the watcher already sweeps; these guard
// that every giving-up path writes one, and that a DEFERRAL does not.

test("giving up after three attempts announces it to the pipeline", async () => {
  const h = harness(base({ jobs: ["flaky"], attempts: { flaky: 2 } }), {
    drive: () => ({ ok: false, error: "R2 timeout" }),
  });
  const { tick } = await loadBackground(h.chrome);
  await tick();
  assert.equal(h.blobs.length, 1);
  assert.equal(h.blobs[0].kind, "px-retired");
  assert.equal(h.blobs[0].slug, "flaky");
  assert.equal(h.blobs[0].reason, "failed");
  assert.match(h.blobs[0].detail, /R2 timeout/);
  assert.equal(h.requested.at(-1).filename, "px-retired-flaky.json");
  assert.equal(h.revoked.length, 1, "a blob URL that is never revoked leaks the whole file");
});

test("a collection deleted on Pixieset announces itself as gone", async () => {
  const h = harness(base({ jobs: ["deleted"] }), { drive: () => ({ ok: false, httpStatus: 404 }) });
  const { tick } = await loadBackground(h.chrome);
  await tick();
  assert.equal(h.blobs[0].reason, "gone");
  assert.match(h.blobs[0].detail, /404/);
});

test("downloads switched off announces itself, and is not a failure", async () => {
  const h = harness(base({ jobs: ["locked-down"] }), { drive: () => ({ phase: "nodl" }) });
  const { tick } = await loadBackground(h.chrome);
  await tick();
  assert.equal(h.blobs[0].reason, "no-download");
});

test("a DEFERRED collection announces nothing — it is waiting, not retired", async () => {
  const h = harness(base({ jobs: ["gatedone", "next"] }), {
    drive: ({ slug }) => (slug === "gatedone" ? { phase: "gate" } : { ok: true, expect: 1, zips: [{ url: "u", size: "1 GB" }] }),
  });
  const { tick } = await loadBackground(h.chrome);
  await tick();
  assert.deepEqual(h.blobs, [], "a ledger row reading failed for work that is merely waiting is a lie with a long half-life");
});

test("a refused password IS a retirement and announces one", async () => {
  const h = harness(base({ jobs: ["locked"], passwords: { locked: "hunter2" } }), {
    drive: () => ({ phase: "gate" }),
  });
  const { tick } = await loadBackground(h.chrome);
  await tick();
  assert.equal(h.blobs[0].reason, "password-rejected");
  assert.ok(h.state().done.includes("locked"));
});

test("a beacon that cannot be written is shouted about, not swallowed", async () => {
  const h = harness(base({ jobs: ["flaky"], attempts: { flaky: 2 } }), {
    drive: () => ({ ok: false, error: "R2 timeout" }),
  });
  h.chrome.runtime.sendMessage = async (msg) =>
    msg.type === "blob" ? { ok: false, error: "offscreen closed" } : { ok: false, error: "R2 timeout" };
  const { tick } = await loadBackground(h.chrome);
  await tick();
  assert.match(h.state().log.join("\n"), /BEACON FAILED for flaky/, "a beacon that silently fails to arrive is the bug it exists to fix");
});

// ------------------------------------------------------------ big multi-part sets
//
// All three of these are atlassian-team26expo, 8,518 photos across 17 parts and
// 46 GB, live on 2026-09-08. It exposed every assumption that only holds for a
// small collection: a drive takes 19 minutes against a 20-minute alarm, one part
// out of seventeen failing is ordinary, and re-fetching the set to recover one
// part costs 46 GB on a disk with 113 GB free.

test("one failed part does not discard a set that is still landing", async () => {
  const h = harness(base({ jobs: ["big"] }), {
    drive: () => ({ ok: true, expect: 3, zips: [1, 2, 3].map((n) => ({ url: `u${n}`, name: `big-photo-download-${n}of3.zip`, size: "3 GB" })) }),
  });
  const { tick } = await loadBackground(h.chrome);
  await tick();
  const [a, b, c] = h.state().inflight.ids;

  h.downloads[a] = { state: "complete", filename: "big-photo-download-1of3.zip" };
  h.downloads[b] = { state: "interrupted", error: "NETWORK_FAILED" };
  h.downloads[c] = { state: "in_progress" };
  await tick();
  assert.equal(h.state().inflight?.slug, "big", "a failed part while others are moving is not a dead set");
  assert.equal(h.state().attempts.big ?? 0, 0, "the verdict waits until nothing is in flight");
  assert.deepEqual(h.cancelled, [], "cancelling a healthy transfer throws away good bytes");
});

test("a retry fetches only the parts that are missing", async () => {
  const zips = [1, 2, 3].map((n) => ({ url: `u${n}`, name: `big-photo-download-${n}of3.zip`, size: "3 GB" }));
  const h = harness(base({ jobs: ["big"] }), { drive: () => ({ ok: true, expect: 3, zips }) });
  const { tick } = await loadBackground(h.chrome);
  await tick();
  const ids = [...h.state().inflight.ids];
  // Two landed; the third failed and nothing is still moving.
  h.downloads[ids[0]] = { state: "complete", filename: "big-photo-download-1of3.zip" };
  h.downloads[ids[1]] = { state: "complete", filename: "big-photo-download-2of3.zip" };
  h.downloads[ids[2]] = { state: "interrupted", error: "NETWORK_FAILED" };
  await tick();                                   // settles as failed, waits a gap
  assert.equal(h.state().attempts.big, 1);

  const before = h.requested.length;
  await tick();                                   // the retry
  const fresh = h.requested.slice(before);
  assert.equal(fresh.length, 1, "re-fetching 46 GB to recover one part is how the disk fills");
  assert.equal(fresh[0].url, "u3");
  assert.match(h.state().log.join("\n"), /2 already on disk/);
});

test("a slow drive does not let the next alarm start a second one", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = harness(base({ jobs: ["big", "next"] }), {
    drive: async () => { await gate; return { ok: true, expect: 1, zips: [{ url: "u", name: "big-photo-download-1of1.zip", size: "1 GB" }] }; },
  });
  const { tick } = await loadBackground(h.chrome);

  const first = tick();                            // still inside the drive
  await new Promise((r) => setTimeout(r, 20));
  await tick();                                    // the 20-minute alarm fires again
  assert.deepEqual(h.asked, ["big"], "three concurrent drives requested three 46 GB archives");
  assert.match(h.state().log.join("\n"), /still being requested/);

  release();
  await first;
  assert.equal(h.state().driving, null, "the lock must not outlive the drive");
});

test("a drive that died with the service worker expires rather than blocking forever", async () => {
  const stale = new Date(Date.now() - 60 * 60_000).toISOString();
  const h = harness(base({ jobs: ["big"], driving: { slug: "big", at: stale } }), {
    drive: () => ({ phase: "nodl" }),
  });
  const { tick } = await loadBackground(h.chrome);
  await tick();
  assert.equal(h.asked.at(-1), "big", "a worker eviction must not stall the queue permanently");
  assert.match(h.state().log.join("\n"), /request abandoned after/);
});
