/**
 * Upload a folder of photos on disk into ONE named section of an existing event.
 *
 *   npx tsx scripts/upload-folder-to-section.ts <eventId> <folder> --section "Prints"            # DRY RUN
 *   npx tsx scripts/upload-folder-to-section.ts <eventId> <folder> --section "Prints" --apply    # writes to PRODUCTION
 *     --list <file>             only the filenames in this file (one per line), else every JPEG in <folder>
 *     --event-key-file <file>   a `vercel env pull` file; ONLY its INNGEST_EVENT_KEY is read (see below)
 *
 * Written 2026-10-24 for F1 Cash App: the booth uploads FRAMED exports to SPS, so
 * the clean prints exist only in Dropbox (`Output/Prints`) under the SAME
 * filenames as the framed set (memory: booth-overlay-baked-before-upload). The
 * browser upload works for that, but a 0.9 GB folder of online-only Dropbox
 * placeholders is a poor fit for a drag-and-drop, and `pixieset-ingest.ts`
 * cannot do it: it dedupes by filename alone and would skip every print.
 *
 * Same writes as a browser upload, in the ingest's safer order:
 *   bytes to R2 → images row → section link → thumbnails → complete → EXIF
 * (bytes land before the row, so there is no ghost-tile window), and EXIF is a
 * separate write so a bad camera value can never strand a photo at `pending`.
 *
 * Dedupe is the upload route's, not the ingest's: identity is
 * (original_filename, file_size) within the EVENT, and the outcome depends on
 * the SECTION (memory: upload-dedupe-is-section-scoped):
 *   fresh     → upload
 *   linked    → already in the event, not in this section → add the link only
 *   duplicate → already in this section → skip
 * So a re-run is idempotent, and a print that shares a name with its framed twin
 * still uploads, because the bytes differ in size.
 *
 * Settlement (AI indexing + focal points) is one Inngest send each. `.env.local`
 * has no INNGEST_EVENT_KEY, so from a laptop the send fails with a 401 and this
 * script SAYS so rather than printing "sent". The `ai-index-sweep` cron catches
 * the indexing within 30 minutes regardless; focal points have no sweep, which
 * is what `--event-key-file` is for. Pull it with `umask 077; vercel env pull
 * <scratch file> --environment production`, pass the path, and delete the file
 * afterwards: it holds every production secret, and only the one key is read.
 *
 * ⚠️ `.env.local` points at PRODUCTION Supabase and R2. There is no dev database.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const APPLY = args.includes("--apply");
const VALUE_FLAGS = new Set(["--section", "--list", "--event-key-file"]);
const positional = args.filter((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(args[i - 1]));
const [EVENT_ID, FOLDER] = positional;
const SECTION_NAME = flag("section");
const LIST_FILE = flag("list");
const EVENT_KEY_FILE = flag("event-key-file");
const JPEG = /\.jpe?g$/i;

const n = (x: number) => x.toLocaleString("en-US");
const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;

/** A `fetch` whose every call aborts after `ms` — one dead socket must not hang the run. */
function fetchWithDeadline(ms: number): typeof fetch {
  return (input, init) => {
    const deadline = AbortSignal.timeout(ms);
    const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
    return fetch(input, { ...init, signal });
  };
}

function pgMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

