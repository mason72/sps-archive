/**
 * npx tsx --test scripts/pixieset/repull-runner.test.ts
 *
 * Runs the REAL runner in a throwaway tree: fake staging folder, fake queue, no
 * email keys, and a stub `npx` on PATH standing in for the ingest and
 * version-shape. Each slug below is one way a run can end. What matters most is
 * which ZIPs survive: this script must never delete one.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = process.cwd();
/** The real npx starts the runner; the stub, first on PATH, answers the runner's own npx calls. */
const REAL_NPX = spawnSync("which", ["npx"], { encoding: "utf8" }).stdout.trim();
let tmp: string;
let root: string;
let staging: string;

const ZIP = (slug: string, part = "1of1") => `${slug}-photo-download-${part}.zip`;
const SCENARIOS = ["clean", "warned", "crash", "nothingnew", "kept", "partial", "orphans", "halfthere", "quarantined", "indented", "linkfail", "refused", "refusedold", "twin", "nothumb", "twice", "waiting"];

// The stub prints what the real tools print, per slug, and logs every call.
const STUB = `#!/bin/bash
echo "$*" >> "$STUB_LOG"
shift # tsx
script="$1"; shift
id="$1"
if [ "$script" = "scripts/triage/version-shape.ts" ]; then
  if [ "$id" = "ev-orphans" ]; then echo "images 5 · names 5 · names with versions 0 · no thumbnail 0 · not complete 0 · ORPHANS 2"
  elif [ "$id" = "ev-nothumb" ]; then echo "images 5 · names 5 · names with versions 0 · no thumbnail 3 · not complete 1 · ORPHANS 0"
  elif [ "$id" = "ev-twice" ]; then echo "images 5 · names 5 · names with versions 0 · no thumbnail 0 · not complete 0 · ORPHANS 0"; echo "  Day 1: 3 photos · 1 NAME(S) TWICE IN THIS SECTION"
  else echo "images 5 · names 5 · names with versions 1 · no thumbnail 0 · not complete 0 · ORPHANS 0"; fi
  exit 0
fi
slug="$id"
if [ "\${2:-}" != "--apply" ]; then
  case "$slug" in
    warned) echo "⚠ 1 filename(s) hold a stored photo that matches NONE of this archive's versions"; echo "to ingest  : 1 image(s)";;
    indented) echo "  ⚠ a.zip: 1 name(s) could not be proven"; echo "to ingest  : 1 image(s)";;
    twin) echo "to ingest  : 50 image(s)"; echo "already delivered: skipping 50 frame(s) already in \"Other\" — nothing new in this collection";;
    *) echo "to ingest  : 1 image(s)";;
  esac
  exit 0
fi
z="$STAGING/verified/$slug-photo-download-1of1.zip"
case "$slug" in
  clean|orphans|nothumb|twice) rm "$z"; echo "archive released — all proven";;
  crash) echo "Error: database timeout"; exit 1;;
  linkfail) echo "nothing new to import — every photo is already in the archive."; echo "Error: removing links timed out"; exit 1;;
  nothingnew) echo "nothing new to import — every photo is already in the archive.";;
  kept) mkdir -p "$STAGING/ingested"; mv "$z" "$STAGING/ingested/"; echo "archive KEPT";;
  partial) echo "imported 3, 2 failed"; echo "archive KEPT (there were failures) — rerun to fill the gaps; it is idempotent.";;
esac
exit 0
`;

