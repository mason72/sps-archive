// Does the SPS pull progress fold survive concurrent flushes? (lesson 161)
//
// WHY THIS EXISTS. `importSlice` flushes progress from six concurrent workers.
// The fold used to read the job row, add in JS and write back, so overlapping
// flushes erased each other: Everpure landed 1,090 photos and its job said
// 1,080. Migration 085 replaced it with one atomic increment,
// `sps_pull_add_progress`. This races BOTH shapes against a real row through
// the real client, because a single clean run of a race proves nothing: the
// OLD shape is run on purpose as the control, and must LOSE updates, or this
// probe cannot tell a fix from a quiet afternoon.
//
// It creates one throwaway `sps_pull_jobs` row (status 'failed', a random
// sps_event_id, so no screen or watchdog ever picks it up), and deletes it at
// the end, including on error.
//
//   npx tsx scripts/triage/sps-pull-progress-race.ts
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const FLUSHES = 60;
const PER_FLUSH = 5;

async function main() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Borrow an owner + event from an existing job; the probe row is keyed by a
  // random SPS id, so it shadows nothing.
  const { data: donor, error: donorErr } = await db
    .from("sps_pull_jobs")
    .select("user_id, event_id")
    .limit(1)
    .single();
  if (donorErr || !donor) throw donorErr ?? new Error("no job to borrow from");

  const { data: row, error: insErr } = await db
    .from("sps_pull_jobs")
    .insert({
      user_id: donor.user_id,
      event_id: donor.event_id,
      sps_event_id: randomUUID(),
      sps_event_name: "__progress-race-probe",
      status: "failed",
      error: "triage probe row, safe to delete",
    })
    .select("id")
    .single();
  if (insErr || !row) throw insErr ?? new Error("insert failed");
  const jobId = row.id as string;

  const read = async () => {
    const { data, error } = await db
      .from("sps_pull_jobs")
      .select("images_done")
      .eq("id", jobId)
      .single();
    if (error) throw error;
    return data.images_done as number;
  };
  const reset = async () => {
    const { error } = await db
      .from("sps_pull_jobs")
      .update({ images_done: 0 })
      .eq("id", jobId);
    if (error) throw error;
  };

  try {
    const expected = FLUSHES * PER_FLUSH;

    // Control: the pre-085 read-modify-write fold.
    await reset();
    await Promise.all(
      Array.from({ length: FLUSHES }, async () => {
        const current = await read();
        const { error } = await db
          .from("sps_pull_jobs")
          .update({ images_done: current + PER_FLUSH })
          .eq("id", jobId);
        if (error) throw error;
      })
    );
    const oldShape = await read();

    // The fix.
    await reset();
    await Promise.all(
      Array.from({ length: FLUSHES }, async () => {
        const { data, error } = await db.rpc("sps_pull_add_progress", {
          p_job_id: jobId,
          p_done: PER_FLUSH,
          p_failed: 0,
          p_skipped: 0,
          p_bytes: 0,
          p_confirmed: 0,
        });
        if (error) throw error;
        if (!data) throw new Error("rpc reported no row");
      })
    );
    const newShape = await read();

    // And the vanished-row signal the caller relies on.
    const { data: missing, error: missErr } = await db.rpc(
      "sps_pull_add_progress",
      {
        p_job_id: randomUUID(),
        p_done: 1,
        p_failed: 0,
        p_skipped: 0,
        p_bytes: 0,
        p_confirmed: 0,
      }
    );
    if (missErr) throw missErr;

    console.log(`  ${FLUSHES} concurrent flushes of ${PER_FLUSH} — expected ${expected}`);
    console.log(`  read-modify-write (control): ${oldShape}  ${oldShape < expected ? "LOST UPDATES (expected — control works)" : "no loss this run — control did not fire, result below proves nothing"}`);
    console.log(`  sps_pull_add_progress:       ${newShape}  ${newShape === expected ? "OK" : "WRONG"}`);
    console.log(`  missing job returns:         ${JSON.stringify(missing)}  ${missing === null ? "OK" : "WRONG"}`);
    if (newShape !== expected || missing !== null || oldShape >= expected) {
      process.exitCode = 1;
    }
  } finally {
    const { error } = await db.from("sps_pull_jobs").delete().eq("id", jobId);
    if (error) console.error("  ⚠️ probe row NOT deleted:", jobId, error.message);
    else console.log("  probe row deleted");
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
