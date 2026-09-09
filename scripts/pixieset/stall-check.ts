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
 *   STUCK   — collections ARE staged and waiting, but nothing has completed in
 *             STUCK_HOURS. Something is wrong with the ingest.
 *   STARVED — nothing staged, work still queued, and nothing has completed in
 *             STARVED_HOURS. This is not a bug: it means the DOWNLOAD half has
 *             not been run, and that needs Mason's Chrome. It is the exact state
 *             that went unnoticed for four days.
 *
 * The check must never fail QUIETLY — a health check that dies in silence is
 * worse than none, because it converts "broken" into "reassuring". Any throw is
 * caught, emailed, and exits non-zero.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const HOME = process.env.HOME!;
const QUEUE = path.join("scripts", "pixieset", "data", "queue.json");
const LOG = path.join(HOME, "pixieset-staging", "logs", "ingest.log");
const STATE = path.join(HOME, "pixieset-staging", "logs", "stall-state.json");

/**
 * `Number(x) || default` silently ignores a deliberate 0, because 0 is falsy —
 * which made the first attempt at negative-testing STUCK impossible to fail.
 * A threshold you cannot set to zero is a threshold you cannot test.
 */
const num = (v: string | undefined, fallback: number) =>
  v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : fallback;
const STUCK_HOURS = num(process.env.PIXIESET_STUCK_HOURS, 4);
const STARVED_HOURS = num(process.env.PIXIESET_STARVED_HOURS, 36);
const RENOTIFY_HOURS = 24;
const MAX_PASSES_PER_HOUR = num(process.env.PIXIESET_MAX_PASSES, 40);   // ~12 expected at a 5-minute idle; 40 is generous
const BACKUP_STALE_HOURS = num(process.env.PIXIESET_BACKUP_STALE_HOURS, 48);   // nightly, so 48h is two missed runs

type Verdict = "OK" | "BROKEN" | "SPINNING" | "STUCK" | "STARVED" | "UNBACKED";

/**
 * When did the migration ledger last reach GitHub?
 *
 * `scripts/pixieset/data/` is gitignored, so `queue.json` — the only record of
 * which of 1,371 collections are already safe — has no off-machine copy of its
 * own. `machine-state`'s nightly sync backs it up encrypted; this is the
 * independent check that the backup HAPPENED, because a backup nobody verifies
 * is a belief. It was worth building on the day it was written: that sync had
 * been silently refusing to push for 26 consecutive nights.
 *
 * The question asked is deliberately "did it reach ORIGIN", not "was it
 * written" or "was it committed" — the whole point is a copy that survives this
 * Mac. A missing repo, an unreadable one, or a commit older than the window are
 * all the same answer: not backed up.
 */
