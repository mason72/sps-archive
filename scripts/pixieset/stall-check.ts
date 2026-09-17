/**
 * Does the Pixieset migration still have a pulse? Emails Mason when it doesn't.
 *
 *   npx tsx scripts/pixieset/stall-check.ts          # check, email only if wrong
 *   npx tsx scripts/pixieset/stall-check.ts --dry    # print the verdict, send nothing
 *   npx tsx scripts/pixieset/stall-check.ts --force  # send whatever the verdict is
 *
 * Written 2026-08-21, because on 2026-08-17 the pipeline quietly ran dry and
 * nobody noticed for FOUR DAYS. Nothing was broken — the ingest idled correctly,
 * the agents were up, the archive was healthy. It simply had no work, and no
 * surface anywhere said so. Mason found out by asking me.
 *
 * That is the failure this closes: not a crash, which is loud, but a SILENCE
 * that looks exactly like everything being fine.
 *
 * Four verdicts, because they need different reactions:
 *
 *   BROKEN  — a launchd agent is not running. Nothing will happen until it is.
 *   SPINNING— the loop is passing far more often than it should be. This is the
 *             2026-08-18 signature: a wording guard failed open and respawned
 *             `npx tsx` every ~4s for 34 hours. `idles` is the cheapest probe
 *             there is, so it is checked explicitly rather than inferred.
 *   STUCK   — collections ARE staged and waiting, and the ingest has shown no
 *             sign of life in STUCK_HOURS: no collection completed AND no image
 *             row landed. Something is wrong with the ingest.
 *             Until 2026-09-15 this fired on the staged clock alone, and the
 *             headline claimed "nothing completing" without checking. Once the
 *             downloader outran the ingest (four 15–20 GB collections staged,
 *             ~90 minutes each to push to R2), a healthy backlog read as STUCK
 *             eight minutes after a collection had finished. The images table
 *             is the durable record here (lesson 131: the log is silent by
 *             design during a run), so the check now reads it.
 *   STARVED — nothing staged, work still queued, and nothing has completed in
 *             STARVED_HOURS. This is not a bug: it means the DOWNLOAD half has
 *             not been run, and that needs Mason's Chrome. It is the exact state
 *             that went unnoticed for four days.
 *   FAILING — nothing staged, nothing downloading, and the last two or more
 *             outcomes since the last successful ingest were retirements. The
 *             downloader is giving collections up one after another (added
 *             2026-09-15: `failed` rows sat outside every verdict, so a day of
 *             every download failing verification would have read as quiet).
 *
 * REMEDIES (added 2026-09-15, Mason: "is there anything we can do to make
 * things get unstuck without me needing to fire off a session?"). Each bad
 * verdict has at most ONE automatic remedy, tried ONCE per episode, and every
 * one of them is something the pipeline is already designed to survive:
 *
 *   STUCK    → SIGTERM the ingest child. The loop's own header says "safe to
 *              kill and restart at any moment": bytes land before the row, and
 *              a resume is idempotent by (event, original_filename). The loop
 *              idles 5 min and retries the same collection. No child running →
 *              restart the ingest agent instead.
 *   BROKEN   → `launchctl kickstart -k` the agent that is down (or the watcher,
 *              when its brake is not answering).
 *   STARVED  → if Chrome is not running, open it; the extension's alarm
 *              re-arms on startup. Anything else needs a human: the email now
 *              carries the extension's own last word (see `extensionStatus`).
 *   UNBACKED → kickstart machine-state's sync now instead of waiting a night.
 *   SPINNING, FAILING → none; both are code or data problems.
 *
 * If the same verdict persists on the check after a remedy, ONE escalation
 * email says what was tried and that it did not help. The remedy is recorded
 * in the state file, so an episode never retries its remedy hourly — a restart
 * that fixes nothing is not improved by repetition. `--heal <VERDICT>` runs a
 * remedy by hand regardless of the live verdict, which is how each was tested.
 *
 * The check must never fail QUIETLY — a health check that dies in silence is
 * worse than none, because it converts "broken" into "reassuring". Any throw is
 * caught, emailed, and exits non-zero.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { ledgerBackupState } from "./ledger-backup";

for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const HOME = process.env.HOME!;
// PIXIESET_QUEUE exists for negative tests: a temp copy with rows edited into
// the shape under test, so FAILING can be made to fire without touching the ledger.
const QUEUE = process.env.PIXIESET_QUEUE || path.join("scripts", "pixieset", "data", "queue.json");
const LOG = path.join(HOME, "pixieset-staging", "logs", "ingest.log");
const STATE = path.join(HOME, "pixieset-staging", "logs", "stall-state.json");
/** Written by the watcher from the extension's POSTs — see EXTENSION_STATUS in watch.mjs. */
const EXT_STATUS = path.join(HOME, "pixieset-staging", "logs", "extension-status.json");
const AGENT = {
  watch: "com.twodudes.pixieset.watch",
  ingest: "com.twodudes.pixieset.ingest",
  backup: "com.mason.machine-state",
};
const EXT_SILENT_HOURS = 2;   // an extension that is `running` reports every tick (20 min); 2h of silence is a dead worker or a dead Chrome

