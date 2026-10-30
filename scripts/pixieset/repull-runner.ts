/**
 * Import the same-name re-pull without anyone watching (lesson 197).
 *
 * The pre-2026-10-29 ingest kept one photo per FILENAME, so 42 collections lost
 * their other versions (BW vs Color, retouched vs raw, Day 1 vs Day 2 under one
 * camera counter). Extension v1.3.11 re-downloads them; they land in `verified/`
 * while the queue still says `ingested`, so the ingest loop's `--next` never
 * picks them up. This does, one collection at a time, as each lands:
 *
 *   1. dry run. A ⚠ anywhere (a stored photo matching no version, names that
 *      could not be proven) or a plan it does not recognise HOLDS the collection
 *      for a human; nothing is written. A dry run that crashes is retried;
 *   2. `--apply`. Only a run that exits 0 counts. The ingest itself releases the
 *      archive behind its full proof (landing check + no unmatched name +
 *      px-filecheck), or parks it in `ingested/` when it is not satisfied;
 *   3. version-shape: done needs ORPHANS 0, no thumbnail 0, not complete 0 and no
 *      filename twice in one section.
 *
 * THIS SCRIPT NEVER DELETES AN ARCHIVE. When the ingest had nothing new to land
 * it leaves the ZIP in `verified/`; once the ledger says `done`, the release
 * sweep may free it on its own per-file proof. A crash, a failed upload or a
 * failed link fix leaves the ZIP where it is and the collection pending.
 *
 *   npx tsx scripts/pixieset/repull-runner.ts            # report only: writes nothing, sends nothing
 *   npx tsx scripts/pixieset/repull-runner.ts --apply    # do it (launchd runs this)
 *
 * State: scripts/pixieset/data/repull-ledger.json (see repull-list.ts). Mason is
 * emailed when a collection is held, once a day while one is stuck pending past
 * four days, and once when the list is finished.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REPULL_LEDGER, readRepullLedger, repullSlugs, retiredSince, type RepullLedger, type RepullRow } from "./repull-list";

const APPLY = process.argv.includes("--apply");
/** Run from the repo root, like every script here (launchd sets WorkingDirectory). */
const ROOT = process.cwd();
if (!fs.existsSync(path.join(ROOT, "scripts/pixieset/repull-runner.ts"))) throw new Error(`run from the repo root, not ${ROOT}`);
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const QUEUE = path.join(ROOT, "scripts/pixieset/data/queue.json");
const LOCK = `${REPULL_LEDGER}.lock`;
const STAGING = process.env.PIXIESET_STAGING || path.join(os.homedir(), "pixieset-staging");
const VERIFIED = path.join(STAGING, "verified");
const INGESTED = path.join(STAGING, "ingested");
const QUARANTINE = path.join(STAGING, "quarantine");
const RETIRED = path.join(STAGING, "retired");
/** A collection that cannot finish in three runs is a human's problem. */
const MAX_ATTEMPTS = 3;
const STALE_DAYS = 4;
/** When the re-pull's requests began (v1.3.11 loaded). An older refusal is an earlier pass of the migration. */
const REPULL_STARTED_MS = Date.parse("2026-10-30T04:54:00Z");
/** launchd never starts a second copy, so a hung child would stop the whole list silently. */
const CHILD_DEADLINE_MS = Number(process.env.REPULL_CHILD_DEADLINE_MS) || 12 * 60 * 60 * 1000;

type Col = { id: string; slug: string; name: string; state: string; eventId?: string | null };

/**
 * Every change re-reads the ledger, so a hand edit (held → pending) made while a
 * long import runs is kept. Report-only mode never writes.
 */
