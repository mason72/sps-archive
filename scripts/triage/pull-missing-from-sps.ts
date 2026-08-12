/**
 * One-off: pull the Island photos that the shifted-bytes bug never uploaded,
 * from the SPS gallery, since the source C1 session isn't being re-dragged.
 *
 * Deliberately mirrors the SPS-pull invariant (tasks/sps-archive-pull-spec.md):
 * BYTES LAND BEFORE THE ROW EXISTS. No presign here, so there is no ghost-tile
 * window at all — an image row is only inserted once its object is durably in
 * R2 and its size verified.
 *
 * Known and accepted (Mason, 2026-08-11): SPS re-encodes on ingest — it serves
 * ~73% of the bytes it recorded at upload — so these 72 are a slightly lighter
 * rendition than the other 1,069, which came from Justin's own export. At 4800px
 * on a headshot that is not detectable, and it beats bothering the photographer.
 * Provenance is recorded on each row so this is never mistaken for an original.
 *
 * Usage: npx tsx scripts/triage/pull-missing-from-sps.ts <pairsFile> [--apply]
 *   pairsFile: lines of "<spsImageId>|<originalFilename>"
 */
import fs from "node:fs";
import { randomUUID } from "node:crypto";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const EVENT_ID = "4ac80a42-88ee-4042-ab56-1d7962e72032";
const SPS_USER = "895b8737-3def-48b2-b50c-5aa576924884";
const SPS_EVENT = "c17498d1-2ce8-4604-8cf9-3f29ec76ac65";
const SPS_BASE = "https://pub-7363d57d2cdd49c1b8651be00522eefa.r2.dev";

/** Justin's alphabetical buckets for this event. */
const SECTIONS: { id: string; from: string; to: string }[] = [
  { id: "f8a31647-b0e4-432e-b796-3bce7582dac8", from: "A", to: "B" },
  { id: "d2b2c108-a835-4946-bb13-b723ecbf1c44", from: "C", to: "H" },
  { id: "3af023df-7205-429f-b278-f866ab3aeb7f", from: "J", to: "L" },
  { id: "87b750db-2621-4abc-883a-33f6a2c9348a", from: "M", to: "T" },
  { id: "1dc3a3eb-a577-4b0f-87d9-7c0ae1a67d7c", from: "V", to: "Z" },
];

function sectionFor(filename: string): string | null {
  const initial = filename.trim().charAt(0).toUpperCase();
  for (const s of SECTIONS) {
    if (initial >= s.from && initial <= s.to) return s.id;
  }
  return null;
}

async function main() {
  const pairsFile = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!pairsFile) {
    console.error("usage: pull-missing-from-sps.ts <pairsFile> [--apply]");
    process.exit(1);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const { S3Client, PutObjectCommand, HeadObjectCommand } = await import(
    "@aws-sdk/client-s3"
  );
  const { buildImageKey } = await import("../../src/lib/r2/client");
  const { parseFilename } = await import("../../src/lib/upload/parse-filename");

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

  const pairs = fs
    .readFileSync(pairsFile, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [spsId, ...rest] = l.split("|");
      return { spsId, filename: rest.join("|") };
    });

  // Never create a second copy: the whole point is that these rows are absent.
  const { data: existing } = await s
    .from("images")
    .select("original_filename")
    .eq("event_id", EVENT_ID)
    .in("original_filename", pairs.map((p) => p.filename));
  const have = new Set((existing ?? []).map((r) => r.original_filename));

  const todo = pairs.filter((p) => !have.has(p.filename));
  const unsectioned = todo.filter((p) => !sectionFor(p.filename));

  console.log(`${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`pairs given:        ${pairs.length}`);
  console.log(`already in archive: ${pairs.length - todo.length}`);
  console.log(`to pull:            ${todo.length}`);
  if (unsectioned.length) {
    console.error(`\nNo section bucket for:`);
    for (const p of unsectioned) console.error(`  ${p.filename}`);
    process.exit(1);
  }

  const bySection = new Map<string, number>();
  for (const p of todo) {
    const sec = sectionFor(p.filename)!;
    bySection.set(sec, (bySection.get(sec) ?? 0) + 1);
  }
  for (const [sec, n] of bySection) {
    const label = SECTIONS.find((x) => x.id === sec)!;
    console.log(`  ${label.from}–${label.to}: ${n}`);
  }

  if (!apply) {
    console.log(`\nDry run. Re-run with --apply.`);
    return;
  }

  // Tail sort_order per section, so imports append rather than collide.
  const nextSort = new Map<string, number>();
  for (const sec of new Set(todo.map((p) => sectionFor(p.filename)!))) {
    const { data: tail } = await s
      .from("section_images")
      .select("sort_order")
      .eq("section_id", sec)
      .order("sort_order", { ascending: false })
      .limit(1);
    nextSort.set(sec, (tail?.[0]?.sort_order ?? -1) + 1);
  }

  let ok = 0;
  const failed: string[] = [];

  for (const p of todo) {
    try {
      const url = `${SPS_BASE}/${SPS_USER}/${SPS_EVENT}/${p.spsId}/original.jpg`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`SPS fetch ${res.status}`);
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length < 1024) throw new Error(`suspiciously small: ${body.length}B`);

      const id = randomUUID();
      const parsed = parseFilename(p.filename);
      const uniqueFilename = `${id}.${parsed.extension}`;
      const r2Key = buildImageKey(EVENT_ID, uniqueFilename);

      // BYTES FIRST — the row must never exist without its object.
      await R2.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: r2Key,
          Body: body,
          ContentType: "image/jpeg",
        })
      );
      const head = await R2.send(
        new HeadObjectCommand({ Bucket: BUCKET, Key: r2Key })
      );
      if (head.ContentLength !== body.length) {
        throw new Error(`R2 verify failed: ${head.ContentLength} != ${body.length}`);
      }

      const { error: insErr } = await s.from("images").insert({
        id,
        event_id: EVENT_ID,
        filename: uniqueFilename,
        original_filename: p.filename,
        r2_key: r2Key,
        file_size: body.length,
        mime_type: "image/jpeg",
        media_type: "image",
        parsed_name: parsed.name,
        processing_status: "complete",
        // Provenance: this rendition came from SPS, not the photographer's
        // export, so it is never mistaken for an original later.
        sps_image_id: p.spsId,
        sps_quality: "lossy",
        sps_pulled_at: new Date().toISOString(),
      });
      if (insErr) throw insErr;

      const sec = sectionFor(p.filename)!;
      const sort = nextSort.get(sec)!;
      nextSort.set(sec, sort + 1);
      const { error: linkErr } = await s
        .from("section_images")
        .insert({ section_id: sec, image_id: id, sort_order: sort });
      if (linkErr) throw linkErr;

      ok++;
      if (ok % 10 === 0) console.log(`  …${ok}/${todo.length}`);
    } catch (e) {
      failed.push(`${p.filename}: ${(e as Error).message}`);
    }
  }

  console.log(`\npulled: ${ok}`);
  console.log(`failed: ${failed.length}`);
  for (const f of failed) console.log(`  ${f}`);
  console.log(`\nNext: regen-thumbnails.ts then backfill-ai-index.ts --event`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