function runner(...args: string[]) {
  const stubDir = path.join(tmp, "bin");
  return spawnSync(REAL_NPX, ["tsx", "scripts/pixieset/repull-runner.ts", ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      PATH: `${stubDir}:${process.env.PATH}`,
      HOME: process.env.HOME,
      PIXIESET_STAGING: staging,
      STAGING: staging,
      STUB_LOG: path.join(tmp, "calls.log"),
    },
  });
}
const ledger = () => JSON.parse(fs.readFileSync(path.join(root, "scripts/pixieset/data/repull-ledger.json"), "utf8")) as { rows: { slug: string; state: string; attempts: number; note?: string; unmailed?: boolean }[] };
const row = (slug: string) => ledger().rows.find((r) => r.slug === slug)!;
const has = (dir: string, slug: string) => fs.existsSync(path.join(staging, dir, ZIP(slug)));
const calls = () => (fs.existsSync(path.join(tmp, "calls.log")) ? fs.readFileSync(path.join(tmp, "calls.log"), "utf8") : "");

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "repull-test-"));
  root = path.join(tmp, "repo");
  staging = path.join(tmp, "staging");
  for (const d of ["scripts/pixieset/data", "scripts/pixieset/extension"]) fs.mkdirSync(path.join(root, d), { recursive: true });
  for (const d of ["verified", "ingested", "quarantine"]) fs.mkdirSync(path.join(staging, d), { recursive: true });
  for (const f of ["repull-runner.ts", "repull-list.ts"]) fs.copyFileSync(path.join(REPO, "scripts/pixieset", f), path.join(root, "scripts/pixieset", f));
  fs.writeFileSync(path.join(root, ".env.local"), "");
  const slugs = [...SCENARIOS, ...Array.from({ length: 42 - SCENARIOS.length }, (_, i) => `filler${i}`)];
  fs.writeFileSync(path.join(root, "scripts/pixieset/extension/background.js"), `const SAME_NAME_REPULL = [${slugs.map((s) => `"${s}"`).join(",")}];`);
  const collections = Object.fromEntries(slugs.map((s) => [s, { id: s, slug: s, name: s, state: "ingested", eventId: `ev-${s}` }]));
  fs.writeFileSync(path.join(root, "scripts/pixieset/data/queue.json"), JSON.stringify({ collections }));
  fs.mkdirSync(path.join(tmp, "bin"));
  fs.writeFileSync(path.join(tmp, "bin/npx"), STUB, { mode: 0o755 });

  const old = new Date(Date.now() - 600_000);
  const stage = (name: string, dir = "verified") => {
    const p = path.join(staging, dir, name);
    fs.writeFileSync(p, "zip");
    fs.utimesSync(p, old, old);
  };
  for (const s of ["clean", "warned", "crash", "nothingnew", "kept", "partial", "orphans", "indented", "linkfail", "twin", "nothumb", "twice", "waiting"]) stage(ZIP(s));
  stage(ZIP("halfthere", "1of2")); // part 2 has not landed
  stage(ZIP("quarantined"), "quarantine");
  // The stale one predates the re-pull; a fresh one is written by a later test.
  fs.mkdirSync(path.join(staging, "retired"), { recursive: true });
  const stale = path.join(staging, "retired/px-retired-refusedold.json");
  fs.writeFileSync(stale, JSON.stringify({ reason: "gone" }));
  const beforeRepull = new Date("2026-10-01T00:00:00Z");
  fs.utimesSync(stale, beforeRepull, beforeRepull);
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("report mode with no ledger writes nothing and calls nothing", () => {
  const r = runner();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(path.join(root, "scripts/pixieset/data/repull-ledger.json")), false);
  assert.equal(calls(), "");
});

test("first --apply run: every outcome lands in the right state", () => {
  const r = runner("--apply");
  assert.match(r.stdout, /seeded the ledger with 42/);

  // Proven by the ingest and released by it.
  assert.equal(row("clean").state, "done");
  assert.equal(has("verified", "clean"), false);

  // A ⚠, at the start of a line or indented: held, and --apply never ran.
  for (const s of ["warned", "indented"]) {
    assert.equal(row(s).state, "held", s);
    assert.equal(has("verified", s), true, s);
    assert.doesNotMatch(calls(), new RegExp(`${s} --apply`));
  }

  // The import crashed: pending, ZIP untouched.
  assert.equal(row("crash").state, "pending");
  assert.equal(row("crash").attempts, 1);
  assert.equal(has("verified", "crash"), true);

  // Nothing new to upload, then the link fix threw: the exit code decides, not the wording.
  assert.equal(row("linkfail").state, "pending");
  assert.equal(has("verified", "linkfail"), true);

  // Nothing new: done, but THIS SCRIPT leaves the ZIP for the sweep's proof.
  assert.equal(row("nothingnew").state, "done");
  assert.equal(has("verified", "nothingnew"), true);

  // The ingest parked it: held, ZIP parked.
  assert.equal(row("kept").state, "held");
  assert.equal(has("ingested", "kept"), true);

  // Failed uploads, exit 0: pending, ZIP untouched.
  assert.equal(row("partial").state, "pending");
  assert.equal(has("verified", "partial"), true);

  // Landed, but the gallery check fails.
  assert.equal(row("orphans").state, "held");
  assert.match(row("orphans").note!, /outside every section/);

  // A missing part is not a download yet.
  assert.equal(row("halfthere").state, "pending");
  assert.equal(row("halfthere").attempts, 0);
  assert.equal(fs.existsSync(path.join(staging, "verified", ZIP("halfthere", "1of2"))), true);
  assert.doesNotMatch(calls(), /halfthere/);

  // Failed the watcher's checks.
  assert.equal(row("quarantined").state, "held");

  // Versions the twin check would skip: held, never applied, ZIP in place.
  assert.equal(row("twin").state, "held");
  assert.match(row("twin").note!, /another gallery/);
  assert.equal(has("verified", "twin"), true);
  assert.doesNotMatch(calls(), /pixieset-ingest.ts twin --apply/);

  // The gallery check holds on each of its other signals too.
  assert.match(row("nothumb").note!, /without a thumbnail, photos not complete/);
  assert.match(row("twice").note!, /twice in one section/);

  // A retirement from an earlier pass of the migration says nothing about this one.
  assert.equal(row("refusedold").state, "pending");

  // Not landed at all.
  assert.equal(row("filler0").state, "pending");
  assert.equal(row("filler0").attempts, 0);

  // No keys in this tree, so the held mails are owed and the run says so.
  assert.equal(row("warned").unmailed, true);
  assert.equal(r.status, 1);
});