/**
 * `Number(x) || default` silently ignores a deliberate 0, because 0 is falsy —
 * which made the first attempt at negative-testing STUCK impossible to fail.
 * A threshold you cannot set to zero is a threshold you cannot test.
 */
const num = (v: string | undefined, fallback: number) =>
  v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : fallback;
/**
 * 4h while the only signal was the staged clock. Now that "no sign of life"
 * means no image row in the window, 2h is unambiguous: a healthy run lands a
 * row every few seconds, and the largest gap in normal operation (housekeeping
 * between passes) is a couple of minutes. The R2 hang of lesson 131 would have
 * been named at ~2h instead of riding the staged clock to 4.2h.
 */
const STUCK_HOURS = num(process.env.PIXIESET_STUCK_HOURS, 2);
const STARVED_HOURS = num(process.env.PIXIESET_STARVED_HOURS, 36);
const RENOTIFY_HOURS = 24;
const MAX_PASSES_PER_HOUR = num(process.env.PIXIESET_MAX_PASSES, 40);   // ~12 expected at a 5-minute idle; 40 is generous
const BACKUP_STALE_HOURS = num(process.env.PIXIESET_BACKUP_STALE_HOURS, 48);   // nightly, so 48h is two missed runs

type Verdict = "OK" | "BROKEN" | "SPINNING" | "STUCK" | "FAILING" | "STARVED" | "UNBACKED";
type Remedy = { name: string; run: () => string } | null;
type StallState = {
  verdict: string;
  at: number;
  remedy?: { name: string; at: number; note: string; escalated?: boolean };
};

/**
 * Is the migration ledger's off-machine copy current?
 *
 * `scripts/pixieset/data/` is gitignored, so `queue.json` — the only record of
 * which of 1,371 collections are already safe — has no off-machine copy of its
 * own. `machine-state`'s nightly sync backs it up encrypted; this is the
 * independent check that the backup HAPPENED, because a backup nobody verifies
 * is a belief. It was worth building on the day it was written: that sync had
 * been silently refusing to push for 26 consecutive nights.
 *
 * It asks about CONTENT first (does the live ledger equal what is on origin?)
 * and only then time. Asking "when did the file last change on origin" fired
 * UNBACKED after every quiet stretch, on a backup that was complete — see
 * ledger-backup.ts for the rules and the 2026-09-14 false alarm.
 */
function ledgerBackup() {
  return ledgerBackupState({
    repo: process.env.PIXIESET_BACKUP_REPO || path.join(HOME, "machine-state"),
    file: process.env.PIXIESET_BACKUP_PATH || "ledgers/pixieset-queue.json.gz",
    queue: QUEUE,
    syncLog: process.env.PIXIESET_BACKUP_LOG || path.join(HOME, "machine-state", ".sync.log"),
    staleHours: BACKUP_STALE_HOURS,
  });
}

/**
 * Is the watcher's disk brake answering?
 *
 * The downloader fails CLOSED on this endpoint: no answer means no downloads.
 * That is the safe direction for a guard protecting a disk, but it hands the
 * migration a way to stop silently — so the stall check probes it too, and a
 * brake that is down while its agent is up is BROKEN, reported within the hour.
 * Without this the failure would surface as STARVED, 36 hours later.
 */
