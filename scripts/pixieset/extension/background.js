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

/**
 * One-shot repairs, applied on load and recorded by id so a reload cannot run
 * them twice. `done` is append-only by design — a restart must resume, not redo
 * — so the ONLY sanctioned way to put a collection back is a named repair that
 * says why, in code, where the next reader can see it.
 */
const REPAIRS = [
  {
    id: "2026-09-08-requeue-lost-downloads",
    // Retired on request, never on arrival: the mini filled up mid-run on
    // 2026-09-01/02 and Chrome interrupted the transfers. Three of these left no
    // file at all; atlassian-team26expo and partneraccelerateeventphotos left
    // half a part-set the watcher will wait on forever. 14,516 photos.
    requeue: [
      "atlassian-team26expo",
      "mcapsseattle2026",
      "inklingiicon2026",
      "partneraccelerateeventphotos",
      "applovinemployeeappreciationday",
    ],
  },
];

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
  inflight: null,      // { slug, ids, sizes, expect, at } — requested, bytes not yet proven
  driving: null,       // { slug, at } — an offscreen drive is running RIGHT NOW
  repairs: [],         // ids of one-shot repairs already applied to THIS profile
  challenges: 0,
  gapMinutes: 20,
  email: "mason72@gmail.com",
  lastTickAt: null,
  stoppedReason: null,
};

const load = async () => ({ ...DEFAULTS, ...((await chrome.storage.local.get(STATE))[STATE] ?? {}) });
const save = (s) => chrome.storage.local.set({ [STATE]: s });

/** Apply any repair this profile has not seen. Mutates; returns what it did. */
function applyRepairs(s) {
  s.repairs = s.repairs || [];
  const applied = [];
  for (const r of REPAIRS) {
    if (s.repairs.includes(r.id)) continue;
    const back = (r.requeue || []).filter((slug) => s.done.includes(slug));
    s.done = s.done.filter((slug) => !(r.requeue || []).includes(slug));
    for (const slug of back) if (s.attempts) delete s.attempts[slug];
    s.repairs.push(r.id);
    applied.push({ id: r.id, count: back.length });
  }
  return applied;
}

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
    reasons: ["DOM_PARSER", "BLOBS"],
    justification: "Parse Pixieset's download pages, which are HTML, and mint the blob URL for the retirement beacon a service worker cannot create.",
  });
}

async function ask(msg) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ target: "offscreen", ...msg });
}

/**
 * Tell the pipeline, in a file, that a collection was given up on.
 *
 * The extension is the only thing that knows a collection has been retired
 * without its bytes, and until now it recorded that in a 60-line in-memory log
 * that nothing reads unless a human opens the popup. So `queue.json` went on
 * saying `queued` for five collections that had already left the queue for
 * good — the ledger and the scheduler disagreeing with nobody to notice.
 *
 * A beacon is a small JSON file dropped in ~/Downloads, which `watch.mjs`
 * already sweeps every 20 seconds. It carries the slug in its BODY, never only
 * in its name, so Chrome's " (N)" dedupe cannot make it unreadable; the watcher
 * moves it to `pixieset-staging/retired/` after recording it, so the evidence
 * outlives the sweep.
 *
 * A filename IS supplied here, unlike the ZIPs — a blob has no
 * Content-Disposition to take one from. That exception is the whole reason the
 * ZIP rule exists in the first place: the name must be the one the watcher
 * expects, and here nothing else provides it.
 *
 * Failure to write one is reported LOUDLY rather than swallowed. A beacon that
 * silently does not arrive is the same fail-open shape it was built to fix.
 */