function ledgerBackupAgeHours(): { hours: number | null; note: string } {
  const repo = process.env.PIXIESET_BACKUP_REPO || path.join(HOME, "machine-state");
  const file = process.env.PIXIESET_BACKUP_PATH || "ledgers/pixieset-queue.json.gz";
  if (!fs.existsSync(repo)) return { hours: null, note: `${repo} is not on this machine` };
  try {
    const out = execFileSync("/usr/bin/git", ["-C", repo, "log", "-1", "--format=%cI", "origin/main", "--", file], { encoding: "utf8" }).trim();
    if (!out) return { hours: null, note: `${file} has never reached origin/main` };
    return { hours: (Date.now() - new Date(out).getTime()) / 3600_000, note: out };
  } catch (e) {
    return { hours: null, note: `could not read ${repo}: ${String((e as Error).message).slice(0, 80)}` };
  }
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
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { ok: false, freeGB: null, note: `HTTP ${res.status}` };
    const body = (await res.json()) as { freeGB?: number };
    if (!Number.isFinite(body?.freeGB)) return { ok: false, freeGB: null, note: "no freeGB in the response" };
    return { ok: true, freeGB: body.freeGB!, note: "" };
  } catch (e) {
    return { ok: false, freeGB: null, note: String((e as Error).message).slice(0, 80) };
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

  const agents = agentsRunning();
  const down = agents.filter((a) => !a.up).map((a) => a.label);
  const { passes, idles } = logRate();
  const backup = ledgerBackupAgeHours();
  const brake = await diskBrake();

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
  } else if (verified > 0 && stagedHours > STUCK_HOURS) {
    verdict = "STUCK";
    headline = `${verified} collection(s) staged, the oldest waiting ${stagedHours.toFixed(1)}h with nothing completing`;
  } else if (verified === 0 && queued > 0 && hoursSince > STARVED_HOURS) {
    verdict = "STARVED";
    headline = `nothing staged and nothing completed in ${hoursSince.toFixed(0)}h — the download extension has stopped producing work`;
  } else if (backup.hours === null || backup.hours > BACKUP_STALE_HOURS) {
    // Checked LAST on purpose: a pipeline that has stopped matters more than one
    // whose ledger is a day stale, and this must never mask a STARVED or STUCK.
    verdict = "UNBACKED";
    headline = backup.hours === null
      ? `the migration ledger has no off-machine copy — ${backup.note}`
      : `the migration ledger last reached GitHub ${backup.hours.toFixed(0)}h ago`;
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
    `last hour  ${passes} passes, ${idles} idles`,
    `ledger     ${backup.hours === null ? `NOT BACKED UP — ${backup.note}` : `backed up ${backup.hours.toFixed(1)}h ago`}`,
    `disk       ${brake.ok ? `${brake.freeGB} GB free, brake answering` : `BRAKE DOWN — ${brake.note}`}`,
    verdict === "UNBACKED"
      ? `\nqueue.json is the only record of which of the 1,371 collections are\nalready safe. Losing it does not lose photos — it loses the knowledge of\nwhich ones are done, which is the difference between finishing this\nmigration and re-running a month of it blind.\n\nIt is backed up by machine-state's nightly sync (20:00). Read\n~/machine-state/.sync.log: that job refuses to push when anything tracked\nis unencrypted, and it stayed silently blocked for 26 nights once before.`
      : "",
    verdict === "STARVED"
      ? `\nNothing has been requested from Pixieset. Since 2026-08-31 that is the\nChrome extension's job, so this is now a POINTER, not a chore: open its\npopup (pin it to the toolbar) and read the last line, which always says\nwhy it stopped. Known causes, in order of how often they have happened:\n\n  · the head of the queue is stuck  — fixed 2026-09-08; a gated collection\n    was re-requested every 20 min forever. If a single slug repeats down\n    the whole log, that is this shape returning.\n  · everything left is password-gated — sign in to galleries.pixieset.com\n    and press Arm passwords.\n  · Cloudflare challenged it three times — it stops deliberately. Do not\n    work around it; tell Mason.\n  · Chrome is not running, or the extension was unloaded.`
      : "",
  ].filter(Boolean).join("\n");

  return { verdict, headline, body };
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
  if (dry) return;

  // Notify on a CHANGE of verdict, on recovery, and at most daily while bad.
  let prev: { verdict: string; at: number } | null = null;
  try { prev = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { /* first run */ }
  const changed = !prev || prev.verdict !== r.verdict;
  const stale = prev ? (Date.now() - prev.at) / 3600_000 > RENOTIFY_HOURS : true;

  if (force || (r.verdict !== "OK" && (changed || stale))) {
    await send(`Pixeltrunk migration — ${r.verdict}`, r.body);
    fs.writeFileSync(STATE, JSON.stringify({ verdict: r.verdict, at: Date.now() }));
  } else if (r.verdict === "OK" && prev && prev.verdict !== "OK") {
    await send("Pixeltrunk migration — recovered", r.body);
    fs.writeFileSync(STATE, JSON.stringify({ verdict: "OK", at: Date.now() }));
  } else {
    fs.writeFileSync(STATE, JSON.stringify({ verdict: r.verdict, at: prev?.at ?? Date.now() }));
  }
})();
