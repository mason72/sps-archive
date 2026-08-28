#!/usr/bin/env node
/**
 * One bounded, unattended download pass. The missing half of the migration.
 *
 *   node scripts/pixieset/download-pass.mjs [--limit N] [--budget GB] [--at-risk]
 *   node scripts/pixieset/download-pass.mjs --collection 18964981     (one, for testing)
 *   node scripts/pixieset/download-pass.mjs --dry                     (plan only, no browser)
 *
 * WHY THIS EXISTS. Every other stage already runs itself: `watch.mjs` proves and
 * stages ZIPs, `ingest-loop.sh` drains them into Pixeltrunk, `stall-check.ts`
 * shouts when the pipeline goes quiet. Only the REQUEST half needed a human, so
 * the stall check's `STARVED` verdict was defined as "Mason — run the downloader"
 * and the migration stopped every time nobody did. This closes that gap.
 *
 * This is NOT a new pipeline. It is the conveyor between two existing ones: it
 * asks `store.mjs` for the next batch, runs the already-tested `driver.js` state machine
 * in a real browser, saves the ZIPs where `watch.mjs` already looks, and hands the
 * report to `apply.mjs`. Every rule about states, expiry and fidelity still lives
 * in those files. Nothing is re-implemented here.
 *
 * ── THE CONSTRAINT THAT SHAPES THE WHOLE THING ────────────────────────────────
 *
 * **Cloudflare challenges HEADLESS browsers, not Playwright.** Measured on
 * `twodudesphoto.pixieset.com/{slug}/` on 2026-08-28, fresh profile, same machine,
 * same Playwright, same real-Chrome binary — the ONLY difference is the flag:
 *
 *   headless: true   → HTTP 403, `cf-mitigated: challenge`, "Just a moment…"
 *   headless: false  → HTTP 200, no mitigation, download-auth link present
 *
 * `tasks/pixieset-migration.md` recorded this as "Playwright loops on Turnstile
 * forever … login.mjs/pilot.mjs kept for reference, currently unusable". That was
 * measured against the hardest surface (`accounts.pixieset.com` Turnstile login)
 * using the BUNDLED Chromium. The conclusion generalised one step too far: the
 * axis is headed-vs-headless and real-Chrome-vs-bundled-Chromium, not Playwright
 * vs a human. Driving the sanctioned flow with `channel: "chrome"` in a headed
 * window is the same surface a person uses, started by a timer instead of a hand.
 *
 * We are NOT defeating the protection, and must not start: no UA spoofing, no
 * stealth plugins, no TLS mimicry, no challenge solvers. If Cloudflare starts
 * challenging this path too, the answer is to stop and tell Mason — never to
 * escalate. `preflight()` below is what makes that failure loud.
 *
 * CONSEQUENCE: the agent needs a logged-in GUI session (Aqua). A launchd
 * *LaunchAgent* has one; a LaunchDaemon does not. If Mason logs out of the mini
 * the pass fails closed with a clear message rather than silently downloading
 * nothing.
 *
 * ── WHY IT IS BUDGETED IN BYTES, NOT COLLECTIONS ──────────────────────────────
 *
 * Staging is on the internal disk with a 60 GB floor (`PIXIESET_MIN_FREE_GB`) and
 * ~67 GB free, so the working headroom is single-digit GB. The queued median is
 * ~565 MB per collection but p90 is ~4.7 GB and the largest is ~47 GB, so "10
 * collections" can mean 3 GB or 60 GB. A count-only limit would breach the floor
 * on an unlucky draw — a count-based guard is not a capacity guard. So the batch
 * is filled against an estimated-bytes budget AND a count cap, whichever binds
 * first, and free space is re-checked between collections because the ingest is
 * draining concurrently.
 *
 * Anything skipped is LOGGED with its reason. A collection too large for the
 * current headroom stays queued and says so every night rather than silently
 * never happening — silent truncation reads as "covered everything" when it did
 * not.
 */
import { chromium } from "playwright";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { load, nextBatch, get } from "./lib/store.mjs";

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