test("a done collection is never run again, and three failures become a hold with the ZIP intact", () => {
  const before = (calls().match(/clean/g) ?? []).length;
  runner("--apply");
  runner("--apply");
  assert.equal((calls().match(/clean/g) ?? []).length, before);
  assert.equal(row("crash").state, "held");
  assert.equal(has("verified", "crash"), true);
  assert.equal(row("partial").state, "held");
  assert.equal(has("verified", "partial"), true);
});

test("Pixieset refusing the re-download is a hold, not a row that waits forever", () => {
  fs.writeFileSync(path.join(staging, "retired/px-retired-refused.json"), JSON.stringify({ reason: "password-rejected", detail: "the armed password was refused" }));
  runner("--apply");
  assert.equal(row("refused").state, "held");
  assert.match(row("refused").note!, /password-rejected/);
  assert.equal(row("refusedold").state, "pending");
});

test("a hand edit back to pending is respected", () => {
  const p = path.join(root, "scripts/pixieset/data/repull-ledger.json");
  const l = ledger();
  Object.assign(l.rows.find((r) => r.slug === "warned")!, { state: "pending", attempts: 0 });
  fs.writeFileSync(p, JSON.stringify(l));
  runner("--apply");
  assert.equal(row("warned").state, "held"); // it re-ran the dry run and held again
  assert.equal(row("warned").attempts, 1);
});

test("report mode with a ledger changes nothing and never applies", () => {
  const p = path.join(root, "scripts/pixieset/data/repull-ledger.json");
  const l = ledger();
  Object.assign(l.rows.find((r) => r.slug === "waiting")!, { state: "pending", attempts: 0 });
  fs.writeFileSync(p, JSON.stringify(l));
  const was = fs.readFileSync(p, "utf8");
  fs.rmSync(path.join(tmp, "calls.log"), { force: true });
  const r = runner();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /would apply waiting/);
  assert.match(calls(), /pixieset-ingest.ts waiting/);
  assert.doesNotMatch(calls(), /--apply/);
  assert.equal(fs.readFileSync(p, "utf8"), was);
  assert.equal(has("verified", "waiting"), true);
});

test("a second runner stands down while one holds the lock", () => {
  const lock = path.join(root, "scripts/pixieset/data/repull-ledger.json.lock");
  const holder = spawn("/bin/sh", ["-c", "exec -a repull-runner sleep 30"], { stdio: "ignore" });
  spawnSync("sleep", ["0.3"]);
  fs.writeFileSync(lock, String(holder.pid));
  const r = runner("--apply");
  holder.kill("SIGKILL");
  assert.match(r.stdout, /another runner holds the lock/);
  assert.equal(fs.readFileSync(lock, "utf8"), String(holder.pid));
  fs.rmSync(lock);
  fs.writeFileSync(lock, "1"); // a live process that is not this script: launchd, after a reboot reused the pid
  const stale = runner("--apply");
  assert.doesNotMatch(stale.stdout, /another runner holds the lock/);
  fs.writeFileSync(lock, "999999"); // a dead holder is cleared
  const again = runner("--apply");
  assert.doesNotMatch(again.stdout, /another runner holds the lock/);
  assert.equal(fs.existsSync(lock), false);
});
