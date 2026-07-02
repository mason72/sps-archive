/**
 * Live E2E driver for the background ZIP builder (one-off verification).
 *
 * Inserts a real zip_jobs row scoped to one section of the College Board
 * share, runs the EXACT production build (buildShareZip → archiver → R2
 * multipart), verifies the job row went ready, downloads the built object
 * via a presigned URL, checks the ZIP central directory is intact, then
 * deletes the object and the row.
 *
 *   npx tsx scripts/verify-zip-job.ts
 */
import fs from "node:fs";
import { execSync } from "node:child_process";

// Load .env.local before importing anything that reads process.env.
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const { createServiceClient } = await import("@/lib/supabase/server");
  const { buildShareZip } = await import("@/lib/zip/build-share-zip");
  const { getPresignedDownloadUrl, deleteFromR2 } = await import("@/lib/r2/client");

  const supabase = createServiceClient();

  // College Board share + its Highlights section (60 photos, ~150MB).
  const SHARE_ID = "10cdeae4-c2fe-463b-ad2d-792ab5392380";
  const SECTION_ID = "62897b6e-093b-4645-a979-7a899adb763d";

  const { data: job, error } = await supabase
    .from("zip_jobs")
    .insert({
      share_id: SHARE_ID,
      scope: { section: SECTION_ID },
      scope_key: "verify-zip-job-e2e",
      zip_filename: "verify-zip-job.zip",
    })
    .select()
    .single();
  if (error || !job) throw new Error(`insert failed: ${error?.message}`);
  console.log(`job inserted: ${job.id}`);

  // Watch progress ticks while the build runs (images_done should move).
  const progressSeen: number[] = [];
  const watcher = setInterval(async () => {
    const { data } = await supabase
      .from("zip_jobs")
      .select("images_done, image_count, status")
      .eq("id", job.id)
      .single();
    if (data && data.images_done > 0 && data.status === "building") {
      progressSeen.push(data.images_done);
      console.log(`  progress: ${data.images_done}/${data.image_count}`);
    }
  }, 2000);

  const t0 = Date.now();
  const result = await buildShareZip(job.id);
  clearInterval(watcher);
  console.log(
    `build finished in ${((Date.now() - t0) / 1000).toFixed(1)}s:`,
    result
  );
  if (progressSeen.length === 0) {
    console.warn("  (no intermediate progress observed — build may be too fast)");
  }

  const { data: after } = await supabase
    .from("zip_jobs")
    .select("*")
    .eq("id", job.id)
    .single();
  if (after?.status !== "ready" || !after.r2_key) {
    throw new Error(`job not ready: ${JSON.stringify(after)}`);
  }
  console.log(
    `job ready: ${after.image_count} images, ${(
      (after.size_bytes ?? 0) / 1e6
    ).toFixed(1)}MB, key=${after.r2_key}, expires=${after.expires_at}`
  );

  const url = await getPresignedDownloadUrl(after.r2_key, 600, after.zip_filename);
  const tmp = "/tmp/verify-zip-job.zip";
  execSync(`curl -s -o ${tmp} "${url}"`, { stdio: "inherit" });
  execSync(`unzip -t ${tmp} > /dev/null`, { stdio: "inherit" });
  const entries = execSync(`unzip -l ${tmp} | tail -1`).toString().trim();
  console.log(`downloaded ZIP verified: ${entries}`);

  // Cleanup
  await deleteFromR2(after.r2_key);
  await supabase.from("zip_jobs").delete().eq("id", job.id);
  fs.unlinkSync(tmp);
  console.log("cleaned up (R2 object, job row, temp file). PASS");
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
