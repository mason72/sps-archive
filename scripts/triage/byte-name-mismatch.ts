/**
 * Detect rows whose R2 object is NOT the file the row claims to be.
 *
 * The presign route writes `images.file_size` from the client's File metadata
 * for the CORRECT file. The client then PUTs bytes chosen from a separate,
 * UNFILTERED array. If those two ever disagree, the row's recorded size and the
 * stored object's real Content-Length diverge — a check that shares no
 * assumption with the code it is checking.
 *
 * Usage: npx tsx scripts/triage/byte-name-mismatch.ts <eventNameFragment> [limit]
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const frag = process.argv[2] ?? "Island";
  const limit = Number(process.argv[3] ?? 0);

  const { createClient } = await import("@supabase/supabase-js");
  const { S3Client, HeadObjectCommand } = await import("@aws-sdk/client-s3");

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

  const { data: events, error: evErr } = await s
    .from("events")
    .select("id, name, created_at")
    .ilike("name", `%${frag}%`)
    .order("created_at", { ascending: false });
  if (evErr) throw evErr;
  if (!events?.length) {
    console.log(`No event matching "${frag}"`);
    return;
  }
  console.log("Events:", events.map((e) => `${e.name} (${e.id})`).join("\n         "));
  const event = events[0];
  console.log(`\nProbing: ${event.name}  ${event.id}\n`);

  // Page through every image row.
  const rows: {
    id: string;
    original_filename: string;
    file_size: number | null;
    r2_key: string;
    created_at: string;
  }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await s
      .from("images")
      .select("id, original_filename, file_size, r2_key, created_at")
      .eq("event_id", event.id)
      .order("created_at", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  console.log(`${rows.length} image rows\n`);

  const targets = limit ? rows.slice(0, limit) : rows;

  // Size index: which OTHER row in this event has the size we actually found?
  const bySize = new Map<number, string[]>();
  for (const r of rows) {
    if (r.file_size == null) continue;
    const list = bySize.get(r.file_size) ?? [];
    list.push(r.original_filename);
    bySize.set(r.file_size, list);
  }

  let checked = 0;
  let missing = 0;
  let match = 0;
  const mismatches: {
    filename: string;
    rowSize: number;
    actualSize: number;
    looksLike: string[];
  }[] = [];

  const CONCURRENCY = 24;
  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= targets.length) return;
      const r = targets[i];
      try {
        const head = await R2.send(
          new HeadObjectCommand({ Bucket: BUCKET, Key: r.r2_key })
        );
        checked++;
        const actual = head.ContentLength ?? -1;
        if (r.file_size == null) return;
        if (actual === r.file_size) {
          match++;
        } else {
          mismatches.push({
            filename: r.original_filename,
            rowSize: r.file_size,
            actualSize: actual,
            looksLike: bySize.get(actual) ?? [],
          });
        }
      } catch {
        missing++;
      }
      if (checked % 250 === 0) process.stdout.write(`  …${checked}\n`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`\nchecked:   ${checked}`);
  console.log(`size match: ${match}`);
  console.log(`MISMATCH:   ${mismatches.length}`);
  console.log(`no object:  ${missing}\n`);

  mismatches.sort((a, b) => a.filename.localeCompare(b.filename));
  for (const m of mismatches.slice(0, 60)) {
    console.log(
      `${m.filename}\n   row says ${m.rowSize}  · R2 holds ${m.actualSize}  → bytes belong to: ${
        m.looksLike.join(", ") || "(not a file in this event)"
      }`
    );
  }
  if (mismatches.length > 60) console.log(`… +${mismatches.length - 60} more`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
