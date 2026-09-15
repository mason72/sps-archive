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
function harness(state, { drive, arm, downloads = {}, freeGB = 500, onDisk = "1.1.1", loaded = "1.1.1" } = {}) {
  const store = { "px.state": { ...state } };
  const asked = [];
  const requested = [];
  const cancelled = [];
  const blobs = [];        // beacon bodies, as the offscreen doc would receive them
  const revoked = [];
  // The watcher's loopback disk brake. `freeGB: null` stands in for "the watch
  // agent is not running", which must stop downloads rather than be ignored.
  const announced = [];    // status bodies the watcher would have received
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/status")) {
      if (freeGB === null) throw new Error("connection refused");
      announced.push(JSON.parse(init.body));
      return { ok: true, status: 204 };
    }
    if (!String(url).includes("/disk")) throw new Error(`unexpected fetch: ${url}`);
    if (freeGB === null) throw new Error("connection refused");
    return { ok: true, json: async () => ({ freeGB, floorGB: 25, at: new Date().toISOString(), manifestVersion: onDisk }) };
  };
  const reloads = [];
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
      getManifest: () => ({ version: loaded }),
      reload: () => { reloads.push(Date.now()); },
      getContexts: async () => [{}],
      getURL: (p) => p,
      sendMessage: async (msg) => {
        if (msg.type === "blob") { blobs.push(JSON.parse(msg.text)); return { ok: true, url: `blob:px/${blobs.length}` }; }
        if (msg.type === "revoke") { revoked.push(msg.url); return { ok: true }; }
        if (msg.type === "arm") return arm ? arm(msg) : { ok: false };
        asked.push(msg.slug);
        // Like offscreen.js: accept at once, answer later with a message of its
        // own. A drive stub that throws stands in for the offscreen document
        // refusing the job, so the send itself rejects.
        const out = drive ? drive(msg) : { ok: false, error: "no stub" };
        chrome._pending.push(Promise.resolve(out).then((result) =>
          new Promise((done) => chrome._onMessage[0](
            { target: "background", type: "driveResult", slug: msg.slug, token: msg.token, result }, null, done))));
        return { accepted: true };
      },
      onMessage: { addListener: (fn) => chrome._onMessage.push(fn) },
      onStartup: { addListener: (fn) => chrome._onStartup.push(fn) },
      onInstalled: { addListener() {} },
    },
    _onMessage: [],
    _onStartup: [],        // startup listeners, so a test can fire a Chrome restart
    _pending: [],          // drive answers still on their way back
  };
  return { chrome, store, asked, requested, cancelled, blobs, revoked, downloads, announced, reloads, state: () => store["px.state"] };
}

