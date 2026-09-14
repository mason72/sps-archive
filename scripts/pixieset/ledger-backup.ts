/**
 * Is the migration ledger's off-machine copy CURRENT?
 *
 * `queue.json` is gitignored, and `machine-state`'s nightly 20:00 sync is its
 * only off-machine copy. The first version of this check asked "when did the
 * ledger file last CHANGE on origin", and that is the wrong question: the sync
 * gzips with `-n`, so an unchanged ledger produces an identical file and commits
 * nothing. After any quiet stretch longer than the window, the moment work
 * resumed the check reported UNBACKED on a backup that was complete. It did
 * exactly that on 2026-09-14: the ledger sat still from Sept 11 19:00 to Sept 13
 * 22:00, two nightly syncs pushed correctly, and the email said "51h ago".
 * A guard that cries wolf trains you to ignore it on the day it is right.
 *
 * So the question is now CONTENT first, and only then time:
 *
 *   1. Does the live ledger equal the copy on origin? Then it is backed up,
 *      however old that commit is.
 *   2. It differs. Did the most recent sync run say it skipped the ledger or
 *      failed to push? Then the changes have no copy and the job is not going
 *      to make one: UNBACKED now, not in two days.
 *   3. It differs and the job looks healthy. That is normal between runs.
 *      UNBACKED only if machine-state has not pushed in `staleHours`, which
 *      is the 26-nights-silently-blocked shape this check was built for.
 *
 * Every uncertain reading (repo missing, no origin, unreadable copy) falls to
 * the time rule or to stale, never to "backed up": a false alarm costs a look,
 * a false all-clear costs the ledger.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";

export interface LedgerBackupState {
  stale: boolean;
  /** One line for the email's status table. */
  line: string;
  /** The headline when stale; empty otherwise. */
  headline: string;
}

/** Phrases machine-state's sync.sh prints when a run did not carry the ledger off this Mac. */
const SKIPPED_OR_UNPUSHED =
  /ledger NOT backed up|REFUSING to overwrite|PLAINTEXT tracked — NOT pushing|PUSH FAILED|repo is LOCKED/;

function git(repo: string, args: string[]): string {
  return execFileSync("/usr/bin/git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

/** The last run in the sync log: everything after the final "Preflight" heading. */
export function lastSyncRun(logText: string): string {
  const i = logText.lastIndexOf("\nPreflight\n");
  return i === -1 ? logText : logText.slice(i + 1);
}

export function ledgerBackupState(o: {
  repo: string;
  file: string;
  queue: string;
  syncLog: string;
  staleHours: number;
  now?: number;
}): LedgerBackupState {
  const now = o.now ?? Date.now();
  const stale = (headline: string): LedgerBackupState => ({
    stale: true,
    headline,
    line: `NOT BACKED UP — ${headline}`,
  });

  if (!fs.existsSync(o.repo)) return stale(`the migration ledger has no off-machine copy — ${o.repo} is not on this machine`);

  let tip: string;
  try {
    tip = git(o.repo, ["log", "-1", "--format=%cI", "origin/main"]);
  } catch {
    tip = "";
  }
  if (!tip) return stale(`the migration ledger has no off-machine copy — ${o.repo} has no origin/main`);
  const pushHours = (now - new Date(tip).getTime()) / 3600_000;
  const pushed = `machine-state last pushed ${pushHours.toFixed(1)}h ago`;

  // 1. Content: live ledger vs the copy that is on origin.
  let live: Buffer | null = null;
  try {
    live = fs.readFileSync(o.queue);
  } catch {
    // main() reads the queue first and would already have thrown; stay honest anyway.
    return stale(`the live ledger ${o.queue} could not be read, so nothing can be said about its backup`);
  }
  let matchesOrigin = false;
  try {
    // The working-tree copy is plaintext only in an unlocked clone; a locked one
    // yields ciphertext, gunzip throws, and we fall through to the time rule.
    const copy = zlib.gunzipSync(fs.readFileSync(path.join(o.repo, o.file)));
    const onOrigin = (() => {
      try {
        git(o.repo, ["diff", "--quiet", "origin/main", "--", o.file]);
        git(o.repo, ["cat-file", "-e", `origin/main:${o.file}`]);
        return true;
      } catch {
        return false;
      }
    })();
    matchesOrigin = onOrigin && copy.equals(live);
  } catch {
    matchesOrigin = false;
  }
  if (matchesOrigin) {
    return { stale: false, headline: "", line: `current on GitHub (${pushed})` };
  }

  // 2. It differs. Did the last run say it skipped the ledger or failed to push?
  let lastRun = "";
  try {
    lastRun = lastSyncRun(fs.readFileSync(o.syncLog, "utf8"));
  } catch {
    // No log is not evidence of a skip; the time rule still applies.
  }
  const skip = lastRun.split("\n").find((l) => SKIPPED_OR_UNPUSHED.test(l));
  if (skip) {
    return stale(
      `the migration ledger has changed since its last off-machine copy, and machine-state's most recent sync did not carry it: "${skip.trim()}"`
    );
  }

  // 3. Differs, job looks healthy: normal between runs, unless the job has gone quiet.
  if (pushHours > o.staleHours) {
    return stale(
      `machine-state has not pushed in ${pushHours.toFixed(0)}h, so ledger changes since then have no off-machine copy`
    );
  }
  return {
    stale: false,
    headline: "",
    line: `changed since the last copy, next nightly sync carries it (${pushed})`,
  };
}