async function diskBrake(): Promise<{ ok: boolean; freeGB: number | null; note: string }> {
  const url = process.env.PIXIESET_DISK_URL || "http://127.0.0.1:8788/disk";
  // Two tries, the second patient. On 2026-09-17 the mini was at load 30 after a
  // macOS upgrade (Spotlight reindex + Time Machine) and ONE 4s timeout on a
  // healthy brake became a BROKEN email, a watcher restart and an escalation.
  // A brake that is really down fails both; a starved box passes the second.
  let last = { ok: false, freeGB: null as number | null, note: "not tried" };
  for (const ms of [4000, 15000]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
      if (!res.ok) { last = { ok: false, freeGB: null, note: `HTTP ${res.status}` }; continue; }
      const body = (await res.json()) as { freeGB?: number };
      if (!Number.isFinite(body?.freeGB)) { last = { ok: false, freeGB: null, note: "no freeGB in the response" }; continue; }
      return { ok: true, freeGB: body.freeGB!, note: ms > 4000 ? "slow: answered only on the patient retry" : "" };
    } catch (e) {
      last = { ok: false, freeGB: null, note: String((e as Error).message).slice(0, 80) };
    }
  }
  return last;
}

/**
 * Bytes the ingest PARKED in `ingested/` (its end-of-run landing check said "not
 * yet"). The release sweep covers this folder since 2026-09-17, so it should sit
 * near zero; a number that grows here is the 73 GB leak of that day returning.
 */
function parkedGB(): number {
  const dir = path.join(HOME, "pixieset-staging", "ingested");
  try {
    return fs.readdirSync(dir).reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0) / 1073741824;
  } catch { return 0; }
}

/**
 * When did the ingest last land a row?
 *
 * The images table is the one record that moves DURING a run: `ingest-loop.sh`
 * captures a run's output and prints it only on exit, so the log says nothing
 * for the whole of a two-hour collection, and the queue only changes at the
 * end. Newest `created_at` across the archive, measured at 125–564 ms.
 *
 * It is archive-wide, not scoped to the collection in flight, because the
 * queue does not know the event id until the run finishes. An upload through
 * the app during a hang would mask it for one check; that is a one-hour delay
 * on a rare coincidence, accepted.
 *
 * Failure is reported, not hidden: a probe that cannot answer returns null and
 * the verdict falls back to the coarse clock (last completed collection), with
 * the body saying so. It must not turn a DB blip into a STUCK email, and it
 * must not turn a real hang into OK.
 */
async function newestRow(): Promise<{ ageHours: number | null; note: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ageHours: null, note: "no Supabase credentials in .env.local" };
  try {
    const sb = createClient(url, key, {
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) },
    });
    const { data, error } = await sb
      .from("images")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) return { ageHours: null, note: error.message.slice(0, 80) };
    const at = data?.[0]?.created_at;
    if (!at) return { ageHours: null, note: "images table is empty" };
    return { ageHours: (Date.now() - new Date(at).getTime()) / 3600_000, note: "" };
  } catch (e) {
    return { ageHours: null, note: String((e as Error).message).slice(0, 80) };
  }
}

/**
 * The extension's own last word, as relayed by the watcher.
 *
 * `receivedAt` is the watcher's clock, so `ageHours` answers "when did the
 * extension last say anything", independent of what it claimed. A `running`
 * extension reports at least every tick (20 min); one that has been silent
 * for EXT_SILENT_HOURS while claiming to run has lost its worker or its Chrome.
 * A stopped one reports nothing further — its `stoppedReason` is the answer.
 */
function extensionStatus(): {
  ageHours: number; running: boolean | null; stoppedReason: string | null;
  inflight: { slug: string; at: string } | null; version: string | null; lastLog: string;
} | null {
  try {
    const s = JSON.parse(fs.readFileSync(EXT_STATUS, "utf8")) as Record<string, unknown>;
    const at = new Date(String(s.receivedAt)).getTime();
    if (!Number.isFinite(at)) return null;
    const log = Array.isArray(s.log) ? (s.log as string[]) : [];
    return {
      ageHours: (Date.now() - at) / 3600_000,
      running: typeof s.running === "boolean" ? s.running : null,
      stoppedReason: typeof s.stoppedReason === "string" ? s.stoppedReason : null,
      inflight: s.inflight && typeof s.inflight === "object" ? (s.inflight as { slug: string; at: string }) : null,
      version: typeof s.version === "string" ? s.version : null,
      lastLog: log.at(-1) ?? "",
    };
  } catch { return null; }
}

