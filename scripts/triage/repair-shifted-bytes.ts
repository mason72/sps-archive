/**
 * Repair a gallery corrupted by the shifted-bytes upload bug (pre-bf570cc).
 *
 * The corruption is a PERMUTATION: row N holds row N-1's bytes. So the correct
 * object for a row already exists in R2 — under a neighbour's key. A row is
 * repairable when exactly one stored object has that row's recorded file_size
 * (images.file_size was written at presign from the correct file, before any
 * bytes moved, so it is the trustworthy side).
 *
 * Because it is a permutation, a source object is usually ALSO some other row's
 * destination — copying straight into place would clobber a source before it is
 * read. So every move is staged: source -> staging, then staging -> destination.
 *
 * Derived data (thumbnails, embeddings, faces, focal points, dimensions) was
 * computed from the WRONG bytes, so it is cleared for every repaired row and
 * left to regenerate.
 *
 * Usage:
 *   npx tsx scripts/triage/repair-shifted-bytes.ts <eventId>            # dry run
 *   npx tsx scripts/triage/repair-shifted-bytes.ts <eventId> --apply    # write
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

type Row = {
  id: string;
  original_filename: string;
  file_size: number | null;
  r2_key: string;
};

async function main() {
  const eventId = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!eventId) {
    console.error("usage: repair-shifted-bytes.ts <eventId> [--apply]");
    process.exit(1);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const { S3Client, HeadObjectCommand, CopyObjectCommand, DeleteObjectCommand } =
    await import("@aws-sdk/client-s3");

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

  const { data: ev } = await s
    .from("events")
    .select("id, name")
    .eq("id", eventId)
    .single();
  if (!ev) throw new Error("event not found");
  console.log(`${apply ? "APPLY" : "DRY RUN"} — ${ev.name}\n`);

  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await s
      .from("images")
      .select("id, original_filename, file_size, r2_key")
      .eq("event_id", eventId)
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }

  // ── Read the true size of every stored object ────────────────────────────
  const actualByKey = new Map<string, number>();
  {
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
            /* object missing */
          }
        }
      })
    );
  }

  const keysByActualSize = new Map<number, string[]>();
  for (const [key, size] of actualByKey) {
    const list = keysByActualSize.get(size) ?? [];
    list.push(key);
    keysByActualSize.set(size, list);
  }
  const filenameByKey = new Map(rows.map((r) => [r.r2_key, r.original_filename]));
  /** What each key's row CLAIMS its size is (vs actualByKey: what R2 holds). */
  const sizeByKey = new Map(
    rows.filter((r) => r.file_size != null).map((r) => [r.r2_key, r.file_size!])
  );

  const moves: { row: Row; from: string; staging: string }[] = [];
  const ambiguous: Row[] = [];
  const unrecoverable: Row[] = [];
  let correct = 0;

  for (const r of rows) {
    if (r.file_size == null) continue;
    if (actualByKey.get(r.r2_key) === r.file_size) {
      correct++;
      continue;
    }
    const candidates = keysByActualSize.get(r.file_size) ?? [];
    // A legitimate source is ALWAYS itself a corrupted row: under the shift,
    // row X's bytes land under the key of some other row Z, and Z is therefore
    // holding X's bytes rather than its own. A row that already holds its own
    // bytes is nobody's source — so a "match" against one is a size
    // coincidence between two different photos, and copying it would file a
    // stranger's picture under this name. Exactly the bug we are repairing.
    const usable = candidates.filter(
      (k) => actualByKey.get(k) !== sizeByKey.get(k)
    );
    if (usable.length === 1) {
      moves.push({
        row: r,
        from: usable[0],
        staging: `repair-staging/${eventId}/${r.id}`,
      });
    } else if (usable.length > 1) ambiguous.push(r);
    else unrecoverable.push(r);
  }

  console.log(`rows:                       ${rows.length}`);
  console.log(`already correct:            ${correct}`);
  console.log(`planned moves:              ${moves.length}`);
  console.log(`ambiguous (size collision): ${ambiguous.length}`);
  console.log(`bytes nowhere in R2:        ${unrecoverable.length}  <- need re-upload\n`);

  console.log("first 25 planned moves (bytes currently under LEFT belong to RIGHT):");
  for (const m of moves.slice(0, 25)) {
    console.log(
      `  ${(filenameByKey.get(m.from) ?? m.from).padEnd(42)} -> ${m.row.original_filename}`
    );
  }
  if (moves.length > 25) console.log(`  … +${moves.length - 25} more`);

  if (ambiguous.length) {
    console.log(`\nambiguous (two objects share this size — repair by hand or re-upload):`);
    for (const r of ambiguous) console.log(`  ${r.original_filename}`);
  }

  if (!apply) {
    console.log(`\nDry run only. Re-run with --apply to perform the repair.`);
    return;
  }

  // ── Phase 1: source -> staging ───────────────────────────────────────────
  console.log(`\nPhase 1/5 — staging ${moves.length} objects…`);
  await pool(moves, 16, async (m) => {
    await R2.send(
      new CopyObjectCommand({
        Bucket: BUCKET,
        CopySource: `${BUCKET}/${encodeURIComponent(m.from).replace(/%2F/g, "/")}`,
        Key: m.staging,
      })
    );
  });

  // ── Phase 2: staging -> destination ──────────────────────────────────────
  console.log(`Phase 2/5 — writing into place…`);
  await pool(moves, 16, async (m) => {
    await R2.send(
      new CopyObjectCommand({
        Bucket: BUCKET,
        CopySource: `${BUCKET}/${encodeURIComponent(m.staging).replace(/%2F/g, "/")}`,
        Key: m.row.r2_key,
      })
    );
  });

  // ── Phase 3: verify every destination now matches its row ────────────────
  console.log(`Phase 3/5 — verifying…`);
  const stillWrong: string[] = [];
  await pool(moves, 24, async (m) => {
    const head = await R2.send(
      new HeadObjectCommand({ Bucket: BUCKET, Key: m.row.r2_key })
    );
    if (head.ContentLength !== m.row.file_size)
      stillWrong.push(m.row.original_filename);
  });
  if (stillWrong.length) {
    console.error(
      `\nABORTING before DB changes — ${stillWrong.length} objects did not verify:`
    );
    for (const n of stillWrong.slice(0, 20)) console.error(`  ${n}`);
    console.error(`Staging objects left in place for inspection.`);
    process.exit(1);
  }
  console.log(`  all ${moves.length} verified`);

  // ── Phase 4: clear everything derived from the wrong bytes ───────────────
  console.log(`Phase 4/5 — clearing derived data (thumbs, embeddings, faces)…`);
  const repairedIds = moves.map((m) => m.row.id);

  // Stale thumbnail renditions must go, or the gallery keeps serving the old
  // (wrong) picture from the cached variant rather than the corrected original.
  const { getThumbnailKey } = await import("../../src/lib/r2/client");
  await pool(moves, 16, async (m) => {
    for (const variant of ["thumb-sm", "thumb-md", "thumb-lg"] as const) {
      try {
        await R2.send(
          new DeleteObjectCommand({
            Bucket: BUCKET,
            Key: getThumbnailKey(m.row.r2_key, variant),
          })
        );
      } catch {
        /* absent is fine */
      }
    }
  });

  for (let i = 0; i < repairedIds.length; i += 200) {
    const slice = repairedIds.slice(i, i + 200);
    const { error: delFaces } = await s.from("faces").delete().in("image_id", slice);
    if (delFaces) throw delFaces;
    const { error: updErr } = await s
      .from("images")
      .update({
        // AI: ai_indexed_at NULL is the "not done" marker the indexer selects on.
        ai_indexed_at: null,
        siglip_embedding: null,
        embedding_model: null,
        aesthetic_score: null,
        // Geometry + capture metadata came from the neighbouring file.
        width: null,
        height: null,
        focal_x: null,
        focal_y: null,
        thumbnail_generated: false,
        thumb_bytes: null,
      })
      .in("id", slice);
    if (updErr) throw updErr;
  }

  // ── Phase 5: drop staging ────────────────────────────────────────────────
  console.log(`Phase 5/5 — removing staging copies…`);
  await pool(moves, 16, async (m) => {
    try {
      await R2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: m.staging }));
    } catch {
      /* best effort */
    }
  });

  console.log(`\nRepaired ${moves.length} images.`);
  console.log(`Still need a re-upload from source: ${unrecoverable.length + ambiguous.length}`);
  console.log(`\nNext: regenerate thumbnails and re-run AI indexing for this event.`);
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let cursor = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        await fn(items[i]);
        if (++done % 250 === 0) process.stdout.write(`  …${done}/${items.length}\n`);
      }
    })
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
