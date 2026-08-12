/**
 * Which events took uploads after the shifted-bytes bug shipped (e688083,
 * 2026-08-11 09:52 PT)? Lists every event with images created since, and
 * samples R2 to confirm whether that event is actually corrupted.
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const BUG_SHIPPED = "2026-08-11T16:52:48Z"; // e688083, in UTC

async function main() {
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

  const rows: { event_id: string; id: string; r2_key: string; file_size: number | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await s
      .from("images")
      .select("event_id, id, r2_key, file_size")
      .gte("created_at", BUG_SHIPPED)
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const byEvent = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byEvent.get(r.event_id) ?? [];
    list.push(r);
    byEvent.set(r.event_id, list);
  }

  const { data: events } = await s
    .from("events")
    .select("id, name")
    .in("id", [...byEvent.keys()]);
  const nameOf = new Map((events ?? []).map((e) => [e.id, e.name]));

  console.log(`Images uploaded since ${BUG_SHIPPED}: ${rows.length} across ${byEvent.size} events\n`);

  for (const [eventId, list] of byEvent) {
    // Sample up to 120 rows per event.
    const sample = list.filter((r) => r.file_size != null).slice(0, 120);
    let bad = 0;
    let ok = 0;
    let gone = 0;
    for (const r of sample) {
      try {
        const head = await R2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: r.r2_key }));
        if (head.ContentLength === r.file_size) ok++;
        else bad++;
      } catch {
        gone++;
      }
    }
    const pct = sample.length ? Math.round((bad / sample.length) * 100) : 0;
    console.log(
      `${bad > 0 ? "CORRUPT " : "clean   "} ${String(nameOf.get(eventId) ?? eventId).slice(0, 40).padEnd(42)} ` +
        `rows since bug: ${String(list.length).padStart(5)}  sampled ${sample.length}: ` +
        `${bad} wrong bytes (${pct}%), ${ok} ok, ${gone} missing`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
