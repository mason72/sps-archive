#!/usr/bin/env node
/**
 * Carry a driver run's results into the queue.
 *
 *   node scripts/pixieset/apply.mjs < report.json
 *   PX.report() | pbcopy   →   pbpaste | node scripts/pixieset/apply.mjs
 *
 * The driver runs in the browser and cannot write files; this is the other half.
 * It takes the sanitized report (counts, labels, filenames, states — never tokens)
 * and moves each collection to `requested`/`ready`, or to `failed` with its reason.
 *
 * THE FIELD THAT MATTERS IS `expectedFiles`. The set picker reports each set's photo
 * count ("All Photos 48 photos"), which is an INDEPENDENT source from the inventory's
 * `photo_count` and — unlike it — is not double-counted. Recording it here is what
 * lets `verifyArchive()` assert an EQUALITY instead of the useless upper bound. Without
 * this step a short download still passes: 48 files against a photo_count of 80 looks
 * perfectly healthy, and a gallery missing half its frames looks identical.
 *
 * `requestedAt` is stamped here rather than in the browser because it starts the 7-day
 * expiry clock, and `store.mjs` owns that definition.
 */
import { readFileSync } from "node:fs";
import { load, save, get, transition } from "./lib/store.mjs";

const readStdin = () => {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
};

const raw = process.argv[2] && process.argv[2] !== "-"
  ? readFileSync(process.argv[2], "utf8")
  : readStdin();

if (!raw.trim()) {
  console.error("usage: apply.mjs [report.json]   (or pipe PX.report() on stdin)");
  process.exit(1);
}

let report;
try {
  report = JSON.parse(raw);
} catch (e) {
  console.error(`could not parse the report as JSON: ${e.message}`);
  process.exit(1);
}

const results = Array.isArray(report) ? report : report.results;
if (!Array.isArray(results)) {
  console.error("report has no `results` array — paste the full PX.report() output");
  process.exit(1);
}

const queue = await load();
if (!queue) {
  console.error("no queue — run: node scripts/pixieset/queue.mjs build");
  process.exit(1);
}

const now = new Date().toISOString();
let advanced = 0, failed = 0, skipped = 0;

for (const r of results) {
  let c;
  try { c = get(queue, r.id); } catch { console.log(`?  ${r.slug} — not in the queue, skipped`); skipped++; continue; }

  if (c.state === "verified" || c.state === "ingested") {
    console.log(`•  ${r.slug} — already ${c.state}, left alone`);
    skipped++;
    continue;
  }

  if (!r.ok) {
    if (c.state !== "failed") transition(queue, r.id, "failed", { error: String(r.error || "driver reported failure").slice(0, 400), attempts: c.attempts + 1 });
    console.log(`✗  ${r.slug} — ${r.error || "failed"}`);
    failed++;
    continue;
  }

  // queued → requested → ready. The driver only reports ok once it has ZIP links,
  // so `ready` is the honest state; `downloaded` is the watcher's to grant, because
  // only it can see whether the bytes actually landed.
  if (c.state === "failed") transition(queue, r.id, "queued");
  if (get(queue, r.id).state === "queued") {
    transition(queue, r.id, "requested", { requestedAt: now });
  }
  transition(queue, r.id, "ready", {
    expectedFiles: r.expectedFiles ?? null,
    setBranch: r.setBranch ?? null,
    chosenSets: r.chosen ?? null,
    fidelity: r.fidelity ?? null,
    zips: (r.zips || []).map((z) => ({ filename: z.name, size: z.size })),
  });

  const parts = (r.zips || []).length;
  const fid = r.fidelity === "existing-unknown" ? "  ⚠ fidelity unknown — dimension check is mandatory" : "";
  console.log(`→  ${r.slug} — ready · ${parts} part(s) · expect ${r.expectedFiles ?? "?"} files · sets=${r.setBranch}${fid}`);
  advanced++;
}

await save(queue);
console.log(`\n${advanced} ready · ${failed} failed · ${skipped} skipped`);

// The whole point of the 7-day window: never request more than can be drained.
const waiting = Object.values(queue.collections).filter((c) => c.state === "ready" || c.state === "requested").length;
if (waiting) console.log(`${waiting} collection(s) now holding a link that dies in 7 days — download them before then.`);