async function writeBeacon(s, slug, reason, detail) {
  const body = {
    kind: "px-retired",
    version: 1,
    slug,
    reason,                                    // gone | no-download | password-rejected | failed
    detail: String(detail ?? "").slice(0, 300),
    attempts: (s.attempts && s.attempts[slug]) || 0,
    at: new Date().toISOString(),
  };
  let url = null;
  try {
    const minted = await ask({ type: "blob", text: JSON.stringify(body, null, 2), mime: "application/json" });
    if (!minted?.ok) throw new Error(minted?.error ?? "offscreen refused");
    url = minted.url;
    const id = await chrome.downloads.download({
      url,
      filename: `px-retired-${slug}.json`,
      conflictAction: "uniquify",              // never clobber a beacon the watcher has not read yet
    });
    // Confirm it landed. This is ~300 bytes, so it is complete almost at once;
    // if it is not, that is worth a line in the log rather than a shrug.
    let state = null;
    for (let i = 0; i < 10 && state !== "complete"; i++) {
      await new Promise((r) => setTimeout(r, 200));
      state = (await chrome.downloads.search({ id }))[0]?.state ?? null;
      if (state === "interrupted") break;
    }
    if (state !== "complete") note(s, `BEACON NOT WRITTEN for ${slug} (${state ?? "no record"}) — the ledger will not learn this`);
  } catch (e) {
    note(s, `BEACON FAILED for ${slug} — ${String(e?.message ?? e).slice(0, 60)}`);
  } finally {
    if (url) { try { await ask({ type: "revoke", url }); } catch { /* the doc may have closed */ } }
  }
}

/**
 * Hand the zip URLs to Chrome's own downloader.
 *
 * No filename is supplied on purpose: Pixieset sets Content-Disposition, and the
 * watcher on disk matches the exact name it produces
 * (`{slug}-photo-download-NofM.zip`). Inventing a name here would break the
 * handoff to a pipeline that already works.
 */
/** Chrome's record of a completed download whose file is still on disk. */
async function alreadyHave(name) {
  if (!name) return null;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    const hits = await chrome.downloads.search({ filenameRegex: `${esc}$`, state: "complete", exists: true });
    return hits.length ? hits[0] : null;
  } catch { return null; }
}

async function downloadAll(zips) {
  const ids = [];
  let skipped = 0;
  for (const z of zips) {
    /**
     * A retry must not re-fetch the parts that already landed.
     *
     * Pixieset regenerates the whole archive per request, so a retry hands back
     * seventeen fresh links even when sixteen of those parts are sitting on
     * disk. Re-downloading them cost 46 GB to recover one 1.3 GB part, and on a
     * staging volume with 113 GB free that is how the disk fills — which is the
     * accident that started all of this.
     *
     * Mixing generations is safe HERE because it is checked downstream, not
     * assumed: Pixieset splits deterministically and the driver forces High
     * Resolution, and if the two halves disagree anyway then `verifyArchive`'s
     * file count and dimension sampling quarantine the set rather than staging
     * it. A wrong mix fails loudly; it does not pass silently.
     */
    const have = await alreadyHave(z.name);
    if (have) { ids.push(have.id); skipped++; continue; }
    const id = await chrome.downloads.download({ url: z.url, conflictAction: "uniquify" });
    ids.push(id);
    await new Promise((r) => setTimeout(r, 1500));   // stagger: simultaneous starts can drop one
  }
  return { ids, skipped };
}

/**
 * How long a set of ZIPs may stay in flight before we stop believing in it.
 * The largest queued collection is ~47 GB across 17 parts; six hours is far
 * more than that needs on this connection and short enough that a dead download
 * cannot hold the queue for a day.
 */
const INFLIGHT_TIMEOUT_MIN = 360;

/**
 * How long a single drive may hold the lock below.
 *
 * A drive is a conversation with Pixieset: request the archive, then poll while
 * it builds. Measured on atlassian-team26expo (8,518 photos, 46 GB) it took 19
 * MINUTES — against a 20-minute alarm. That is the margin this constant exists
 * to cover, and 45 gives a very large collection room without letting a dead
 * drive block the queue for an hour.
 */
const DRIVE_TIMEOUT_MIN = 45;

/**
 * Did the bytes actually land?
 *
 * `done` used to be written the moment `chrome.downloads.download()` accepted a
 * URL — success at the REQUEST, never at the ARRIVAL. On 2026-09-01/02 the mini
 * ran out of disk mid-run and Chrome interrupted the transfers; the extension
 * had already retired the collections, so five of them (14,516 photos, incl.
 * atlassian-team26expo at 8,518 and mcapsseattle2026 at 5,314) left the queue
 * without a single ZIP reaching the watcher. Three produced no file at all and
 * two left half a part-set that `watch.mjs` will wait on forever. Nothing
 * anywhere said so: the migration ledger still reads `queued`.
 *
 * So a collection is retired only when every one of its downloads reports
 * `complete`. Anything else — interrupted, timed out, or an id Chrome no longer
 * knows — is a FAILURE and leaves it in the queue, because "I cannot prove it
 * arrived" and "it arrived" must never collapse into the same answer.
 *
 * Returns true when the tick may start new work. A SUCCESSFUL settle returns
 * true so the next collection starts immediately; a FAILED one returns false, so
 * the retry waits a full gap. Retrying in the same tick would spend all three
 * attempts within seconds of each other, and the most likely cause of a failed
 * download here is a full disk — which needs the ingest to drain, i.e. time.
 */