function update(fn: (l: RepullLedger) => void) {
  if (!APPLY) return;
  const l = readRepullLedger();
  if (!l) throw new Error("ledger vanished mid-run");
  fn(l);
  const tmp = `${REPULL_LEDGER}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(l, null, 2) + "\n");
  fs.renameSync(tmp, REPULL_LEDGER);
}
const patchRow = (slug: string, patch: Partial<RepullRow>) =>
  update((l) => Object.assign(l.rows.find((r) => r.slug === slug)!, patch));

/** One runner at a time: two `--apply` imports of one event would both upload the same photos. */
function takeLock(): boolean {
  for (let tries = 0; tries < 2; tries++) {
    try {
      fs.writeFileSync(LOCK, String(process.pid), { flag: "wx" });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      // A killed run leaves its lock behind, and after a reboot its pid can belong to
      // anything. Only a live process that IS this script holds it.
      const pid = Number(fs.readFileSync(LOCK, "utf8"));
      const holder = spawnSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }).stdout ?? "";
      if (holder.includes("repull-runner")) return false;
      fs.rmSync(LOCK, { force: true });
    }
  }
  return false;
}

const partsIn = (dir: string, slug: string) =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith(`${slug}-photo-download-`)) : [];

/** Every part of a multi-part download present ("1of3", "2of3", "3of3"), and quiet for a minute. */
function complete(slug: string): boolean {
  const files = partsIn(VERIFIED, slug);
  if (!files.length) return false;
  const nums = files.map((f) => f.match(/-(\d+)of(\d+)\.zip$/));
  if (nums.some((m) => !m)) return false;
  const of = Number(nums[0]![2]);
  if (nums.some((m) => Number(m![2]) !== of) || new Set(nums.map((m) => Number(m![1]))).size !== of) return false;
  return files.every((f) => Date.now() - fs.statSync(path.join(VERIFIED, f)).mtimeMs > 60_000);
}

/** Run a child, stream it to our log (whole lines, indented), and keep its output. */
function run(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", ...args], { cwd: ROOT, env: process.env });
    let out = "";
    let printed = 0;
    const take = (text: string) => {
      out += text;
      const end = out.lastIndexOf("\n") + 1;
      if (end > printed) process.stdout.write(out.slice(printed, end).replace(/^/gm, "    "));
      printed = Math.max(printed, end);
    };
    // Decoded by the stream, so a ⚠ split across two chunks still reads as ⚠.
    child.stdout.setEncoding("utf8").on("data", take);
    child.stderr.setEncoding("utf8").on("data", take);
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (out.length > printed) process.stdout.write(`    ${out.slice(printed)}\n`);
      resolve({ code, out });
    };
    // SIGTERM travels down through npx to the real process; SIGKILL stops at npx, whose
    // child would then hold the pipes open, so `close` may never come. Hence the last timer.
    const deadline = setTimeout(() => {
      out += `\nkilled: still running after ${CHILD_DEADLINE_MS / 3_600_000} h\n`;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 30_000).unref();
      setTimeout(() => finish(1), 60_000).unref();
    }, CHILD_DEADLINE_MS);
    child.on("close", (code) => finish(code ?? 1));
  });
}

/** True only when Resend accepted it. Report-only mode sends nothing. */
async function send(subject: string, body: string): Promise<boolean> {
  if (!APPLY) {
    console.log(`  (report only: would email "${subject}")`);
    return true;
  }
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const to = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!key || !from || !to.length) {
    console.error(`CANNOT SEND: key=${!!key} from=${!!from} recipients=${to.length}`);
    process.exitCode = 1;
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `Pixeltrunk Migration <${from}>`, to, subject, text: body }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  } catch (err) {
    console.error(`email failed (retried next run): ${String(err)}`);
    process.exitCode = 1;
    return false;
  }
  console.log(`emailed: ${subject}`);
  return true;
}

/** The lines a human needs from an ingest run, without the per-photo noise. */
const gist = (out: string) =>
  out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^(versions:|to ingest|⚠|would remove|version links|already delivered|archive |nothing |imported|fingerprinted|Error)/.test(l))
    .join("\n");

/** Where this collection's download is right now, said plainly for the email. */
function whereArchive(slug: string): string {
  const v = partsIn(VERIFIED, slug).length;
  const i = partsIn(INGESTED, slug).length;
  if (v) return `The download is still staged on the Studio (~/pixieset-staging/verified, ${v} part(s)).`;
  if (i) return `The download is parked on the Studio (~/pixieset-staging/ingested, ${i} part(s)).`;
  return "The download is not staged on the Studio (not yet downloaded, or released by the ingest after proving every file landed).";
}

const heldMail = (col: Col, why: string, detail: string, wrote: boolean) =>
  `${col.name.trim()} (collection ${col.id}, event ${col.eventId ?? "none"}) was not finished automatically.\n\n` +
  `Why: ${why}\n\n${detail ? `${detail}\n\n` : ""}` +
  (wrote ? "The import ran, so this gallery may already have changed in Pixeltrunk. " : "Nothing was written to Pixeltrunk. ") +
  `${whereArchive(col.slug)}\n\nA person needs to look at this one. Ledger: scripts/pixieset/data/repull-ledger.json.`;

async function hold(col: Col, why: string, detail: string, wrote: boolean) {
  console.log(`  HELD ${col.slug}: ${why}`);
  const mail = heldMail(col, why, detail, wrote);
  patchRow(col.slug, { state: "held", at: new Date().toISOString(), note: why, mail, unmailed: true });
  if (await send(`Pixieset re-pull held: ${col.name.trim()}`, mail)) patchRow(col.slug, { unmailed: false });
}

async function retry(col: Col, attempts: number, why: string, detail: string, wrote: boolean) {
  if (attempts >= MAX_ATTEMPTS) return hold(col, `${MAX_ATTEMPTS} runs could not finish: ${why}`, detail, wrote);
  console.log(`  retry later (${attempts}/${MAX_ATTEMPTS}): ${why}`);
}

async function processOne(row: RepullRow, col: Col) {
  console.log(`\n── ${col.slug} (${col.id}) · ${new Date().toISOString()}`);
  const attempts = row.attempts + 1;
  patchRow(row.slug, { attempts });

  const dry = await run(["scripts/pixieset-ingest.ts", col.id]);
  if (dry.code !== 0) return retry(col, attempts, `the dry run exited ${dry.code}`, dry.out.slice(-1500), false);
  // Fail CLOSED on wording: a plan this script does not recognise is held, never applied.
  if (!/^\s*to ingest\s*:/m.test(dry.out)) return hold(col, "the dry run did not print a plan", dry.out.slice(-1500), false);
  if (dry.out.includes("⚠")) return hold(col, "the dry run raised a warning (⚠)", gist(dry.out), false);
  // The twin check would skip versions another gallery already holds. The import would
  // then print "nothing new" and exit 0, its link fix would skip those names, and this
  // would call it done with the collapsed links still in place (Hitachi | Gajen, 50 frames).
  if (/already delivered:/.test(dry.out)) return hold(col, "some missing versions are already in another gallery, so a person decides where they belong", gist(dry.out), false);
  if (!APPLY) return console.log(`  would apply ${col.slug}:\n${gist(dry.out).replace(/^/gm, "    ")}`);

  const applied = await run(["scripts/pixieset-ingest.ts", col.id, "--apply"]);
  const shape = await run(["scripts/triage/version-shape.ts", col.eventId!]);
  const shapeLine = shape.out.split("\n").find((l) => l.startsWith("images ")) ?? "(version-shape printed nothing)";
  patchRow(row.slug, { shape: shapeLine });

  if (applied.code !== 0) return retry(col, attempts, `the import exited ${applied.code}`, `${gist(applied.out)}\n\n${applied.out.slice(-800)}`, true);
  if (partsIn(INGESTED, col.slug).length) return hold(col, "the import kept the download for review", `${gist(applied.out)}\n\n${shapeLine}`, true);
  if (partsIn(VERIFIED, col.slug).length && !/nothing new to import — every photo is already in the archive/.test(applied.out)) {
    // The ingest leaves its download staged on purpose when uploads failed: run it again.
    return retry(col, attempts, "the import left its download staged (uploads failed?)", gist(applied.out), true);
  }
  const bad = [
    shape.code !== 0 && "version-shape failed",
    !/ORPHANS 0\b/.test(shapeLine) && "photos outside every section",
    !/no thumbnail 0\b/.test(shapeLine) && "photos without a thumbnail",
    !/not complete 0\b/.test(shapeLine) && "photos not complete",
    /TWICE IN THIS SECTION/.test(shape.out) && "a filename twice in one section",
  ].filter(Boolean);
  if (bad.length) return hold(col, `the gallery check failed: ${bad.join(", ")}`, `${shape.out.trim()}\n\n${gist(applied.out)}`, true);

  patchRow(row.slug, {
    state: "done",
    at: new Date().toISOString(),
    note: gist(applied.out).split("\n").filter((l) => /^(versions:|to ingest|version links|archive |nothing )/.test(l)).join(" · "),
  });
  console.log(`  DONE ${col.slug}: ${shapeLine}`);
}

async function main() {
  console.log(`=== re-pull runner · ${new Date().toISOString()} · ${APPLY ? "APPLY" : "report only"} ===`);
  if (!readRepullLedger()) {
    if (!APPLY) return console.log(`no ledger yet; --apply seeds it with ${repullSlugs().length} collections. Report mode stops here.`);
  }
  if (APPLY && !takeLock()) return console.log("another runner holds the lock; leaving it to finish.");
  try {
    if (APPLY && !readRepullLedger()) {
      const seeded: RepullLedger = {
        createdAt: new Date().toISOString(),
        source: "background.js SAME_NAME_REPULL (repair 2026-10-29-requeue-same-name-collapse)",
        rows: repullSlugs().map((slug) => ({ slug, state: "pending", attempts: 0 })),
      };
      fs.writeFileSync(`${REPULL_LEDGER}.tmp`, JSON.stringify(seeded, null, 2) + "\n");
      fs.renameSync(`${REPULL_LEDGER}.tmp`, REPULL_LEDGER);
      console.log(`seeded the ledger with ${seeded.rows.length} collections`);
    }
    const queue = JSON.parse(fs.readFileSync(QUEUE, "utf8")) as { collections: Record<string, Col> };
    const bySlug = new Map(Object.values(queue.collections).map((c) => [c.slug, c]));

    for (const { slug } of readRepullLedger()!.rows) {
      const row = readRepullLedger()!.rows.find((r) => r.slug === slug)!;
      const col = bySlug.get(slug);
      if (row.state === "held" && row.unmailed) {
        if (await send(`Pixieset re-pull held: ${col?.name.trim() ?? slug}`, row.mail ?? `${slug} is held: ${row.note}`)) patchRow(slug, { unmailed: false });
      }
      if (row.state !== "pending") continue;
      if (!col || col.state !== "ingested" || !col.eventId) {
        await hold(col ?? { id: "?", slug, name: slug, state: "?" }, `the queue says ${col ? `${col.state}, event ${col.eventId ?? "none"}` : "it is not in the queue"}`, "", false);
        continue;
      }
      if (partsIn(QUARANTINE, slug).length) {
        await hold(col, "the re-download failed the watcher's checks and is in quarantine/", "", false);
        continue;
      }
      if (complete(slug)) {
        await processOne(row, col);
        continue;
      }
      const refused = retiredSince(RETIRED, slug, REPULL_STARTED_MS);
      if (refused.length) await hold(col, `Pixieset refused the re-download (${refused[0].reason})`, refused[0].detail, false);
    }

    const ledger = readRepullLedger()!;
    const count = (s: RepullRow["state"]) => ledger.rows.filter((r) => r.state === s).length;
    console.log(`=== ${count("done")} done · ${count("held")} held · ${count("pending")} pending ===`);
    if (!APPLY) return;

    const day = 86_400_000;
    const stuck = Date.now() - Date.parse(ledger.createdAt) > STALE_DAYS * day;
    if (count("pending") && stuck && (!ledger.nagAt || Date.now() - Date.parse(ledger.nagAt) > day)) {
      const lines = ledger.rows.filter((r) => r.state === "pending").map((r) => `${r.slug}: ${whereArchive(r.slug)}`);
      if (await send(`Pixieset re-pull: ${count("pending")} still pending after ${STALE_DAYS} days`, lines.join("\n")))
        update((l) => { l.nagAt = new Date().toISOString(); });
    }
    if (!count("pending") && !ledger.finishedMailAt) {
      const lines = ledger.rows.map((r) => `${r.state === "done" ? "✓" : "HELD"} ${r.slug}  ${r.shape ?? ""}${r.state === "held" ? `\n     ${r.note}` : ""}`);
      if (await send(`Pixieset re-pull finished: ${count("done")} done, ${count("held")} held`, `Every collection the same-name collapse cost has been re-imported or held for a human. Unload com.twodudes.pixieset.repull.\n\n${lines.join("\n")}`))
        update((l) => { l.finishedMailAt = new Date().toISOString(); });
    }
  } finally {
    if (APPLY) fs.rmSync(LOCK, { force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