function chromeRunning(): boolean {
  try { return execFileSync("/usr/bin/pgrep", ["-x", "Google Chrome"], { encoding: "utf8" }).trim().length > 0; }
  catch { return false; }
}

/** PIDs of the ingest CHILD (never the loop, never this check). */
function ingestPids(): number[] {
  try {
    return execFileSync("/usr/bin/pgrep", ["-f", "scripts/pixieset-ingest.ts"], { encoding: "utf8" })
      .split("\n").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0 && n !== process.pid);
  } catch { return []; }
}

function kickstart(label: string, kill: boolean): string {
  const target = `gui/${process.getuid?.() ?? 501}/${label}`;
  execFileSync("/bin/launchctl", kill ? ["kickstart", "-k", target] : ["kickstart", target], { encoding: "utf8" });
  return `launchctl kickstart${kill ? " -k" : ""} ${target}`;
}

/**
 * What to try for a verdict, given what was seen. Returns null when nothing
 * automatic is safe. Each `run` returns a one-line note for the email.
 */
function remedyFor(verdict: Verdict, seen: { down: string[]; brakeOk: boolean; chrome: boolean; pids: number[] }): Remedy {
  switch (verdict) {
    case "BROKEN":
      if (seen.down.length) return { name: `restart ${seen.down.map((l) => l.split(".").pop()).join(", ")}`, run: () => seen.down.map((l) => kickstart(l, true)).join("; ") };
      if (!seen.brakeOk) return { name: "restart the watcher (its brake was not answering)", run: () => kickstart(AGENT.watch, true) };
      return null;
    case "STUCK":
      if (seen.pids.length) {
        return {
          name: `SIGTERM the ingest child (pid ${seen.pids.join(", ")})`,
          run: () => {
            for (const pid of seen.pids) { try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ } }
            return `sent SIGTERM to ${seen.pids.length} process(es); the loop idles 5 min, then resumes the same collection (idempotent per file)`;
          },
        };
      }
      return { name: "restart the ingest agent (no ingest child was running)", run: () => kickstart(AGENT.ingest, true) };
    case "STARVED":
      if (!seen.chrome) {
        return {
          name: "open Google Chrome (it was not running)",
          run: () => { execFileSync("/usr/bin/open", ["-g", "-a", "Google Chrome"]); return "opened Chrome in the background; the extension's alarm re-arms on startup, first tick in ~1 min"; },
        };
      }
      return null;
    case "UNBACKED":
      return { name: "run machine-state's sync now", run: () => kickstart(AGENT.backup, false) };
    default:
      return null;
  }
}

function agentsRunning(): { label: string; up: boolean }[] {
  const out: { label: string; up: boolean }[] = [];
  for (const label of ["com.twodudes.pixieset.watch", "com.twodudes.pixieset.ingest"]) {
    let up = false;
    try {
      const list = execFileSync("/bin/launchctl", ["list"], { encoding: "utf8" });
      const row = list.split("\n").find((l) => l.trim().endsWith(label));
      // A PID in column 1 means running; "-" means it exited and is throttled.
      up = !!row && /^\d+/.test(row.trim());
    } catch { up = false; }
    out.push({ label, up });
  }
  return out;
}

/**
 * Passes and idles inside the last hour.
 *
 * Both must use the SAME window or the comparison is meaningless. Idle lines
 * carry only HH:MM:SS, no date, so they are counted POSITIONALLY: once a pass
 * line inside the window is seen, every idle after it is in the window too.
 * The first draft filtered passes by time and idles across the whole file, so
 * `idles === 0` was never true and the spin detector could not fire — the same
 * fail-open shape as the wording guard it exists to catch.
 */