async function settleInflight(s) {
  const f = s.inflight;
  if (!f) return true;

  let items = [];
  try {
    const found = await Promise.all(f.ids.map((id) => chrome.downloads.search({ id })));
    items = found.flat();
  } catch (e) {
    note(s, `${f.slug}: could not read download state — ${String(e?.message ?? e).slice(0, 60)}`);
    return false;                                  // unknown is not finished; look again next tick
  }

  const complete = items.filter((i) => i.state === "complete").length;
  const interrupted = items.filter((i) => i.state === "interrupted");
  const running = items.filter((i) => i.state === "in_progress").length;
  const forgotten = f.ids.length - items.length;   // Chrome no longer has the record
  const ageMin = (Date.now() - new Date(f.at).getTime()) / 60000;

  if (complete === f.ids.length) {
    s.inflight = null;
    if (s.attempts) delete s.attempts[f.slug];
    s.done.push(f.slug);
    s.results.push({ slug: f.slug, expect: f.expect, sizes: f.sizes, unlocked: f.unlocked, at: new Date().toISOString() });
    if (s.results.length > 40) s.results.shift();
    note(s, `${f.slug}: ${complete} zip(s) landed · ${f.sizes}`);
    return true;
  }

  /**
   * Anything still moving means WAIT — even alongside a part that has already
   * failed.
   *
   * The first version gave the whole set up the moment one download reported
   * interrupted. On atlassian-team26expo (17 parts, 46 GB) that discarded a
   * transfer where 16 parts had landed, because part 17 hit NETWORK_FAILED —
   * and then re-requested all 46 GB. A single flaky part out of seventeen is
   * ordinary; treating it as a dead set is not. The verdict is deferred until
   * nothing is in flight, and the retry below only fetches what is missing.
   */
  if (running && ageMin < INFLIGHT_TIMEOUT_MIN) {
    const hurt = interrupted.length ? `, ${interrupted.length} failed` : "";
    note(s, `${f.slug}: ${complete}/${f.ids.length} landed, ${running} still downloading${hurt} (${Math.round(ageMin)}m)`);
    return false;                                  // one collection at a time — do not stack another
  }

  // Only the TIMEOUT path can still have live transfers, and abandoning one
  // means cancelling it: left running, those parts land later under the same
  // names beside the re-request's — two racing sets and a " (N)" collision for
  // the watcher to arbitrate. When nothing is in progress this loop is a no-op,
  // which is the ordinary case now that a failure waits for the set to settle.
  for (const item of items) {
    if (item.state !== "in_progress") continue;
    try { await chrome.downloads.cancel(item.id); } catch { /* already finished or gone */ }
  }

  const why = interrupted.length
    ? `${interrupted.length} download(s) interrupted (${interrupted[0].error ?? "unknown"})`
    : forgotten
      ? `${forgotten} download(s) missing from Chrome's history`
      : `timed out after ${Math.round(ageMin)}m with ${complete}/${f.ids.length} landed`;
  s.inflight = null;
  failedAttempt(s, f.slug, why);
  return false;
}

/**
 * A failure leaves the collection QUEUED so a blip gets retried — but three
 * strikes and it is retired WITH A RECORDED REASON, because retrying at the
 * head of the queue forever is the livelock this file already paid for twice.
 */
/**
 * Beacons queued by the synchronous retirement paths.
 *
 * `failedAttempt` is called from two places that are mid-way through mutating
 * state, and writing a file is async; collecting them here and flushing once,
 * after the state is saved, keeps the retirement decision and the record of it
 * in one order — decide, persist, then announce.
 */
let beacons = [];