async function main() {
  if (!EVENT_ID || !FOLDER || !SECTION_NAME) {
    console.error('usage: upload-folder-to-section.ts <eventId> <folder> --section "<name>" [--list <file>] [--apply]');
    process.exit(1);
  }

  const { createServiceClient } = await import("../src/lib/supabase/server");
  const { buildImageKey, uploadToR2, deleteFromR2, getPresignedDownloadUrl } = await import("../src/lib/r2/client");
  const { generateThumbnailsFromBuffer } = await import("../src/lib/thumbnails/generate");
  const { parseFilename, extractExif } = await import("../src/lib/upload/parse-filename");

  const supabase = createServiceClient({ global: { fetch: fetchWithDeadline(90_000) } });

  // ── what to upload ──
  const names = (LIST_FILE
    ? fs.readFileSync(LIST_FILE, "utf8").split("\n").map((l) => l.trim()).filter(Boolean)
    : fs.readdirSync(FOLDER).filter((f) => JPEG.test(f))
  ).sort();
  const files = names.map((name) => {
    const full = path.join(FOLDER, name);
    if (!fs.existsSync(full)) throw new Error(`listed file is missing: ${full}`);
    return { name, full, size: fs.statSync(full).size };
  });
  const nonJpeg = files.filter((f) => !JPEG.test(f.name));
  if (nonJpeg.length) throw new Error(`not a JPEG name: ${nonJpeg.map((f) => f.name).join(", ")}`);

  // ── the event and the section ──
  const { data: event, error: evErr } = await supabase
    .from("events").select("id, name, user_id").eq("id", EVENT_ID).maybeSingle();
  if (evErr) throw evErr;
  if (!event) throw new Error(`no event ${EVENT_ID}`);

  const { data: sections, error: secErr } = await supabase
    .from("sections").select("id, name, sort_order, locked").eq("event_id", EVENT_ID);
  if (secErr) throw secErr;
  const existingSection = (sections ?? []).find((s) => s.name.toLowerCase() === SECTION_NAME.toLowerCase());
  if (existingSection?.locked) throw new Error(`section "${existingSection.name}" is locked`);

  console.log(`${event.name}  (${event.id})`);
  console.log(APPLY ? "MODE: APPLY — writing to PRODUCTION\n" : "MODE: dry run (pass --apply to write)\n");
  console.log(`folder : ${FOLDER}`);
  console.log(`files  : ${n(files.length)} · ${mb(files.reduce((a, f) => a + f.size, 0))}`);
  console.log(`section: "${SECTION_NAME}" ${existingSection ? `(existing ${existingSection.id})` : "(will be created, last)"}`);

  // ── what the event already holds: paged and ordered, or it silently truncates at 1,000 ──
  const byKey = new Map<string, string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data: rows, error } = await supabase
      .from("images").select("id, original_filename, file_size")
      .eq("event_id", EVENT_ID).order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw error;
    for (const r of rows ?? []) {
      if (r.original_filename && r.file_size != null) byKey.set(`${r.original_filename}|${r.file_size}`, r.id);
    }
    if (!rows || rows.length < PAGE) break;
  }
  const inSection = new Set<string>();
  if (existingSection) {
    for (let from = 0; ; from += PAGE) {
      const { data: links, error } = await supabase
        .from("section_images").select("image_id")
        .eq("section_id", existingSection.id).order("image_id", { ascending: true }).range(from, from + PAGE - 1);
      if (error) throw error;
      for (const l of links ?? []) inSection.add(l.image_id);
      if (!links || links.length < PAGE) break;
    }
  }

  const fresh: typeof files = [];
  const linkable: { file: (typeof files)[number]; imageId: string }[] = [];
  let duplicates = 0;
  for (const f of files) {
    const id = byKey.get(`${f.name}|${f.size}`);
    if (!id) fresh.push(f);
    else if (inSection.has(id)) duplicates++;
    else linkable.push({ file: f, imageId: id });
  }
  console.log(`\nfresh     : ${n(fresh.length)}`);
  console.log(`linked    : ${n(linkable.length)} (already in the event, will join this section)`);
  console.log(`duplicate : ${n(duplicates)} (already in this section, skipped)`);

  if (!APPLY) {
    console.log("\ndry run — nothing was written. First few:");
    for (const f of fresh.slice(0, 5)) console.log(`   ${f.name}  ${mb(f.size)}`);
    return;
  }
  if (!fresh.length && !linkable.length) {
    console.log("\nnothing to do.");
    return;
  }

  // ── everything below writes to production ──
  let sectionId = existingSection?.id;
  if (!sectionId) {
    const nextOrder = Math.max(-1, ...(sections ?? []).map((s) => s.sort_order ?? 0)) + 1;
    const { data: created, error } = await supabase
      .from("sections").insert({ event_id: EVENT_ID, name: SECTION_NAME, sort_order: nextOrder, is_auto: false })
      .select("id").single();
    if (error) throw error;
    sectionId = created.id;
    console.log(`\ncreated section "${SECTION_NAME}" ${sectionId} at position ${nextOrder}`);
  }
  const { data: tail, error: tailErr } = await supabase
    .from("section_images").select("sort_order").eq("section_id", sectionId)
    .order("sort_order", { ascending: false }).limit(1);
  if (tailErr) throw tailErr;
  const sortBase = (tail?.[0]?.sort_order ?? -1) + 1;

  if (linkable.length) {
    const { error } = await supabase.from("section_images").insert(
      linkable.map((l, i) => ({ section_id: sectionId!, image_id: l.imageId, sort_order: sortBase + fresh.length + i }))
    );
    if (error) throw error;
    console.log(`linked ${n(linkable.length)} existing photo(s)`);
  }

  const landed: { id: string; name: string; sha: string }[] = [];
  const failures: { name: string; reason: string }[] = [];
  let bytes = 0;
  let exifSkipped = 0;
  const started = Date.now();

  const importOne = async (f: (typeof fresh)[number], index: number) => {
    try {
      const buffer = fs.readFileSync(f.full);
      if (buffer.byteLength !== f.size) throw new Error(`read ${buffer.byteLength} of ${f.size} bytes`);
      if (buffer[0] !== 0xff || buffer[1] !== 0xd8) throw new Error("not JPEG bytes");

      const id = randomUUID();
      const parsed = parseFilename(f.name);
      const filename = `${id}.${parsed.extension}`;
      const r2Key = buildImageKey(EVENT_ID, filename);

      // ── bytes first ──
      await uploadToR2(r2Key, buffer, "image/jpeg");
      const abandon = async () => {
        try { await deleteFromR2(r2Key); } catch (err) { console.error(`  orphaned R2 object ${r2Key}`, err); }
      };

      const { error: insErr } = await supabase.from("images").insert({
        id,
        event_id: EVENT_ID,
        filename,
        original_filename: f.name,
        r2_key: r2Key,
        file_size: buffer.byteLength,
        mime_type: "image/jpeg",
        media_type: "image",
        parsed_name: parsed.name,
        processing_status: "pending",
      });
      if (insErr) { await abandon(); throw insErr; }

      const { error: linkErr } = await supabase
        .from("section_images").insert({ section_id: sectionId!, image_id: id, sort_order: sortBase + index });
      if (linkErr) {
        await supabase.from("images").delete().eq("id", id);
        await abandon();
        throw linkErr;
      }

      // Display first. A thumbnail failure leaves the photo complete and the grid self-heals.
      const display: Record<string, unknown> = { processing_status: "complete" };
      try {
        const thumbs = await generateThumbnailsFromBuffer(buffer, EVENT_ID, filename);
        display.thumbnail_generated = true;
        display.thumb_bytes = thumbs.thumbBytes;
        if (thumbs.width) display.width = thumbs.width;
        if (thumbs.height) display.height = thumbs.height;
        if (thumbs.dominantColor) display.dominant_color = thumbs.dominantColor;
      } catch (thumbErr) {
        console.error(`  thumbnail failed for ${f.name}:`, thumbErr);
      }
      const { error: updErr } = await supabase.from("images").update(display).eq("id", id);
      if (updErr) throw updErr;

      // Enrichment second, never fatal.
      const exif = await extractExif(
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
      );
      const exifUpdate: Record<string, unknown> = {};
      if (exif?.takenAt) exifUpdate.taken_at = exif.takenAt;
      if (exif?.cameraMake) exifUpdate.camera_make = exif.cameraMake;
      if (exif?.cameraModel) exifUpdate.camera_model = exif.cameraModel;
      if (exif?.lens) exifUpdate.lens = exif.lens;
      if (exif?.focalLength) exifUpdate.focal_length = exif.focalLength;
      if (exif?.aperture) exifUpdate.aperture = exif.aperture;
      if (exif?.shutterSpeed) exifUpdate.shutter_speed = exif.shutterSpeed;
      if (exif?.iso) exifUpdate.iso = exif.iso;
      if (exif?.gpsLat != null) exifUpdate.gps_lat = exif.gpsLat;
      if (exif?.gpsLng != null) exifUpdate.gps_lng = exif.gpsLng;
      if (Object.keys(exifUpdate).length) {
        const { error: exifErr } = await supabase.from("images").update(exifUpdate).eq("id", id);
        if (exifErr) {
          exifSkipped++;
          console.error(`  ⚠ EXIF not stored for ${f.name} (photo is fine): ${pgMessage(exifErr)}`);
        }
      }

      landed.push({ id, name: f.name, sha: createHash("sha256").update(buffer).digest("hex") });
      bytes += buffer.byteLength;
      if (landed.length % 25 === 0 || landed.length === fresh.length) {
        const rate = landed.length / ((Date.now() - started) / 1000);
        console.log(`  ${n(landed.length)} / ${n(fresh.length)} · ${mb(bytes)} · ${rate.toFixed(1)}/s`);
      }
    } catch (err) {
      failures.push({ name: f.name, reason: pgMessage(err) });
      console.error(`  ✗ ${f.name}: ${pgMessage(err)}`);
    }
  };

  const CONCURRENCY = Math.max(1, Number(process.env.UPLOAD_CONCURRENCY ?? 4));
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= fresh.length) return;
      await importOne(fresh[i], i);
    }
  };
  console.log(`\nuploading with ${CONCURRENCY} workers`);
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, fresh.length) }, worker));

  console.log(`\n${n(landed.length)} uploaded · ${n(failures.length)} failed · ${mb(bytes)} in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  if (exifSkipped) console.log(`${n(exifSkipped)} stored without camera metadata (visible and complete).`);
  for (const f of failures.slice(0, 20)) console.log(`   ✗ ${f.name} — ${f.reason}`);

  // ── verify against the DATABASE and R2, not this process's counters ──
  const { count: linkCount, error: lcErr } = await supabase
    .from("section_images").select("image_id", { count: "exact", head: true }).eq("section_id", sectionId!);
  if (lcErr) throw lcErr;
  const ids = landed.map((l) => l.id);
  let ready = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase
      .from("images").select("id").in("id", ids.slice(i, i + 100))
      .eq("processing_status", "complete").eq("thumbnail_generated", true);
    if (error) throw error;
    ready += data?.length ?? 0;
  }
  const sample = landed.filter((_, i) => i % Math.max(1, Math.floor(landed.length / 5)) === 0).slice(0, 5);
  let roundTrips = 0;
  for (const s of sample) {
    const { data: row } = await supabase.from("images").select("r2_key").eq("id", s.id).single();
    const url = await getPresignedDownloadUrl(row!.r2_key, 600);
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    const got = createHash("sha256").update(Buffer.from(await res.arrayBuffer())).digest("hex");
    if (got === s.sha) roundTrips++;
    else console.error(`  ✗ sha256 mismatch on ${s.name}`);
  }
  console.log(
    `verify: section holds ${n(linkCount ?? 0)} · ${n(ready)}/${n(ids.length)} new rows complete with thumbnails · ` +
    `sha256 round-trip ${roundTrips}/${sample.length}`
  );

  // ── settlement: report what actually happened ──
  if (landed.length) {
    if (EVENT_KEY_FILE) {
      const line = fs.readFileSync(EVENT_KEY_FILE, "utf8").split("\n").find((l) => l.startsWith("INNGEST_EVENT_KEY="));
      if (line) process.env.INNGEST_EVENT_KEY = line.slice("INNGEST_EVENT_KEY=".length).replace(/^"|"$/g, "");
    }
    const { inngest } = await import("../src/lib/inngest/client");
    for (const name of ["ai/index.requested", "focal/auto.suggest"] as const) {
      try {
        const res = await inngest.send({ name, data: { eventId: EVENT_ID } });
        console.log(`sent ${name} → ${JSON.stringify(res.ids)}`);
      } catch (err) {
        console.log(
          `NOT sent ${name}: ${pgMessage(err)}` +
          (name === "ai/index.requested" ? " (the ai-index-sweep cron will pick these up within 30 min)" : " (pass --event-key-file)")
        );
      }
    }
  }
  if (failures.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