async function loadBackground(chrome) {
  globalThis.chrome = chrome;
  const src = fs.readFileSync(SRC, "utf8") + "\nexport { tick, applyRepairs, afterReload, heartbeat };\n";
  const f = path.join(os.tmpdir(), `px-bg-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(f, src);
  let mod;
  try { mod = await import(`file://${f}`); } finally { fs.unlinkSync(f); }
  // `tick` also waits for the drive's answer to come back and be handled, which
  // is what one alarm plus one driveResult message amount to in Chrome.
  // `tickOnly` returns as the real tick does: once the drive is dispatched.
  const tick = async () => {
    await mod.tick();
    while (chrome._pending.length) await chrome._pending.shift();
  };
  return { tick, tickOnly: mod.tick, applyRepairs: mod.applyRepairs, afterReload: mod.afterReload, heartbeat: mod.heartbeat };
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

test("a repair moves named collections to the head of the queue, and never adds one it cannot find", async () => {
  // ffdc2015 and foothillsteamphotos were downloaded before the extension ran,
  // so the 09-14 requeue had nothing to undo: they sat 1,132nd and 1,133rd of
  // 1,136 remaining, months away, with Pixieset their only copy.
  const h = harness(base({ jobs: ["x", "foothillsteamphotos", "y", "ffdc2015", "z"], done: ["x"], repairs: [] }));
  const { applyRepairs } = await loadBackground(h.chrome);
  const s = { ...h.state() };
  const r = applyRepairs(s).find((a) => a.id === "2026-09-15-front-portrait-originals");
  assert.deepEqual(s.jobs, ["ffdc2015", "foothillsteamphotos", "x", "y", "z"], "named order at the head, the rest untouched");
  assert.equal(r.front, 2);
  assert.deepEqual(r.missing, []);

  const h2 = harness(base({ jobs: ["x", "ffdc2015"], repairs: [] }));
  const { applyRepairs: apply2 } = await loadBackground(h2.chrome);
  const s2 = { ...h2.state() };
  const r2 = apply2(s2).find((a) => a.id === "2026-09-15-front-portrait-originals");
  assert.deepEqual(s2.jobs, ["ffdc2015", "x"], "a name missing from jobs is reported, never added");
  assert.deepEqual(r2.missing, ["foothillsteamphotos"]);
});

test("a reload releases the lock of the drive it killed, and counts no attempt", async () => {
  // A reload kills the offscreen document mid-build, but the lock survives in
  // storage. Found 2026-09-15 before a reload would have stranded docusignignite.
  // The slug here is named by NO repair: a repair that requeues a slug also
  // releases its lock, which would make the control below pass for that reason
  // instead (the first version used docusignignite and did exactly that).
  const killed = { slug: "slowbuild", at: new Date(Date.now() - 60_000).toISOString(), token: "old" };
  const drive = () => ({ ok: true, zips: [{ url: "u", size: "1 GB" }], expect: 1 });

  // Control: with nothing releasing it, a fresh dead lock blocks every request.
  const stuck = harness(base({ jobs: ["slowbuild", "next"], driving: killed }), { drive });
  const { tick: stuckTick } = await loadBackground(stuck.chrome);
  await stuckTick();
  assert.deepEqual(stuck.asked, [], "the dead lock holds the queue");

  const h = harness(base({ jobs: ["slowbuild", "next"], driving: killed }), { drive });
  const { tick, afterReload } = await loadBackground(h.chrome);
  const lines = afterReload(h.state());
  assert.equal(h.state().driving, null, "the reload releases the lock");
  assert.match(lines.join("\n"), /slowbuild: its drive died with the reload/);
  await tick();
  assert.deepEqual(h.asked, ["slowbuild"], "asked again straight away");
  assert.equal(h.state().attempts.slowbuild ?? 0, 0, "and no attempt is counted");
});

test("a Chrome restart releases the dead drive lock too, not only a reload", async () => {
  // A restart or a Mac reboot kills the drive exactly as a reload does, but only
  // onStartup fires for it. Fires the REAL registered listener, not the helper.
  const killed = { slug: "slowbuild", at: new Date(Date.now() - 60_000).toISOString(), token: "old" };
  const drive = () => ({ ok: true, zips: [{ url: "u", size: "1 GB" }], expect: 1 });
  const h = harness(base({ jobs: ["slowbuild", "next"], driving: killed }), { drive });
  const { tick } = await loadBackground(h.chrome);
  assert.equal(h.chrome._onStartup.length, 1, "the startup listener is registered");
  await h.chrome._onStartup[0]();
  assert.equal(h.state().driving, null, "the restart releases the lock");
  assert.match(h.state().log.join("\n"), /slowbuild: its drive died with the Chrome restart/);
  await tick();
  assert.deepEqual(h.asked, ["slowbuild"], "asked again straight away");
  assert.equal(h.state().attempts.slowbuild ?? 0, 0, "and no attempt is counted");
});

test("a repair can set a collection aside without retiring it, and the queue moves at once", async () => {
  // The reload that ships the never-answers fix must unblock the queue right
  // away, not spend three more hours of 128 GB build requests retiring it.
  const hung = { slug: "servicenowsko26", at: new Date(Date.now() - 20 * 60_000).toISOString() };
  const h = harness(base({ jobs: ["servicenowsko26", "next"], driving: hung }), { freeGB: 158, drive: () => ({ phase: "nodl" }) });
  const { tick } = await loadBackground(h.chrome);
  await tick();
  assert.deepEqual(h.asked, ["next"]);
  assert.equal(h.state().tooBig.servicenowsko26, 128);
  assert.ok(!h.state().done.includes("servicenowsko26"), "set aside is not retired");
  assert.equal(h.state().attempts.servicenowsko26 ?? 0, 0, "and burns no attempt");
  assert.ok(!h.blobs.some((b) => b.slug === "servicenowsko26"), "and writes no retirement beacon");
  assert.match(h.state().log.join("\n"), /1 set aside until the disk can hold it/);
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
  const { tickOnly } = await loadBackground(h.chrome);

  await tickOnly();                                // dispatched; the drive is still building
  await tickOnly();                                // the 20-minute alarm fires again
  assert.deepEqual(h.asked, ["big"], "three concurrent drives requested three 46 GB archives");
  assert.match(h.state().log.join("\n"), /still being requested/);

  release();
  await h.chrome._pending.shift();
  assert.equal(h.state().driving, null, "the lock must not outlive the drive");
});

// ------------------------------------------------------------ answers outlive the worker
//
// 2026-09-14/15: guidewireconnectionspwc, money2020au10tix-1, breakthrough2025
// and docusignignite all retired for "drive never answered". They did answer.
// The tick awaited the reply, Chrome killed the worker ~5 minutes in, and the
// reply to a dead channel went nowhere. Only sentinelone got through, at 5m43s.

test("the tick returns before the drive finishes, and the answer still lands", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const zips = [{ url: "u", name: "slow-photo-download-1of1.zip", size: "6 GB" }];
  const h = harness(base({ jobs: ["slow"] }), { drive: async () => { await gate; return { ok: true, expect: 1, zips }; } });
  const { tickOnly } = await loadBackground(h.chrome);

  await tickOnly();                                // a worker that dies now has lost nothing
  assert.equal(h.state().driving.slug, "slow");
  assert.ok(h.state().driving.token, "the lock carries the token the answer must match");
  assert.equal(h.state().inflight, null);

  release();                                       // the build finishes, 20 minutes later
  await h.chrome._pending.shift();
  assert.equal(h.state().driving, null);
  assert.equal(h.state().inflight?.slug, "slow", "the answer is acted on by whichever worker is alive");
  assert.equal(h.requested.length, 1);
  assert.equal(h.state().attempts.slow ?? 0, 0);
});

test("an answer that arrives after its lock expired is still used if nothing else started", async () => {
  const zips = [{ url: "u", name: "late-photo-download-1of1.zip", size: "2 GB" }];
  const h = harness(base({ jobs: ["late", "next"], attempts: { late: 1 } }));
  await loadBackground(h.chrome);
  const listener = h.chrome._onMessage[0];
  await new Promise((done) => listener({ target: "background", type: "driveResult", slug: "late", token: "old", result: { ok: true, expect: 1, zips } }, null, done));
  assert.equal(h.state().inflight?.slug, "late", "discarding good links means a whole new build at Pixieset");
  assert.match(h.state().log.join("\n"), /answered after its lock expired/);
});

test("a late FAILURE is not counted a second time", async () => {
  // Its lock already expired and counted an attempt; counting the answer too
  // would let two slow drives retire a healthy collection.
  const h = harness(base({ jobs: ["slow"], attempts: { slow: 1 } }));
  await loadBackground(h.chrome);
  const listener = h.chrome._onMessage[0];
  await new Promise((done) => listener({ target: "background", type: "driveResult", slug: "slow", token: "old", result: { ok: false, error: "not ready after 35m of polling" } }, null, done));
  assert.equal(h.state().attempts.slow, 1);
  assert.match(h.state().log.join("\n"), /late drive result ignored/);
});

test("a result whose handling throws is acknowledged and counted once", async () => {
  const zips = [{ url: "u", name: "x-photo-download-1of1.zip", size: "1 GB" }];
  const h = harness(base({ jobs: ["x"], driving: { slug: "x", at: new Date().toISOString(), token: "t" } }));
  h.chrome.downloads.download = async () => { throw new Error("disk said no"); };
  await loadBackground(h.chrome);
  const listener = h.chrome._onMessage[0];
  const ack = await new Promise((done) => listener({ target: "background", type: "driveResult", slug: "x", token: "t", result: { ok: true, expect: 1, zips } }, null, done));
  assert.equal(ack.ok, true, "an unacknowledged result is re-sent, and a re-run restarts running parts");
  assert.equal(h.state().driving, null);
  assert.equal(h.state().attempts.x, 1);
});

test("a late answer is dropped when another collection has already started", async () => {
  const zips = [{ url: "u", name: "late-photo-download-1of1.zip", size: "2 GB" }];
  const h = harness(base({ jobs: ["late", "now"], driving: { slug: "now", at: new Date().toISOString(), token: "new" } }));
  await loadBackground(h.chrome);
  const listener = h.chrome._onMessage[0];
  await new Promise((done) => listener({ target: "background", type: "driveResult", slug: "late", token: "old", result: { ok: true, expect: 1, zips } }, null, done));
  assert.deepEqual(h.requested, [], "two collections downloading at once is the 09-01 disk accident");
  assert.equal(h.state().driving.slug, "now", "and the running drive keeps its lock");
  assert.match(h.state().log.join("\n"), /late drive result ignored — now is being requested/);
});

test("the 09-15 repair re-queues retired AND mid-attempt collections, and frees their lock", async () => {
  const hung = { slug: "connect25schmidtfamilyfoundation", at: new Date().toISOString(), token: "t" };
  const h = harness(base({
    repairs: ["2026-09-08-requeue-lost-downloads", "2026-09-09-requeue-atlassian", "2026-09-13-set-aside-servicenowsko26", "2026-09-14-requeue-portrait-originals"],
    done: ["guidewireconnectionspwc", "docusignignite", "keepme"],
    attempts: { guidewireconnectionspwc: 3, connect25schmidtfamilyfoundation: 2 },
    driving: hung,
  }));
  const { applyRepairs } = await loadBackground(h.chrome);
  const s = { ...h.state() };
  const [r] = applyRepairs(s);
  assert.equal(r.count, 2);
  assert.deepEqual(s.done, ["keepme"]);
  assert.deepEqual(s.attempts, {}, "an attempt still counting down would retire it again after two blips");
  assert.equal(s.driving, null, "a lock from the replaced worker would stall the queue for 50 minutes");
});

test("a drive that died with the service worker counts as an attempt, and the retry waits a tick", async () => {
  const stale = new Date(Date.now() - 60 * 60_000).toISOString();
  const h = harness(base({ jobs: ["big"], driving: { slug: "big", at: stale } }), {
    drive: () => ({ phase: "nodl" }),
  });
  const { tick } = await loadBackground(h.chrome);
  await tick();
  assert.equal(h.state().driving, null, "a worker eviction must not stall the queue permanently");
  assert.match(h.state().log.join("\n"), /request abandoned after/);
  assert.equal(h.state().attempts.big, 1, "a drive that never answered is a failed attempt");
  assert.deepEqual(h.asked, [], "and the retry is not instant");
  await tick();
  assert.equal(h.asked.at(-1), "big");
});

test("a drive that never answers three times is retired, and the queue moves on", async () => {
  // servicenowsko26, 2026-09-11 → 09-13: 34,274 photos, re-requested every hour
  // for 44 hours, because an expired lock was never counted as a failure.
  const stale = new Date(Date.now() - 60 * 60_000).toISOString();
  const h = harness(base({ jobs: ["hangs", "after"], attempts: { hangs: 2 }, driving: { slug: "hangs", at: stale } }), {
    drive: () => ({ phase: "nodl" }),
  });
  const { tick } = await loadBackground(h.chrome);
  await tick();
  assert.ok(h.state().done.includes("hangs"));
  assert.match(h.state().log.join("\n"), /failed 3x \(drive never answered/);
  assert.equal(h.blobs.at(-1)?.slug, "hangs", "retiring it must reach the ledger, not just the log");
  await tick();
  assert.equal(h.asked.at(-1), "after");
});

test("an offscreen error counts as an attempt", async () => {
  const h = harness(base({ jobs: ["x"] }), { drive: () => { throw new Error("Could not establish connection"); } });
  const { tick } = await loadBackground(h.chrome);
  await tick();
  assert.equal(h.state().attempts.x, 1, "an error that retries forever is the same livelock");
  assert.equal(h.state().driving, null);
  assert.match(h.state().log.join("\n"), /offscreen failed/);
});

// ------------------------------------------------------------ the disk brake
//
// An extension cannot see the disk, so this one drove the mini's startup volume
// from 117 GB to 47 GB on 2026-09-08 — requesting a 46 GB collection against 53
// GB free while the ingest sat halted below its own floor, unable to drain.
// Every other stage had a floor; the stage that consumes the space had none.

test("no disk answer means no download", async () => {
  const h = harness(base({ jobs: ["big"] }), { freeGB: null, drive: () => ({ ok: true, expect: 1, zips: [{ url: "u", name: "n.zip", size: "1 GB" }] }) });
  const { tick } = await loadBackground(h.chrome);
  await tick();
  assert.deepEqual(h.asked, [], "a guard that fails open on an unreachable check is not a guard");
  assert.match(h.state().log.join("\n"), /disk check unreachable/);
});

test("below the start floor it does not even begin a collection", async () => {
  const h = harness(base({ jobs: ["big"] }), { freeGB: 53, drive: () => ({ ok: true, expect: 1, zips: [{ url: "u", name: "n.zip", size: "1 GB" }] }) });
  const { tick } = await loadBackground(h.chrome);
  await tick();
  assert.deepEqual(h.asked, [], "53 GB free is where the 09-08 near-miss started");
  assert.match(h.state().log.join("\n"), /below the 80 GB start floor/);
});

test("an archive that would starve the ingest is left queued, not failed", async () => {
  // 100 GB free, a 46 GB archive: it fits, but leaves 54 — under the 60 the
  // ingest needs to run, so nothing would ever drain afterwards.
  const zips = [{ url: "u1", name: "a.zip", size: "40 GB" }, { url: "u2", name: "b.zip", size: "6 GB" }];
  const h = harness(base({ jobs: ["huge"] }), { freeGB: 100, drive: () => ({ ok: true, expect: 2, zips }) });
  const { tick } = await loadBackground(h.chrome);
  await tick();
  assert.deepEqual(h.requested, [], "downloading it is how a tight disk becomes a stuck one");
  assert.equal(h.state().done.length, 0, "not fitting today is not a failure");
  assert.equal(h.state().attempts.huge ?? 0, 0, "and it must not burn an attempt");
  assert.match(h.state().log.join("\n"), /needs 46.0 GB and only 100 GB is free/);
});

test("an archive too big for today's disk steps aside instead of holding the head", async () => {
  const zips = [{ url: "u1", name: "a.zip", size: "40 GB" }, { url: "u2", name: "b.zip", size: "6 GB" }];
  const h = harness(base({ jobs: ["huge", "next"] }), {
    freeGB: 100,
    drive: ({ slug }) => (slug === "huge" ? { ok: true, expect: 2, zips } : { phase: "nodl" }),
  });
  const { tick } = await loadBackground(h.chrome);
  await tick();
  assert.equal(h.state().tooBig.huge, 46);
  await tick();
  assert.deepEqual(h.asked, ["huge", "next"], "re-requesting it every tick is a fresh 46 GB build at Pixieset each time");
  assert.equal(h.state().attempts.huge ?? 0, 0, "not fitting is still not a failure");

  // The space arrives, and it comes back by itself.
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ freeGB: 200, floorGB: 25 }) });
  await tick();
  assert.equal(h.asked.at(-1), "huge");
  assert.equal(h.state().inflight?.slug, "huge");
  assert.equal(h.state().tooBig.huge, undefined, "once requested it is no longer set aside");
});