async function flushBeacons(s) {
  const pending = beacons;
  beacons = [];
  for (const b of pending) await writeBeacon(s, b.slug, b.reason, b.detail);
}

/**
 * Persist the decision, THEN announce it, then persist the announcement.
 *
 * The order matters: a beacon written before the state was saved could survive
 * a crash that lost the retirement, and the watcher would mark a collection
 * failed that this extension still intends to retry.
 */
async function saveAndAnnounce(s) {
  await save(s);
  if (!beacons.length) return;
  await flushBeacons(s);
  await save(s);
}

function failedAttempt(s, slug, why) {
  s.attempts = s.attempts || {};
  const n = (s.attempts[slug] || 0) + 1;
  s.attempts[slug] = n;
  if (n >= 3) {
    s.done.push(slug);
    note(s, `${slug}: failed ${n}x (${why}) — giving up, moving on`);
    beacons.push({ slug, reason: "failed", detail: `${n} attempts: ${why}` });
  } else {
    note(s, `${slug}: ${why} (attempt ${n}/3, will retry)`);
  }
}

async function tick() {
  const s = await load();
  s.lastTickAt = new Date().toISOString();

  for (const r of applyRepairs(s)) note(s, `repair ${r.id}: ${r.count} collection(s) back in the queue`);

  if (!s.running) { await save(s); return; }

  // Prove the last request's bytes landed before asking for more. This also
  // serialises the downloads, which is what keeps a 47 GB collection from
  // racing the ingest for the same free space.
  const clear = await settleInflight(s);
  await saveAndAnnounce(s);
  if (!clear) return;

  /**
   * A DEFERRED collection must leave the head of the queue.
   *
   * `gated` was excluded from `done` on purpose — marking it done would retire
   * all 282 password-gated collections in one unarmed run — but the head was
   * still chosen as "first job not done", so a deferral put the SAME slug back
   * at position 0 on the next wake-up. `sjcbubblebash-2026` was requested and
   * deferred 104 times over 32 hours (2026-09-07 → 09-08) and nothing behind it
   * was ever reached. That is the identical livelock this file already
   * documents for `apannualconferenceblue`, arriving through a second door:
   * fixing one instance of a failure mode does not retire the failure mode.
   *
   * Deferred is therefore SKIPPED, not retired — `arm` puts it straight back.
   */
  const inflightSlug = s.inflight?.slug ?? null;
  const remaining = s.jobs.filter(
    (j) => !s.done.includes(j) && !s.gated.includes(j) && j !== inflightSlug,
  );
  if (!remaining.length) {
    s.running = false;
    // "Drained" and "everything left needs a password" are different states and
    // need different reactions. Saying the wrong one reads as finished work.
    s.stoppedReason = s.gated.length
      ? `${s.gated.length} collection(s) deferred for passwords — sign in to galleries.pixieset.com, then Arm passwords`
      : "queue drained";
    note(s, s.gated.length
      ? `nothing left but ${s.gated.length} gated collection(s) — arm passwords to continue`
      : "queue drained — nothing left to request");
    await save(s);
    return;
  }

  /**
   * One drive at a time.
   *
   * `chrome.alarms` fires every 20 minutes whether or not the last tick has
   * finished, and a drive on a big collection takes about 19 — so on
   * atlassian-team26expo the ticks began overlapping and three drives ran at
   * once for the same collection, each of which would have requested its own
   * 17-part, 46 GB archive. Against 113 GB of free disk that is the 09-01
   * accident happening again, and it is also three times the traffic at a host
   * whose protection we are careful not to provoke.
   *
   * The lock is a timestamp in storage rather than a variable, because the
   * service worker is evicted between wake-ups and a variable would not
   * survive. A drive that dies with the worker leaves the lock behind, so it
   * expires — the queue stalls for at most DRIVE_TIMEOUT_MIN, never forever.
   */
  if (s.driving) {
    const drivingMin = (Date.now() - new Date(s.driving.at).getTime()) / 60000;
    if (drivingMin < DRIVE_TIMEOUT_MIN) {
      note(s, `${s.driving.slug}: still being requested (${Math.round(drivingMin)}m) — not starting another`);
      await save(s);
      return;
    }
    note(s, `${s.driving.slug}: request abandoned after ${Math.round(drivingMin)}m`);
    s.driving = null;
  }

  const slug = remaining[0];
  note(s, `→ ${slug}`);
  s.driving = { slug, at: new Date().toISOString() };
  await save(s);                                   // record intent BEFORE the work

  let r;
  try {
    r = await ask({ type: "drive", slug, password: s.passwords[slug], opts: { email: s.email, pollTries: 120 } });
  } catch (e) {
    note(s, `${slug}: offscreen failed — ${String(e?.message ?? e).slice(0, 80)}`);
    const sErr = await load();
    sErr.driving = null; sErr.log = s.log;
    await save(sErr);
    return;                                        // try again next tick
  }
  if (!r) {
    note(s, `${slug}: no result from offscreen`);
    const sNone = await load();
    sNone.driving = null; sNone.log = s.log;
    await save(sNone);
    return;
  }

  const s2 = await load();                          // re-read: a popup may have written
  s2.lastTickAt = s.lastTickAt;
  s2.log = s.log;
  s2.driving = null;                                // the conversation is over, whatever it said

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
    if (s2.passwords[slug]) {
      s2.done.push(slug);
      note(s2, `${slug}: password rejected`);
      beacons.push({ slug, reason: "password-rejected", detail: "the armed password was refused" });
    } else {
      if (!s2.gated.includes(slug)) s2.gated.push(slug);
      note(s2, `${slug}: gated, deferred`);
      // Deliberately NO beacon: deferred is not retired. Arming a password puts
      // it straight back, and a ledger row reading `failed` for work that is
      // merely waiting would be a lie with a long half-life.
    }
    await saveAndAnnounce(s2);
    return;
  }

  if (r.phase === "nodl") {
    if (!s2.noDownload.includes(slug)) s2.noDownload.push(slug);
    s2.done.push(slug);
    note(s2, `${slug}: downloads disabled`);
    beacons.push({ slug, reason: "no-download", detail: "bulk download is switched off on the collection" });
    await saveAndAnnounce(s2);
    return;
  }

  if (r.ok && r.zips?.length) {
    const { ids, skipped } = await downloadAll(r.zips);
    // NOT done yet — `settleInflight` retires it once every byte has landed.
    s2.inflight = {
      slug,
      ids,
      expect: r.expect,
      sizes: r.zips.map((z) => z.size).join("+"),
      unlocked: r.unlocked,
      at: new Date().toISOString(),
    };
    note(s2, `${slug}: requested ${r.zips.length - skipped} of ${r.zips.length} zip(s)${skipped ? `, ${skipped} already on disk` : ""} · ${r.zips.map((z) => z.size).join("+")}${r.unlocked ? " (unlocked)" : ""}`);
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
    const permanent = r.httpStatus === 404 || r.httpStatus === 410;
    if (permanent) {
      if (!s2.gone.includes(slug)) s2.gone.push(slug);
      s2.done.push(slug);
      note(s2, `${slug}: HTTP ${r.httpStatus} — gone from Pixieset, retired`);
      beacons.push({ slug, reason: "gone", detail: `HTTP ${r.httpStatus} — deleted on Pixieset since the inventory sweep` });
    } else {
      failedAttempt(s2, slug, r.error ?? "failed");
    }
  }
  await saveAndAnnounce(s2);
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
          // Counted exactly as tick() picks, or the popup reassures you about
          // work the scheduler will never reach.
          remaining: s.jobs.filter((j) => !s.done.includes(j) && !s.gated.includes(j)).length,
          inflight: s.inflight ? { slug: s.inflight.slug, parts: s.inflight.ids.length, at: s.inflight.at } : null,
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
          // Arming is the ONLY thing that can un-defer a gated collection, so it
          // must actually do it — otherwise the deferral is permanent and the
          // skip added above turns a livelock into a silent omission.
          const freed = s.gated.filter((slug) => s.passwords[slug]);
          s.gated = s.gated.filter((slug) => !s.passwords[slug]);
          note(s, `armed ${Object.keys(res.map).length} passwords from ${res.total} collections`);
          if (freed.length) note(s, `${freed.length} deferred collection(s) back in the queue`);
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
  const repaired = applyRepairs(s);
  if (repaired.length) {
    for (const r of repaired) note(s, `repair ${r.id}: ${r.count} collection(s) back in the queue`);
    await save(s);
  }
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