/**
 * Read `.env.local` from the REPO ROOT, not the cwd.
 *
 * `watch.mjs` reads it relative to the working directory, which is fine when a
 * human runs it from the repo root and silently wrong under launchd. Both halves
 * must agree on `PIXIESET_STAGING` or this pass requests work the watcher stages
 * somewhere else entirely. Resolve from the script's own location so the answer
 * cannot depend on how the process was started.
 */
try {
  for (const line of readFileSync(join(REPO, ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^\s*(PIXIESET_[A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* absent — defaults below apply */ }

const HOST = process.env.PIXIESET_GALLERY_HOST || "https://twodudesphoto.pixieset.com";
const DOWNLOADS = join(homedir(), "Downloads");
const STAGING = process.env.PIXIESET_STAGING || join(homedir(), "pixieset-staging");
const MIN_FREE_GB = Number(process.env.PIXIESET_MIN_FREE_GB) || 25;
const NOTIFY_EMAIL = process.env.PIXIESET_NOTIFY_EMAIL || "mason72@gmail.com";

/**
 * A dedicated real-Chrome profile, separate from `profile/`.
 *
 * `profile/` was written by the BUNDLED Chromium and holds a dead session (401 as
 * of 2026-08-28). Pointing real Chrome at it risks an in-place profile upgrade
 * that would make the old one unopenable, and it buys nothing: the sanctioned
 * download flow is email-gated and PUBLIC — a brand-new profile reaches the set
 * picker perfectly well (verified). The owner session is only needed for
 * PIN/password-gated galleries, which the driver reports separately.
 */
const PROFILE = process.env.PIXIESET_CHROME_PROFILE || join(HERE, "profile-chrome");

/** Mean MB/photo measured across completed collections; only used to SIZE a batch. */
const MB_PER_PHOTO = Number(process.env.PIXIESET_MB_PER_PHOTO) || 1.42;

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const LIMIT = Number(flag("limit", 10));
const BUDGET_GB = Number(flag("budget", 6));
const AT_RISK_ONLY = has("at-risk");
const DRY = has("dry");
const ONE = flag("collection");
/** Wall-clock caps. A pass that cannot finish must end, not run into the morning. */
const PASS_MINUTES = Number(flag("max-minutes", 180));
const COLLECTION_MINUTES = Number(flag("collection-minutes", 25));
/** Politeness gap between collections. This runs for weeks; being blocked is the expensive failure. */
const GAP_MS = Number(flag("gap-seconds", 30)) * 1000;

const ts = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const log = (m) => console.log(`${ts()}  ${m}`);
const gb = (bytes) => bytes / 1073741824;
const mb = (bytes) => (bytes / 1048576).toFixed(0);

/** Estimated on-disk size of a collection, from its (double-counted, upper-bound) photo count. */
const estBytes = (c) => (c.photoCount || 0) * MB_PER_PHOTO * 1048576;

async function freeGB(dir = STAGING) {
  const { stdout } = await run("df", ["-k", dir]);
  const line = stdout.trim().split("\n").pop().split(/\s+/);
  return Math.round((Number(line[3]) * 1024) / 1073741824);
}

/**
 * Exit codes are the contract with launchd and with whoever reads the log.
 *   0  did work, or correctly did nothing
 *   3  blocked — Cloudflare challenged us, or no GUI session. NEEDS A HUMAN.
 *   4  disk floor reached. Not an error; the ingest has to drain first.
 */
const EXIT_BLOCKED = 3;
const EXIT_DISK = 4;

/**
 * Prove we can actually reach the gallery BEFORE requesting anything.
 *
 * This is the fail-closed gate. Three things it catches, all of which otherwise
 * look identical to "there was no work": a Cloudflare challenge, a missing GUI
 * session, and Pixieset changing the page out from under the driver. Each exits
 * loudly with a distinct message so `stall-check.ts` keeps reporting STARVED and
 * the reason is one `tail` away — never a silent retry loop.
 */
async function preflight(page) {
  const resp = await page.goto(`${HOST}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const status = resp ? resp.status() : 0;
  const mitigated = resp ? resp.headers()["cf-mitigated"] : null;
  const html = await page.content();
  if (status === 403 || mitigated || /just a moment/i.test(html)) {
    log(`✗ BLOCKED — Cloudflare challenged the gallery host (HTTP ${status}${mitigated ? `, cf-mitigated: ${mitigated}` : ""}).`);
    log("  Do NOT try to work around this. The pass stops here; stall-check will keep reporting STARVED.");
    log("  Most likely cause: the window opened headless, or the GUI session is gone (Mason logged out).");
    return false;
  }
  if (status !== 200) {
    log(`✗ BLOCKED — gallery host returned HTTP ${status}. Pixieset may be down or the host changed.`);
    return false;
  }
  log(`preflight ok — ${HOST} reachable (HTTP 200, no challenge)`);
  return true;
}

/**
 * Collections whose BULK DOWNLOAD is switched off — a third gate class, distinct
 * from the PIN gate and from fidelity.
 *
 * The gallery page loads normally, carries no password prompt, and simply has no
 * `/download/auth/` link, so the driver cannot begin. Verified live on
 * `accalia-huskyhybrid` and `shaughn` (2026-08-28): HTTP 200, correct title, no
 * auth link.
 *
 * These MUST be filtered before the batch is chosen, not discovered at runtime.
 * 21 queued collections are in this state and **20 of them are among the 40
 * oldest**, because they are a single two-day pet-portrait run from Jan 2015 that
 * sits at the very front of oldest-first ordering. Left in, the first two nights
 * of the autopilot would spend themselves marking failures and the migration
 * would look broken when it is merely gated.
 *
 * The answer was on disk the whole time: the inventory sweep already records
 * `collection_download` per row. Per the repo's own rule — before probing a live
 * system for why a request failed, grep the inventory already on disk.
 *
 * ⚠️ This file is a SNAPSHOT (see `sweptAt`), not the live setting. It is used
 * only to SKIP work, never to conclude a collection is fine, so a stale entry
 * costs a wasted attempt at worst. Flipping these back on is a separate,
 * owner-session job — see the report.
 */
function loadDisabledSet() {
  const path = join(STAGING, "pixieset-inventory.json");
  try {
    const inv = JSON.parse(readFileSync(path, "utf8"));
    const out = new Map();
    for (const r of inv.collections || []) {
      if (r.collection_download === false) out.set(String(r.id), r);
    }
    return { set: out, sweptAt: inv.sweptAt || "unknown" };
  } catch (e) {
    // Loud, not silent: without this the pass still works, just wastefully.
    log(`! could not read ${path} (${e.code || e.message}) — cannot pre-skip download-disabled collections.`);
    log("  The driver still fails closed per collection, but the batch may be wasted on gated galleries.");
    return { set: new Map(), sweptAt: null };
  }
}

/** Choose the batch: oldest-first, capped by count AND by estimated bytes. */
function planBatch(queue, headroomGB, disabled) {
  if (ONE) {
    const c = get(queue, ONE);
    return { batch: [c], skipped: [], budgetGB: gb(estBytes(c)) };
  }
  // Ask for more than we need, then fill against the byte budget.
  const candidates = nextBatch(queue, { limit: Math.max(LIMIT * 6, 60), atRiskOnly: AT_RISK_ONLY });

  /**
   * TWO limits, because one starves the big collections.
   *
   * `batchBytes` is how much to take in a NIGHT. `soloBytes` is how large a
   * SINGLE collection may be — bounded by real free space, not by the nightly
   * pace, with a margin so the ingest still has room to work.
   *
   * The first version of this had only the nightly budget and skipped past
   * anything that did not fit. Measured against the real queue that silently
   * stranded **83 collections / 819 GB — 38% of everything left** — because a
   * 9.8 GB gallery never fits a 6 GB night, on any night, forever. The loud
   * "will never be attempted" line fired every pass and fixed nothing.
   *
   * So: scan strictly oldest-first and NEVER skip past a collection that is
   * merely too big for tonight. If it is first and the batch is still empty, it
   * gets the whole night to itself. If the batch already has work, stop — it
   * goes to the front tomorrow. Stopping wastes a little budget; skipping loses
   * the collection permanently, and only one of those is recoverable.
   */
  const batchBytes = Math.min(BUDGET_GB, Math.max(headroomGB, 0)) * 1073741824;
  const soloBytes = Math.max(headroomGB * 0.75, 0) * 1073741824;
  const batch = [];
  const skipped = [];   // actionable: something a human may need to do
  let deferred = 0;     // ordinary: just did not fit tonight, will be picked up later
  let deferredBytes = 0;
  let used = 0;

  for (const c of candidates) {
    if (batch.length >= LIMIT) break;
    if (disabled.has(String(c.id))) {
      skipped.push({ slug: c.slug, id: c.id, reason: "bulk download switched off (collection_download=false) — needs an owner-session settings flip" });
      continue;
    }
    const size = estBytes(c);

    /**
     * Too big for the DISK, not merely for tonight. This is the only case that
     * genuinely cannot run, so it is the only one that gets skipped past — and
     * it gets a loud line every pass, because nothing else will ever surface it.
     */
    if (size > soloBytes) {
      skipped.push({
        slug: c.slug, id: c.id,
        reason: `est ${gb(size).toFixed(1)} GB exceeds the ${gb(soloBytes).toFixed(1)} GB a single collection may use (75% of ${headroomGB} GB headroom) — it will NEVER be attempted until staging has more room. Free disk, or pull this one by hand.`,
      });
      continue;
    }

    // Too big for tonight, but it fits the disk. Give it a night of its own if
    // it is first; otherwise stop and let it lead tomorrow. Never skip past it.
    if (size > batchBytes) {
      if (batch.length === 0) { batch.push(c); used += size; }
      else { deferred++; deferredBytes += size; }
      break;
    }

    if (used + size > batchBytes) { deferred++; deferredBytes += size; break; }
    batch.push(c);
    used += size;
  }

  return { batch, skipped, deferred, deferredBytes, budgetGB: gb(used) };
}

/** Hand one driver result to `apply.mjs` — the single owner of queue transitions. */
async function applyResult(result) {
  const payload = JSON.stringify({ state: "done", done: 1, results: [result], log: [] });
  const tmp = join(tmpdir(), `px-report-${process.pid}-${result.id}.json`);
  await writeFile(tmp, payload);
  try {
    const { stdout } = await run("node", [join(HERE, "apply.mjs"), tmp], { cwd: REPO });
    for (const line of stdout.trim().split("\n")) if (line.trim()) log(`  apply: ${line}`);
  } catch (e) {
    log(`  ! apply.mjs failed: ${String(e.stderr || e.message).slice(0, 300)}`);
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

const queue = await load();
if (!queue) {
  log("✗ no queue — run: node scripts/pixieset/queue.mjs build");
  process.exit(1);
}

const free = await freeGB();
const headroom = free - MIN_FREE_GB;
log(`start · free ${free} GB · floor ${MIN_FREE_GB} GB · headroom ${headroom} GB · staging ${STAGING}`);

if (headroom <= 0 && !ONE) {
  log(`✗ HOLD — ${free} GB free is at or below the ${MIN_FREE_GB} GB floor. Requesting nothing.`);
  log("  This is not a fault: the ingest has to drain staging before more can land.");
  process.exit(EXIT_DISK);
}

const { set: disabled, sweptAt } = loadDisabledSet();
if (disabled.size) log(`pre-skip list · ${disabled.size} collection(s) with bulk download off (inventory swept ${sweptAt})`);

const { batch, skipped, deferred, deferredBytes, budgetGB } = planBatch(queue, headroom, disabled);
for (const s of skipped) log(`~ skipped ${s.slug} — ${s.reason}`);
if (deferred) log(`~ ${deferred} more collection(s) (~${gb(deferredBytes).toFixed(1)} GB) did not fit tonight's budget — they stay queued for a later pass.`);
if (!batch.length) {
  log("nothing to request — queue is empty of eligible collections, or none fit tonight's budget.");
  process.exit(0);
}
log(`plan · ${batch.length} collection(s) · ~${budgetGB.toFixed(1)} GB estimated · ${batch.map((c) => c.slug).join(", ")}`);

if (DRY) {
  log("--dry: stopping before the browser. Nothing requested, queue untouched.");
  process.exit(0);
}

await mkdir(PROFILE, { recursive: true });
const driverSource = await readFile(join(HERE, "driver.js"), "utf8");

/**
 * Headed, real Chrome. Both are load-bearing — see the header. The window is
 * parked far offscreen so a 3am pass does not steal focus if Mason is at the
 * machine; it is still a real, composited window, which is what matters.
 */
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  channel: "chrome",
  acceptDownloads: true,
  viewport: { width: 1280, height: 900 },
  args: ["--window-position=-32000,-32000"],
});

/** Every download Chrome starts must be saved before we close, or we lose the ZIP. */
const pendingSaves = [];
const saved = [];
ctx.on("download", (download) => {
  const p = (async () => {
    const name = download.suggestedFilename();
    // Mirror Chrome's " (N)" dedupe rather than overwriting: watch.mjs strips the
    // suffix and takes the NEWEST file, so a collision must not clobber a part
    // that another collection is still waiting on.
    let target = join(DOWNLOADS, name);
    for (let n = 1; existsSync(target); n++) target = join(DOWNLOADS, name.replace(/\.zip$/i, ` (${n}).zip`));
    try {
      await download.saveAs(target);
      const st = await stat(target);
      saved.push({ name: target.split("/").pop(), bytes: st.size });
      log(`  ↓ saved ${target.split("/").pop()} (${mb(st.size)} MB)`);
    } catch (e) {
      log(`  ! download failed to save: ${String(e.message).slice(0, 200)}`);
    }
  })();
  pendingSaves.push(p);
});

let requested = 0, failed = 0, blocked = false;
const deadline = Date.now() + PASS_MINUTES * 60_000;

try {
  const page = ctx.pages()[0] || (await ctx.newPage());

  if (!(await preflight(page))) {
    blocked = true;
  } else {
    for (const [i, c] of batch.entries()) {
      if (Date.now() > deadline) {
        log(`~ pass deadline (${PASS_MINUTES} min) reached — stopping with ${batch.length - i} collection(s) unrequested.`);
        break;
      }
      const nowFree = await freeGB();
      if (nowFree <= MIN_FREE_GB) {
        log(`~ free space fell to ${nowFree} GB (floor ${MIN_FREE_GB}) — stopping this pass early.`);
        break;
      }

      log(`[${i + 1}/${batch.length}] ${c.slug} · ${c.photoCount} photos (upper bound) · ~${gb(estBytes(c)).toFixed(2)} GB`);

      // The driver reads `location.origin`, so be on the gallery host first.
      await page.goto(`${HOST}/${c.slug}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.evaluate(driverSource);

      // One job per run so THIS process controls pacing and can stop between
      // collections. The driver would happily take the whole batch, but then the
      // deadline and the disk re-check could not be honoured mid-flight.
      const job = { id: c.id, slug: c.slug, name: c.name };
      await page.evaluate(
        ([j, o]) => window.PX.run([j], o),
        [job, { email: NOTIFY_EMAIL, preferExisting: false, pollTries: 120, gapMs: 2000 }]
      );

      const until = Date.now() + COLLECTION_MINUTES * 60_000;
      let report = null;
      while (Date.now() < until) {
        await page.waitForTimeout(3000);
        const raw = await page.evaluate(() => window.PX.report());
        const parsed = JSON.parse(raw);
        if (parsed.state === "done" && parsed.results.length) { report = parsed; break; }
      }

      if (!report) {
        log(`  ✗ ${c.slug} — no result after ${COLLECTION_MINUTES} min. Left as-is for the next pass.`);
        failed++;
      } else {
        const r = report.results[0];
        if (r.ok) {
          log(`  ✓ ${c.slug} — ${r.zips.length} part(s), expect ${r.expectedFiles ?? "?"} files, fidelity ${r.fidelity}`);
          requested++;
        } else {
          log(`  ✗ ${c.slug} — ${r.error} (phase ${r.phase})`);
          failed++;
        }
        await applyResult(r);
      }

      if (i < batch.length - 1) await page.waitForTimeout(GAP_MS);
    }
  }
} finally {
  // Downloads can still be flushing when the loop ends. Wait for them, then close.
  await Promise.allSettled(pendingSaves);
  await ctx.close();
}

log(`done · ${requested} requested · ${failed} failed · ${saved.length} ZIP(s) saved to ~/Downloads`);
log("the watcher will prove and stage them; the ingest will drain them.");
process.exit(blocked ? EXIT_BLOCKED : 0);
