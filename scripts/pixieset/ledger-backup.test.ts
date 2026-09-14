/**
 * npx tsx --test scripts/pixieset/ledger-backup.test.ts
 *
 * Real git against a throwaway bare "origin", because the answer depends on what
 * git reports about origin/main, and a mocked git would share the assumption
 * under test. No git-crypt here: the check reads the unlocked working copy and
 * git's own diff, both of which behave the same without it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { ledgerBackupState, lastSyncRun } from "./ledger-backup";

const FILE = "ledgers/pixieset-queue.json.gz";
const HOUR = 3600_000;

function fixture(opts: { committedHoursAgo: number; ledger: string }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-backup-"));
  const origin = path.join(dir, "origin.git");
  const repo = path.join(dir, "machine-state");
  const queue = path.join(dir, "queue.json");
  const syncLog = path.join(dir, ".sync.log");
  const g = (cwd: string, args: string[], env: Record<string, string> = {}) =>
    execFileSync("/usr/bin/git", args, { cwd, stdio: "ignore", env: { ...process.env, ...env } });

  g(dir, ["init", "-q", "--bare", "-b", "main", origin]);
  g(dir, ["clone", "-q", origin, repo]);
  fs.mkdirSync(path.join(repo, "ledgers"));
  fs.writeFileSync(path.join(repo, FILE), zlib.gzipSync(opts.ledger));
  const when = new Date(Date.now() - opts.committedHoursAgo * HOUR).toISOString();
  const env = {
    GIT_AUTHOR_DATE: when,
    GIT_COMMITTER_DATE: when,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  };
  g(repo, ["add", FILE]);
  g(repo, ["commit", "-q", "-m", "sync"], env);
  g(repo, ["push", "-q", "origin", "HEAD:refs/heads/main"]);
  g(repo, ["fetch", "-q", "origin"]);

  fs.writeFileSync(queue, opts.ledger);
  fs.writeFileSync(syncLog, "Preflight\n  ok    can read\nPush\n  ok    pushed\n");
  const check = () => ledgerBackupState({ repo, file: FILE, queue, syncLog, staleHours: 48 });
  return { dir, repo, queue, syncLog, check };
}

test("an unchanged ledger is backed up however old its commit is (the 2026-09-14 false alarm)", () => {
  const f = fixture({ committedHoursAgo: 51, ledger: '{"a":1}' });
  const r = f.check();
  assert.equal(r.stale, false, r.headline);
  assert.match(r.line, /current on GitHub/);
});

test("a changed ledger between healthy nightly runs is not an alarm", () => {
  const f = fixture({ committedHoursAgo: 10, ledger: '{"a":1}' });
  fs.writeFileSync(f.queue, '{"a":2}');
  const r = f.check();
  assert.equal(r.stale, false, r.headline);
  assert.match(r.line, /next nightly sync/);
});

test("a changed ledger when machine-state has not pushed in the window is UNBACKED", () => {
  const f = fixture({ committedHoursAgo: 60, ledger: '{"a":1}' });
  fs.writeFileSync(f.queue, '{"a":2}');
  const r = f.check();
  assert.equal(r.stale, true);
  assert.match(r.headline, /has not pushed in 60h/);
});

test("a changed ledger that the last run refused or failed to push is UNBACKED at once", () => {
  for (const said of [
    "  FAIL  queue.json is 10 B against a backed-up 900 B — REFUSING to overwrite the backup",
    "  warn  pixieset queue.json not found (unresolved) — ledger NOT backed up this run",
    "  FAIL  PLAINTEXT tracked — NOT pushing (1 file(s)):",
    "  FAIL  PUSH FAILED — these commits exist ONLY on this Mac:",
  ]) {
    const f = fixture({ committedHoursAgo: 2, ledger: '{"a":1}' });
    fs.writeFileSync(f.queue, '{"a":2}');
    fs.writeFileSync(f.syncLog, `Preflight\n  ok    fine\nPush\n  ok    pushed\n\nPreflight\n  ok    can read\n${said}\n`);
    const r = f.check();
    assert.equal(r.stale, true, said);
    assert.match(r.headline, /did not carry it/);
  }
});

test("only the LAST run counts: an old refusal followed by a clean run is not an alarm", () => {
  const f = fixture({ committedHoursAgo: 2, ledger: '{"a":1}' });
  fs.writeFileSync(f.queue, '{"a":2}');
  fs.writeFileSync(f.syncLog, "Preflight\n  FAIL  PUSH FAILED — x\n\nPreflight\n  ok    can read\nPush\n  ok    pushed\n");
  assert.equal(f.check().stale, false);
});

test("the nightly NO REMOTE failure for other repos is not read as a ledger skip", () => {
  const f = fixture({ committedHoursAgo: 2, ledger: '{"a":1}' });
  fs.writeFileSync(f.queue, '{"a":2}');
  fs.writeFileSync(f.syncLog, "Preflight\n  FAIL  3 repo(s) have NO REMOTE — source exists only on this disk: x\nPush\n  ok    pushed\n");
  assert.equal(f.check().stale, false);
});

test("a working copy that matches the live ledger but never reached origin is not backed up", () => {
  const f = fixture({ committedHoursAgo: 60, ledger: '{"a":1}' });
  // Written and even committed locally, but not pushed: exactly the 26-night shape.
  fs.writeFileSync(f.queue, '{"a":2}');
  fs.writeFileSync(path.join(f.repo, FILE), zlib.gzipSync('{"a":2}'));
  execFileSync("/usr/bin/git", ["-C", f.repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "local"], { stdio: "ignore" });
  const r = f.check();
  assert.equal(r.stale, true);
});

test("a missing repo is UNBACKED, never assumed fine", () => {
  const r = ledgerBackupState({ repo: "/nonexistent/machine-state", file: FILE, queue: "/x", syncLog: "/x", staleHours: 48 });
  assert.equal(r.stale, true);
  assert.match(r.headline, /not on this machine/);
});

test("lastSyncRun returns the text after the final Preflight heading", () => {
  assert.equal(lastSyncRun("Preflight\nA\n\nPreflight\nB\n"), "Preflight\nB\n");
  assert.equal(lastSyncRun("no headings"), "no headings");
});
