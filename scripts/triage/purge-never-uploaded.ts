/**
 * Delete rows whose stored object is NOT the file the row claims to be AND
 * whose real bytes exist nowhere in R2 — i.e. files the shifted-bytes bug never
 * actually sent (the tail of each 50-file presign chunk).
 *
 * These rows MUST go before the photographer re-drops the files: they record
 * the correct original_filename and the correct file_size, so the (name, size)
 * duplicate guard in /api/upload would match them and silently skip the
 * re-upload. Nothing would happen, and it would look like it worked.
 *
 * Refuses to touch any row whose bytes could still be recovered by
 * repair-shifted-bytes.ts — run that first.
 *
 * Usage: npx tsx scripts/triage/purge-never-uploaded.ts <eventId> [--apply]
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const eventId = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!eventId) {
    console.error("usage: purge-never-uploaded.ts <eventId> [--apply]");
    process.exit(1);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const { S3Client, HeadObjectCommand } = await import("@aws-sdk/client-s3");
  const { deleteImageAssets } = await import("../../src/lib/r2/client");

  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const R2 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  const BUCKET = process.env.R2_BUCKET_NAME!;

  const rows: {
    id: string;
    original_filename: string;
    file_size: number | null;
    r2_key: string;
    media_type: string | null;
  }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await s
      .from("images")
      .select("id, original_filename, file_size, r2_key, media_type")
      .eq("event_id", eventId)
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < 1000) break;
  }

  const actualByKey = new Map<string, number>();
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 24 }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= rows.length) return;
        try {
          const head = await R2.send(
            new HeadObjectCommand({ Bucket: BUCKET, Key: rows[i].r2_key })
          );
          if (head.ContentLength != null)
            actualByKey.set(rows[i].r2_key, head.ContentLength);
        } catch {
          /* missing */
        }
      }
    })
  );

  const actualSizes = new Set(actualByKey.values());
  const doomed = rows.filter(
    (r) =>
      r.file_size != null &&
      actualByKey.get(r.r2_key) !== r.file_size &&
      // Guard: if ANY object still carries this row's true size, the row is
      // repairable and must not be deleted. Run the repair first.
      !actualSizes.has(r.file_size)
  );
  const repairableLeft = rows.filter(
    (r) =>
      r.file_size != null &&
      actualByKey.get(r.r2_key) !== r.file_size &&
      actualSizes.has(r.file_size)
  );

  console.log(`${apply ? "APPLY" : "DRY RUN"} — ${rows.length} rows`);
  console.log(`to delete (never uploaded): ${doomed.length}`);
  console.log(`still repairable in place:  ${repairableLeft.length}\n`);

  if (repairableLeft.length) {
    console.error(
      `REFUSING: ${repairableLeft.length} rows can still be repaired from R2.\n` +
        `Run repair-shifted-bytes.ts --apply first.`
    );
    process.exit(1);
  }

  for (const r of doomed.slice(0, 80)) console.log(`  ${r.original_filename}`);
  if (doomed.length > 80) console.log(`  … +${doomed.length - 80} more`);

  if (!apply) {
    console.log(`\nDry run. Re-run with --apply to delete.`);
    return;
  }

  const ids = doomed.map((d) => d.id);

  // Children first, so a partial failure never leaves a dangling reference.
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    for (const table of ["faces", "section_images", "favorites"] as const) {
      const col = table === "faces" ? "image_id" : "image_id";
      const { error } = await s.from(table).delete().in(col, slice);
      // favorites may not reference images in every schema — tolerate absence.
      if (error && table !== "favorites") throw error;
    }
  }

  console.log(`\nDeleting R2 objects…`);
  let done = 0;
  cursor = 0;
  await Promise.all(
    Array.from({ length: 12 }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= doomed.length) return;
        await deleteImageAssets(doomed[i].r2_key, doomed[i].media_type);
        if (++done % 25 === 0) process.stdout.write(`  …${done}/${doomed.length}\n`);
      }
    })
  );

  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await s.from("images").delete().in("id", ids.slice(i, i + 200));
    if (error) throw error;
  }

  console.log(`\nDeleted ${doomed.length} rows and their objects.`);
  console.log(`Justin can now re-drop those files into the event.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