function logRate(): { passes: number; idles: number } {
  if (!fs.existsSync(LOG)) return { passes: 0, idles: 0 };
  const size = fs.statSync(LOG).size;
  const start = Math.max(0, size - 2_000_000);
  const fd = fs.openSync(LOG, "r");
  const buf = Buffer.alloc(size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  const lines = buf.toString("utf8").split("\n");
  const cutoff = Date.now() - 3600_000;
  let passes = 0;
  let idles = 0;
  let inWindow = false;
  for (const l of lines) {
    const m = l.match(/^=== pass \d+ · (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
    if (m) {
      inWindow = new Date(m[1].replace(" ", "T")).getTime() >= cutoff;
      if (inWindow) passes++;
      continue;
    }
    if (inWindow && /idling|UNRECOGNIZED/.test(l)) idles++;
  }
  return { passes, idles };
}

/**
 * What the ingest's housekeeping is refusing to release, from its most recent pass.
 *
 * Added 2026-09-11 after a 37-hour STARVED that this check reported but could not
 * EXPLAIN. The downloader will not start below 80 GB free and waits "for the
 * ingest to drain"; the ingest had nothing to drain, because its release sweep
 * was KEEPING 45 GB it could not prove safe. Two guards, both failing closed,
 * each waiting on the other. The KEPT line was in ingest.log every five minutes;
 * putting it in the email turns that deadlock from a hunt into one sentence.
 */
function housekeepingKept(): { collections: number; gb: number } | null {
  if (!fs.existsSync(LOG)) return null;
  const size = fs.statSync(LOG).size;
  const start = Math.max(0, size - 200_000);
  const fd = fs.openSync(LOG, "r");
  const buf = Buffer.alloc(size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  const hits = [...buf.toString("utf8").matchAll(/kept for review: (\d+) collection\(s\), ([\d.]+) GB/g)];
  const last = hits.at(-1);
  return last ? { collections: Number(last[1]), gb: Number(last[2]) } : null;
}

async function main() {
  const q = JSON.parse(fs.readFileSync(QUEUE, "utf8")) as {
    collections: Record<string, { state: string; history?: { state: string; at: string }[] }>;
  };
  const rows = Object.values(q.collections);
  const by: Record<string, number> = {};
  for (const r of rows) by[r.state] = (by[r.state] || 0) + 1;

  let lastIngest = 0;
  for (const r of rows) {
    if (r.state !== "ingested") continue;
    for (const h of r.history ?? []) {
      if (h.state === "ingested") lastIngest = Math.max(lastIngest, new Date(h.at).getTime());
    }
  }

  /**
   * How long has the OLDEST staged collection been waiting?
   *
   * "Hours since the last completed ingest" is the wrong question: a collection
   * staged thirty seconds ago is not stuck, but if nothing has completed since
   * Tuesday that clock reads days. Measure the wait of the work that is actually
   * sitting there. Caught on the first dry run, which fired STUCK on a
   * collection that had just landed.
   */
  let oldestStagedAt = Infinity;
  for (const r of rows) {
    if (r.state !== "verified") continue;
    for (const h of r.history ?? []) {
      if (h.state === "verified") oldestStagedAt = Math.min(oldestStagedAt, new Date(h.at).getTime());
    }
  }
  const stagedHours = oldestStagedAt === Infinity ? 0 : (Date.now() - oldestStagedAt) / 3600_000;
  const hoursSince = lastIngest ? (Date.now() - lastIngest) / 3600_000 : Infinity;

  /** Collections retired AFTER the last successful ingest: the run of failures the pipeline is currently on. */
  const failedSince = rows
    .filter((r) => r.state === "failed")
    .map((r) => {
      const h = [...(r.history ?? [])].reverse().find((x) => x.state === "failed") as { at: string; error?: string } | undefined;
      return { slug: (r as { slug?: string }).slug ?? "?", at: h ? new Date(h.at).getTime() : 0, error: h?.error ?? (r as { error?: string }).error ?? "no reason recorded" };
    })
    .filter((f) => f.at > lastIngest)
    .sort((a, b) => b.at - a.at);

  const agents = agentsRunning();
  const down = agents.filter((a) => !a.up).map((a) => a.label);
  const { passes, idles } = logRate();
  const backup = ledgerBackup();
  const brake = await diskBrake();
  const kept = housekeepingKept();
  const row = await newestRow();
  const ext = extensionStatus();
  const chrome = chromeRunning();
  const pids = ingestPids();

  // The extension's own word, in one line. Used by the STARVED headline and the body.
  const extLine = !ext
    ? `never reported (needs extension v1.1.0+ loaded and the watcher restarted)`
    : ext.running === false
      ? `STOPPED itself ${ext.ageHours.toFixed(1)}h ago: ${ext.stoppedReason ?? "no reason recorded"}`
      : ext.ageHours > EXT_SILENT_HOURS
        ? `SILENT for ${ext.ageHours.toFixed(1)}h while believing it was running — Chrome is ${chrome ? "running, so the extension's worker is dead: Reload it on chrome://extensions" : "NOT running"}`
        : `running, last heard ${(ext.ageHours * 60).toFixed(0)} min ago${ext.inflight ? `, downloading ${ext.inflight.slug}` : ""}${ext.lastLog ? ` — "${ext.lastLog.slice(0, 120)}"` : ""}`;

  /**
   * Hours since the ingest last showed a sign of life: a completed collection
   * OR a landed row, whichever is more recent. When the row probe cannot
   * answer, the completion clock stands alone — coarser, but it still fires.
   */
  const quietHours = row.ageHours === null ? hoursSince : Math.min(hoursSince, row.ageHours);

  const verified = by.verified || 0;
  const queued = by.queued || 0;
  const ingested = by.ingested || 0;

  let verdict: Verdict = "OK";
  let headline = "";
  if (down.length) {
    verdict = "BROKEN";
    headline = `launchd agent not running: ${down.join(", ")}`;
  } else if (!brake.ok) {
    // The watch agent is up but its disk brake is not answering. The downloader
    // fails closed on it, so nothing will be requested until this is fixed.
    verdict = "BROKEN";
    headline = `the disk brake is not answering (${brake.note}) — the downloader fails closed, so no collection will be requested`;
  } else if (passes > MAX_PASSES_PER_HOUR) {
    // Deliberately NOT `&& idles === 0`. That is the signature of the total
    // 34-hour spin, but requiring it means a PARTIAL spin — one that still idles
    // occasionally — sails through. A collection takes minutes, so more than
    // MAX_PASSES_PER_HOUR passes in an hour is abnormal however many idles
    // accompany it.
    verdict = "SPINNING";
    headline = `${passes} ingest passes in the last hour (${idles} idles) — the loop is respawning faster than it can work`;
  } else if (verified > 0 && stagedHours > STUCK_HOURS && quietHours > STUCK_HOURS) {
    // Both clocks: work has been available for the whole window (staged), and
    // the ingest produced nothing in it (quiet). Either alone is a backlog or an
    // idle, not a stall.
    verdict = "STUCK";
    headline = `${verified} collection(s) staged, the oldest waiting ${stagedHours.toFixed(1)}h, and the ingest has shown no sign of life for ${quietHours.toFixed(1)}h (no collection completed, no image row landed${row.ageHours === null ? " — row probe failed: " + row.note : ""})`;
  } else if (verified === 0 && !ext?.inflight && failedSince.length >= 2) {
    // Checked before STARVED: two retirements in a row with nothing staged and
    // nothing downloading is a specific, earlier signal than 36h of quiet.
    verdict = "FAILING";
    headline = `${failedSince.length} collection(s) retired since the last successful ingest (${hoursSince === Infinity ? "never" : hoursSince.toFixed(1) + "h ago"}), nothing staged, nothing downloading:\n` +
      failedSince.slice(0, 6).map((f) => `  · ${f.slug} — ${String(f.error).slice(0, 140)}`).join("\n") +
      (failedSince.length > 6 ? `\n  · … and ${failedSince.length - 6} more` : "");
  } else if (verified === 0 && queued > 0 && hoursSince > STARVED_HOURS) {
    verdict = "STARVED";
    headline = `nothing staged and nothing completed in ${hoursSince.toFixed(0)}h — the extension ${extLine}` +
      (kept && kept.collections > 0
        ? `\n\nAnd the ingest is KEEPING ${kept.gb} GB across ${kept.collections} collection(s) it cannot prove safe to release. If the disk is under the downloader's 80 GB start floor, that is a deadlock: each half is waiting on the other. Run release-sweep.ts and read why each is kept.`
        : "");
  } else if (backup.stale) {
    // Checked LAST on purpose: a pipeline that has stopped matters more than one
    // whose ledger is a day stale, and this must never mask a STARVED or STUCK.
    verdict = "UNBACKED";
    headline = backup.headline;
  }

  const body = [
    `Verdict: ${verdict}`,
    headline ? `\n${headline}\n` : "",
    `ingested   ${ingested} of ${rows.length}`,
    `queued     ${queued}`,
    `staged     ${verified} waiting to ingest`,
    `last done  ${lastIngest ? new Date(lastIngest).toISOString() : "never"} (${hoursSince === Infinity ? "n/a" : hoursSince.toFixed(1) + "h ago"})`,
    `agents     ${agents.map((a) => `${a.label.split(".").pop()}=${a.up ? "up" : "DOWN"}`).join("  ")}`,
    `staged for ${verified ? stagedHours.toFixed(1) + "h (oldest)" : "n/a"}`,
    `newest row ${row.ageHours === null ? `PROBE FAILED — ${row.note} (falling back to the completion clock)` : `${(row.ageHours * 60).toFixed(0)} min ago`}`,
    `last hour  ${passes} passes, ${idles} idles`,
    `ledger     ${backup.line}`,
    `disk       ${brake.ok ? `${brake.freeGB} GB free, brake answering${brake.note ? ` (${brake.note})` : ""}` : `BRAKE DOWN — ${brake.note}`}`,
    `kept       ${kept ? `${kept.gb} GB across ${kept.collections} collection(s) housekeeping will not release` : "n/a (no housekeeping line in the log)"}`,
    `parked     ${parkedGB().toFixed(1)} GB in ingested/ (archives whose landing check said "not yet"; the release sweep frees them once every file is proven)`,
    `extension  ${extLine}`,
    `failed     ${failedSince.length} since the last ingest (${by.failed || 0} total)`,
    verdict === "UNBACKED"
      ? `\nqueue.json is the only record of which of the 1,371 collections are\nalready safe. Losing it does not lose photos — it loses the knowledge of\nwhich ones are done, which is the difference between finishing this\nmigration and re-running a month of it blind.\n\nIt is backed up by machine-state's nightly sync (20:00). Read\n~/machine-state/.sync.log: that job refuses to push when anything tracked\nis unencrypted, and it stayed silently blocked for 26 nights once before.`
      : "",
    verdict === "STARVED"
      ? `\nNothing has been requested from Pixieset. Since 2026-08-31 that is the\nChrome extension's job. Its own last word is on the "extension" line above\n(since 2026-09-15 it reports to the watcher, so you no longer need the popup).\nKnown causes, in order of how often they have happened:\n\n  · the head of the queue is stuck  — fixed 2026-09-08; a gated collection\n    was re-requested every 20 min forever. If a single slug repeats down\n    the whole log, that is this shape returning.\n  · one slug "request abandoned after 60m" every hour — its drive never\n    answers (servicenowsko26, 128 GB, 2026-09-11 → 13). Fixed 2026-09-13:\n    it now counts as an attempt and retires after three. If it returns,\n    the extension is running old code — Reload it on chrome://extensions.\n  · everything left is password-gated — sign in to galleries.pixieset.com\n    and press Arm passwords.\n  · Cloudflare challenged it three times — it stops deliberately. Do not\n    work around it; tell Mason.\n  · Chrome is not running, or the extension was unloaded.`
      : "",
  ].filter(Boolean).join("\n");

  const seen = { down, brakeOk: brake.ok, chrome, pids };
  return { verdict, headline, body, remedy: remedyFor(verdict, seen), remedyFor: (v: Verdict) => remedyFor(v, seen) };
}

async function send(subject: string, body: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const to = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!key || !from || !to.length) {
    // A missing credential is an outage of the alerting, not a reason to be quiet.
    console.error(`CANNOT SEND: key=${!!key} from=${!!from} recipients=${to.length}`);
    process.exitCode = 1;
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `Pixeltrunk Migration <${from}>`, to, subject, text: body }),
  });
  if (!res.ok) {
    console.error(`resend failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    process.exitCode = 1;
    return;
  }
  console.log(`emailed: ${subject}`);
}

(async () => {
  const dry = process.argv.includes("--dry");
  const force = process.argv.includes("--force");
  let r: Awaited<ReturnType<typeof main>>;
  try {
    r = await main();
  } catch (err) {
    const msg = `The migration health check itself failed:\n\n${String(err).slice(0, 800)}`;
    console.error(msg);
    if (!dry) await send("Pixeltrunk migration — HEALTH CHECK BROKEN", msg);
    process.exit(1);
  }

  console.log(r.body);

  // `--heal <VERDICT>`: run that verdict's remedy by hand, whatever the live
  // verdict is. No email, no state. This is how each remedy was proven.
  const healAt = process.argv.indexOf("--heal");
  if (healAt !== -1) {
    const v = process.argv[healAt + 1] as Verdict;
    const plan = r.remedyFor(v);
    if (!plan) { console.log(`\n--heal ${v}: no automatic remedy for that verdict in the current state`); return; }
    console.log(`\n--heal ${v}: ${plan.name}`);
    if (dry) { console.log("(dry: not run)"); return; }
    console.log(`  → ${plan.run()}`);
    return;
  }

  if (dry) {
    if (r.verdict !== "OK") console.log(`\nremedy: ${r.remedy ? `would try "${r.remedy.name}" (dry: not run)` : "none automatic"}`);
    return;
  }

  // Notify on a CHANGE of verdict, on recovery, at most daily while bad, and
  // ONCE when a remedy has been tried and the verdict has not moved.
  let prev: StallState | null = null;
  try { prev = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { /* first run */ }
  const changed = !prev || prev.verdict !== r.verdict;
  const stale = prev ? (Date.now() - prev.at) / 3600_000 > RENOTIFY_HOURS : true;

  let remedyRecord = prev && !changed ? prev.remedy : undefined;
  let remedyLine = "";
  let escalate = false;
  if (r.verdict !== "OK" && r.remedy) {
    if (!remedyRecord) {
      let note: string;
      try { note = r.remedy.run(); }
      catch (e) { note = `REMEDY FAILED: ${String((e as Error).message).slice(0, 200)}`; }
      remedyRecord = { name: r.remedy.name, at: Date.now(), note };
      remedyLine = `\n\nAutomatic remedy: ${r.remedy.name}\n  → ${note}\nThe next check, in about an hour, reports whether it worked.`;
      console.log(remedyLine.trim());
    } else if (!remedyRecord.escalated) {
      escalate = true;
      remedyRecord = { ...remedyRecord, escalated: true };
      remedyLine = `\n\nAutomatic remedy already tried at ${new Date(remedyRecord.at).toISOString()}: ${remedyRecord.name}\n  → ${remedyRecord.note}\nIt did not help. This one needs a human.`;
    }
  } else if (r.verdict !== "OK" && (changed || stale)) {
    remedyLine = "\n\nNo automatic remedy for this verdict.";
  }

  const write = (s: StallState) => fs.writeFileSync(STATE, JSON.stringify(s));
  if (force || (r.verdict !== "OK" && (changed || stale || escalate))) {
    await send(`Pixeltrunk migration — ${r.verdict}${escalate ? " (remedy did not help)" : ""}`, r.body + remedyLine);
    write({ verdict: r.verdict, at: Date.now(), ...(remedyRecord ? { remedy: remedyRecord } : {}) });
  } else if (r.verdict === "OK" && prev && prev.verdict !== "OK") {
    const after = prev.remedy ? `\n\nRecovered after the automatic remedy tried at ${new Date(prev.remedy.at).toISOString()}: ${prev.remedy.name}\n  → ${prev.remedy.note}` : "";
    await send("Pixeltrunk migration — recovered", r.body + after);
    write({ verdict: "OK", at: Date.now() });
  } else {
    write({ verdict: r.verdict, at: prev?.at ?? Date.now(), ...(remedyRecord ? { remedy: remedyRecord } : {}) });
  }
})();
