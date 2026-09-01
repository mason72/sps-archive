/**
 * The scheduler. One collection per wake-up, state on disk, no tab.
 *
 * WHY THIS SHAPE. The in-page driver worked and died five times — session
 * teardown, Chrome restart, tab closed, tab closed, tab gone — and each death
 * was silent, so the migration sat idle until Mason thought to ask. The download
 * half is the only stage that was not a launchd agent, and it is the only stage
 * that kept stopping.
 *
 * The obvious fix, a nightly Playwright pass, does not work here: Cloudflare
 * challenged it three times across 26 hours, the last at the front door, while
 * Mason's own Chrome answered 200 on the same URL in the same minute. So the
 * surface has to stay HIS Chrome — which is exactly what an extension is.
 *
 * A Manifest V3 service worker is killed whenever it goes idle, so a long loop
 * is impossible. That is a feature. Instead: chrome.alarms wakes us, we do ONE
 * collection, we persist, we exit. Nothing is held in memory between wakes, so
 * there is no state to lose when Chrome shuts the worker down, restarts, or the
 * Mac reboots. The failure mode that plagued the tab cannot occur.
 */

const STATE = "px.state";
const ALARM = "px.tick";

const DEFAULTS = {
  running: false,
  jobs: [],            // slugs, in the order they should be attempted
  done: [],            // slugs finished — survives everything, so restarts resume
  gated: [],           // deferred: gated with no password armed. NOT done.
  noDownload: [],      // downloads switched off on the collection itself
  passwords: {},       // url_key -> gallery password. Never logged.
  results: [],         // last 40, for the popup
  log: [],             // last 60 scrubbed lines
  cursor: 0,
  attempts: {},        // slug -> consecutive failures, so a bad one cannot livelock
  gone: [],            // 404/410 — deleted on Pixieset since the inventory sweep
  challenges: 0,
  gapMinutes: 20,
  email: "mason72@gmail.com",
  lastTickAt: null,
  stoppedReason: null,
};

const load = async () => ({ ...DEFAULTS, ...((await chrome.storage.local.get(STATE))[STATE] ?? {}) });
const save = (s) => chrome.storage.local.set({ [STATE]: s });

function note(s, line) {
  s.log.push(`${new Date().toISOString().slice(11, 19)} ${line}`);
  if (s.log.length > 60) s.log.shift();
}

/** One offscreen document, created on demand and reused. */
async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (existing.length) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["DOM_PARSER"],
    justification: "Parse Pixieset's download pages, which are HTML, to find the archive links.",
  });
}

async function ask(msg) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ target: "offscreen", ...msg });
}

/**
 * Hand the zip URLs to Chrome's own downloader.
 *
 * No filename is supplied on purpose: Pixieset sets Content-Disposition, and the
 * watcher on disk matches the exact name it produces
 * (`{slug}-photo-download-NofM.zip`). Inventing a name here would break the
 * handoff to a pipeline that already works.
 */
async function downloadAll(zips) {
  const ids = [];
  for (const z of zips) {
    const id = await chrome.downloads.download({ url: z.url, conflictAction: "uniquify" });
    ids.push(id);
    await new Promise((r) => setTimeout(r, 1500));   // stagger: simultaneous starts can drop one
  }
  return ids;
}

async function tick() {
  const s = await load();
  s.lastTickAt = new Date().toISOString();

  if (!s.running) { await save(s); return; }

  const remaining = s.jobs.filter((j) => !s.done.includes(j));
  if (!remaining.length) {
    s.running = false;
    s.stoppedReason = "queue drained";
    note(s, "queue drained — nothing left to request");
    await save(s);
    return;
  }

  const slug = remaining[0];
  note(s, `→ ${slug}`);
  await save(s);                                   // record intent BEFORE the work

  let r;
  try {
    r = await ask({ type: "drive", slug, password: s.passwords[slug], opts: { email: s.email, pollTries: 120 } });
  } catch (e) {
    note(s, `${slug}: offscreen failed — ${String(e?.message ?? e).slice(0, 80)}`);
    await save(s);
    return;                                        // try again next tick
  }
  if (!r) { note(s, `${slug}: no result from offscreen`); await save(s); return; }

  const s2 = await load();                          // re-read: a popup may have written
  s2.lastTickAt = s.lastTickAt;
  s2.log = s.log;

  if (r.phase === "challenged") {
    s2.challenges = (s2.challenges || 0) + 1;
    note(s2, `${slug}: CLOUDFLARE CHALLENGE (${s2.challenges}/3)`);
    if (s2.challenges >= 3) {
      s2.running = false;
      s2.stoppedReason = "Cloudflare challenged three times — stopped deliberately, do not work around it";
      note(s2, "STOPPED — challenged repeatedly");
    }
    await save(s2);
    return;
  }
  s2.challenges = 0;

  if (r.phase === "gate") {
    // Only retire it if a password was actually tried and refused. With none
    // armed it stays queued, or an unarmed run would silently retire all 282.
    if (s2.passwords[slug]) { s2.done.push(slug); note(s2, `${slug}: password rejected`); }
    else { if (!s2.gated.includes(slug)) s2.gated.push(slug); note(s2, `${slug}: gated, deferred`); }
    await save(s2);
    return;
  }

  if (r.phase === "nodl") {
    if (!s2.noDownload.includes(slug)) s2.noDownload.push(slug);
    s2.done.push(slug);
    note(s2, `${slug}: downloads disabled`);
    await save(s2);
    return;
  }

  if (r.ok && r.zips?.length) {
    await downloadAll(r.zips);
    if (s2.attempts) delete s2.attempts[slug];   // a win resets the count
    s2.done.push(slug);
    s2.results.push({ slug, expect: r.expect, sizes: r.zips.map((z) => z.size).join("+"), unlocked: r.unlocked, at: new Date().toISOString() });
    if (s2.results.length > 40) s2.results.shift();
    note(s2, `${slug}: requested ${r.zips.length} zip(s) · ${r.zips.map((z) => z.size).join("+")}${r.unlocked ? " (unlocked)" : ""}`);
  } else {
    /**
     * A failure leaves the collection QUEUED so a transient R2 or network error
     * gets retried rather than silently skipped — but "retry at the head of the
     * queue" livelocks on a PERMANENT failure. apannualconferenceblue answers
     * HTTP 404 (deleted on Pixieset since the 2026-08-14 inventory sweep) and
     * the first build retried it every 20 minutes forever, never reaching #3.
     *
     * So: 404/410 is gone, full stop — retiring it immediately. Anything else
     * gets three attempts, because that is enough for a blip and few enough to
     * keep the queue moving. Every giving-up path RECORDS why; a collection must
     * never leave the queue silently.
     */
    s2.attempts = s2.attempts || {};
    const n = (s2.attempts[slug] || 0) + 1;
    s2.attempts[slug] = n;

    const permanent = r.httpStatus === 404 || r.httpStatus === 410;
    if (permanent) {
      if (!s2.gone.includes(slug)) s2.gone.push(slug);
      s2.done.push(slug);
      note(s2, `${slug}: HTTP ${r.httpStatus} — gone from Pixieset, retired`);
    } else if (n >= 3) {
      s2.done.push(slug);
      note(s2, `${slug}: failed ${n}x (${r.error ?? "unknown"}) — giving up, moving on`);
    } else {
      note(s2, `${slug}: ${r.error ?? "failed"} (attempt ${n}/3, will retry)`);
    }
  }
  await save(s2);
}

chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) tick(); });

chrome.runtime.onMessage.addListener((msg, _s, respond) => {
  if (msg?.target !== "background") return;
  (async () => {
    const s = await load();
    switch (msg.type) {
      case "status": {
        respond({
          running: s.running, total: s.jobs.length, done: s.done.length,
          remaining: s.jobs.filter((j) => !s.done.includes(j)).length,
          gated: s.gated.length, noDownload: s.noDownload.length, gone: (s.gone || []).length,
          passwords: Object.keys(s.passwords).length,
          gapMinutes: s.gapMinutes, lastTickAt: s.lastTickAt,
          stoppedReason: s.stoppedReason, results: s.results.slice(-5), log: s.log.slice(-12),
        });
        break;
      }
      case "setJobs":
        s.jobs = msg.jobs; s.cursor = 0;
        note(s, `queue set: ${msg.jobs.length} collections`);
        await save(s); respond({ ok: true, total: s.jobs.length });
        break;
      case "start":
        s.running = true; s.stoppedReason = null; s.challenges = 0;
        if (msg.gapMinutes) s.gapMinutes = msg.gapMinutes;
        note(s, `started · one collection every ${s.gapMinutes} min`);
        await save(s);
        await chrome.alarms.clear(ALARM);
        // periodInMinutes keeps firing after Chrome restarts; delayInMinutes
        // makes the first one prompt rather than waiting a full period.
        chrome.alarms.create(ALARM, { delayInMinutes: 0.1, periodInMinutes: s.gapMinutes });
        respond({ ok: true });
        break;
      case "stop":
        s.running = false; s.stoppedReason = "stopped by hand";
        note(s, "stopped by hand");
        await save(s); await chrome.alarms.clear(ALARM);
        respond({ ok: true });
        break;
      case "arm": {
        const res = await ask({ type: "arm" });
        if (res?.ok) {
          s.passwords = res.map;
          note(s, `armed ${Object.keys(res.map).length} passwords from ${res.total} collections`);
          await save(s);
          respond({ ok: true, count: Object.keys(res.map).length });
        } else {
          note(s, `arm failed: ${res?.error ?? "unknown"}`);
          await save(s);
          respond({ ok: false, error: res?.error });
        }
        break;
      }
      default: respond({ ok: false, error: "unknown message" });
    }
  })();
  return true;
});

// Re-arm the alarm after a Chrome restart or an extension update. The alarm is
// the ONLY thing keeping this alive, and it does not survive on its own.
chrome.runtime.onStartup.addListener(async () => {
  const s = await load();
  if (s.running) chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: s.gapMinutes });
});
chrome.runtime.onInstalled.addListener(async () => {
  const s = await load();
  // Seed the queue from the bundled jobs.json the first time, so nobody has to
  // paste 1,269 slugs into a console. `done` is never touched — a reinstall must
  // resume, not restart.
  if (!s.jobs.length) {
    try {
      const res = await fetch(chrome.runtime.getURL("jobs.json"));
      const jobs = await res.json();
      if (Array.isArray(jobs) && jobs.length) {
        s.jobs = jobs;
        note(s, `queue seeded from jobs.json: ${jobs.length} collections`);
        await save(s);
      }
    } catch (e) {
      note(s, `could not seed queue: ${String(e?.message ?? e).slice(0, 80)}`);
      await save(s);
    }
  }
  if (s.running) chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: s.gapMinutes });
});
