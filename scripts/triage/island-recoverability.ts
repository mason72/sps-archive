/**
 * How much of the Island gallery can be repaired in place?
 *
 * The corruption is a permutation, not a deletion: row N holds row N-1's bytes.
 * So for most rows the correct bytes DO exist in R2, under a neighbour's key.
 * The exception is the tail of each 50-file chunk — those files were never sent
 * at all, because the loop ran only as far as the (shorter) slot list.
 *
 * A row is REPAIRABLE if exactly one object in the event has its recorded size.
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const EVENT_ID = "4ac80a42-88ee-4042-ab56-1d7962e72032";

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

  const rows: {
    id: string;
    original_filename: string;
    file_size: number | null;
    r2_key: string;
  }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await s
      .from("images")
      .select("id, original_filename, file_size, r2_key")
      .eq("event_id", EVENT_ID)
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  // Actual size of every stored object.
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
          /* missing object */
        }
      }
    })
  );

  // Which keys hold each actual size?
  const keysByActualSize = new Map<number, string[]>();
  for (const [key, size] of actualByKey) {
    const list = keysByActualSize.get(size) ?? [];
    list.push(key);
    keysByActualSize.set(size, list);
  }

  let correct = 0;
  let repairable = 0;
  let ambiguous = 0;
  let unrecoverable: string[] = [];

  for (const r of rows) {
    if (r.file_size == null) continue;
    const actual = actualByKey.get(r.r2_key);
    if (actual === r.file_size) {
      correct++;
      continue;
    }
    const candidates = keysByActualSize.get(r.file_size) ?? [];
    if (candidates.length === 1) repairable++;
    else if (candidates.length > 1) ambiguous++;
    else unrecoverable.push(r.original_filename);
  }

  console.log(`rows:                        ${rows.length}`);
  console.log(`already correct:             ${correct}`);
  console.log(`repairable (unique match):   ${repairable}`);
  console.log(`ambiguous (size collision):  ${ambiguous}`);
  console.log(`bytes NOWHERE in R2:         ${unrecoverable.length}`);
  if (unrecoverable.length) {
    console.log(`\nnever uploaded — must come from Justin's disk:`);
    for (const n of unrecoverable.sort()) console.log(`  ${n}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
