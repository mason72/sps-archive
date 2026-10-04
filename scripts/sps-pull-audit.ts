/**
 * What is a finished SPS import missing? Read-only unless `--store`.
 *
 * Imports since 2026-10-04 answer this themselves: the lane's closing sweep
 * stores `sps_pull_jobs.missing` (see src/lib/sps-integration/pull-sweep.ts).
 * This script is for the jobs that finished BEFORE that, which have no stored
 * answer, and for checking any job by hand.
 *
 * It walks SPS's manifest (one request per 500 photos) and compares it with the
 * rows in the event, using the same function the sweep uses.
 *
 * ⚠️ On an old job the comparison alone OVER-reports, and that is why this is a
 * script with a person reading it rather than a button. A gallery is curated
 * after it is imported: eBay RCG MiniCon is 95 photos under its manifest
 * because they were moved into private galleries. So absent photos are split:
 *
 *   failed   — absent AND named in the job's failure log. The import's fault.
 *   removed  — absent with no failure on record. Removed here since, or added
 *              on SPS since. NOT the import's fault, and never stored.
 *
 * `--store` writes only the `failed` group to `missing`, only on a completed
 * job, and only when nothing is stored yet (it never overwrites the lane's own
 * record). The import screen then offers "Retry N photos" for exactly those.
 *
 *   npx tsx scripts/sps-pull-audit.ts <jobId> [--store]
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const jobId = process.argv[2];
  const store = process.argv.includes("--store");
  if (!jobId || jobId.startsWith("--")) {
    console.error("usage: npx tsx scripts/sps-pull-audit.ts <jobId> [--store]");
    process.exit(1);
  }

  const { createServiceClient } = await import("../src/lib/supabase/server");
  const { loadPullJob } = await import("../src/lib/sps-integration/pull-event");
  const { findAbsentOnPage, missingAsJson, readFailureLog, readMissing } = await import(
    "../src/lib/sps-integration/pull-sweep"
  );

  const supabase = createServiceClient();
  const job = await loadPullJob(supabase, jobId);
  if (!job) {
    console.error(`No pull job ${jobId}`);
    process.exit(1);
  }

  const { data: extra, error: extraErr } = await supabase
    .from("sps_pull_jobs")
    .select("sps_event_name, failures")
    .eq("id", jobId)
    .maybeSingle();
  if (extraErr) throw extraErr;

  const logged = new Set(readFailureLog(extra?.failures).map((f) => f.spsImageId));
  // The log was capped at 50 entries until 2026-10-04. A full one from before
  // then may be missing failures, and those would be misfiled as "removed".
  const logMayBeCut = Array.isArray(extra?.failures) && extra!.failures.length === 50;

  console.log(`\n${extra?.sps_event_name ?? job.event_id}  (job ${job.id}, ${job.status})`);
  console.log(
    `expected ${job.expected_total ?? "?"} · counter done ${job.images_done}, failed ${job.images_failed} · ` +
      `${(job.deselected ?? []).length} deselected · ${logged.size} in the failure log`
  );

  let onManifest = 0;
  let pages = 0;
  const absent: { id: string; filename: string }[] = [];
  for (let offset = 0; ; ) {
    const page = await findAbsentOnPage(supabase, job, offset, { watch: null, fetch: null, skip: [] });
    pages++;
    onManifest += page.candidates.length;
    for (const img of page.absent) {
      absent.push({ id: img.id, filename: img.originalFilename });
    }
    if (page.nextOffset === null) break;
    offset = page.nextOffset;
  }

  const failed = absent.filter((a) => logged.has(a.id));
  const removed = absent.filter((a) => !logged.has(a.id));
  const landedSince = logged.size - failed.length;

  console.log(
    `\nmanifest: ${onManifest} photos to bring over (${pages} page${pages === 1 ? "" : "s"} read), ` +
      `${onManifest - absent.length} here, ${absent.length} absent`
  );
  console.log(`  failed  (absent, in the failure log): ${failed.length}`);
  for (const f of failed) console.log(`    ${f.filename}  ${f.id}`);
  console.log(`  removed (absent, no failure on record): ${removed.length}`);
  for (const r of removed.slice(0, 10)) console.log(`    ${r.filename}  ${r.id}`);
  if (removed.length > 10) console.log(`    … and ${removed.length - 10} more`);
  if (logged.size) {
    console.log(`  logged as failed but in the gallery now: ${landedSince}`);
  }
  if (logMayBeCut) {
    console.log(
      "  ⚠️ the failure log holds exactly 50 entries, its old cap: some of the 'removed' group may be failures it had no room for."
    );
  }

  const stored = readMissing(job.missing);
  if (stored) {
    console.log(`\nstored on the job already: ${stored.length} missing`);
  }

  if (!store) {
    console.log("\nRead-only. Pass --store to record the `failed` group on the job.");
    return;
  }
  if (job.status !== "completed") {
    console.error(`\nNot stored: the job is ${job.status}, not completed.`);
    process.exit(1);
  }
  if (stored) {
    console.error("\nNot stored: the job already has a record, and this never overwrites one.");
    process.exit(1);
  }

  if (!failed.length) {
    // An empty list is a CLAIM ("checked, every photo is here") and the screen
    // prints it. This script cannot make that claim for an old job: it cannot
    // tell a removed photo from one the walk never reached.
    console.error("\nNot stored: no absent photo has a failure on record, so there is nothing to retry.");
    process.exit(1);
  }

  const missing = failed.map((f) => ({
    spsImageId: f.id,
    filename: f.filename,
    // The old log's reasons were the useless "[object Object]"; say what is
    // actually known instead.
    reason: "Failed during the import",
  }));
  const { data: written, error: writeErr } = await supabase
    .from("sps_pull_jobs")
    .update({ missing: missingAsJson(missing) })
    .eq("id", jobId)
    .eq("status", "completed")
    .is("missing", null)
    .select("id, missing_count")
    .maybeSingle();
  if (writeErr) throw writeErr;
  if (!written) {
    console.error("\nNot stored: the job changed underneath this run.");
    process.exit(1);
  }
  console.log(`\nStored: missing_count = ${written.missing_count}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