test("it downloads when the archive fits with the ingest's floor left over", async () => {
  const zips = [{ url: "u1", name: "a.zip", size: "10 GB" }, { url: "u2", name: "b.zip", size: "500 MB" }];
  const h = harness(base({ jobs: ["fits"] }), { freeGB: 100, drive: () => ({ ok: true, expect: 2, zips }) });
  const { tick } = await loadBackground(h.chrome);
  await tick();
  assert.equal(h.requested.length, 2);
  assert.equal(h.state().inflight.slug, "fits");
});

test("MB and KB labels are not read as gigabytes", async () => {
  // 189.9 MB parsed as 189.9 GB would refuse every multi-part collection
  // forever, and the refusal would look like a disk problem.
  const zips = Array.from({ length: 9 }, (_, i) => ({ url: `u${i}`, name: `${i}.zip`, size: "900 MB" }));
  // 85 GB free: above the start floor, so the run reaches the size gate and the
  // parsing is what decides. Misread as GB, 9 x 900 would be 8,100 GB and the
  // collection would be refused forever with a message about disk.
  const h = harness(base({ jobs: ["small-parts"] }), { freeGB: 85, drive: () => ({ ok: true, expect: 9, zips }) });
  const { tick } = await loadBackground(h.chrome);
  await tick();
  assert.equal(h.requested.length, 9, "9 x 900 MB is 7.9 GB, which fits in 85 GB with 60 to spare");
});

test("every save is announced to the watcher, last state wins, and a dead watcher costs nothing", async () => {
  // The announce is trailing-edge throttled, so a burst of saves lands ONE body
  // carrying the final state — the popup's shape, plus the code version.
  const h = harness(base({ jobs: ["a"] }), { drive: () => ({ ok: true, zips: [{ url: "u", size: "1 GB" }], expect: 1 }) });
  const { tick } = await loadBackground(h.chrome);
  await tick();
  await new Promise((r) => setTimeout(r, 1700));
  // A tick spans more than one 1.5s window (the drive answers asynchronously),
  // so several POSTs is normal; what matters is that the LAST one carries the
  // final state, and that there are far fewer POSTs than saves.
  assert.ok(h.announced.length >= 1 && h.announced.length <= 4, `throttled: ${h.announced.length} POSTs`);
  const last = h.announced.at(-1);
  assert.equal(last.version, "1.1.1");
  assert.equal(typeof last.running, "boolean");
  assert.ok(Array.isArray(last.log), "the watcher gets the same log tail the popup shows");
  assert.equal(last.lastTickAt, h.state().lastTickAt, "and the newest tick time");

  // Watcher down: the download path must be unaffected, and nothing may throw.
  const dead = harness(base({ jobs: ["a"] }), { freeGB: null });
  const { tick: deadTick } = await loadBackground(dead.chrome);
  await deadTick();
  await new Promise((r) => setTimeout(r, 1700));
  assert.deepEqual(dead.announced, []);
});

test("newer code on disk reloads the extension — but never mid-drive", async () => {
  const h = harness(base({ jobs: ["a"] }), { onDisk: "1.2.0", loaded: "1.1.1" });
  const { tick } = await loadBackground(h.chrome);
  await tick();
  assert.equal(h.reloads.length, 1, "1.2.0 on disk, 1.1.1 running: reload");
  assert.deepEqual(h.asked, [], "and nothing is requested on the tick that reloads");
  assert.match(h.state().log.join("\n"), /code on disk is 1.2.0, running 1.1.1/);

  const busy = harness(base({ jobs: ["a"], driving: { slug: "a", at: new Date().toISOString(), token: "t" } }), { onDisk: "1.2.0", loaded: "1.1.1" });
  const { tick: busyTick } = await loadBackground(busy.chrome);
  await busyTick();
  assert.equal(busy.reloads.length, 0, "a drive is automating a form right now; the reload waits");

  const same = harness(base({ jobs: ["a"] }), { onDisk: "1.1.1", loaded: "1.1.1" });
  const { tick: sameTick } = await loadBackground(same.chrome);
  await sameTick();
  assert.equal(same.reloads.length, 0, "matching versions never reload");
});

test("a STOPPED extension still reports on its heartbeat, and still picks up newer code", async () => {
  // The tick alarm is cleared on Stop; before the heartbeat a stopped extension
  // could neither say it was stopped nor notice code on disk had changed.
  const h = harness(base({ jobs: ["a"], running: false, stoppedReason: "stopped by hand" }));
  const { heartbeat } = await loadBackground(h.chrome);
  await heartbeat();
  await new Promise((r) => setTimeout(r, 1700));
  // Earlier tests' trailing announce timers can fire into this harness's fetch
  // mock, so judge the LAST body, not the count.
  assert.ok(h.announced.length >= 1);
  assert.equal(h.announced.at(-1).running, false);
  assert.equal(h.announced.at(-1).stoppedReason, "stopped by hand");
  assert.deepEqual(h.asked, [], "a heartbeat never requests anything");

  const stale = harness(base({ jobs: ["a"], running: false }), { onDisk: "1.2.0", loaded: "1.1.1" });
  const { heartbeat: staleBeat } = await loadBackground(stale.chrome);
  await staleBeat();
  assert.equal(stale.reloads.length, 1, "stopped is exactly when a reload is cheapest");
});
