/**
 * Pixieset → Pixeltrunk ingest: a verified ZIP on disk becomes an archive event.
 *
 *   npx tsx scripts/pixieset-ingest.ts <collectionId>            # DRY RUN (default)
 *   npx tsx scripts/pixieset-ingest.ts <collectionId> --apply    # writes to PRODUCTION
 *   npx tsx scripts/pixieset-ingest.ts --next                    # oldest verified collection
 *   npx tsx scripts/pixieset-ingest.ts <id> --apply --keep-zip   # don't reclaim the disk
 *
 * The last mile of the migration. `queue.mjs` decides what to fetch, `driver.js`
 * fetches it, `watch.mjs` proves the archive is intact and stages it — this turns
 * that staged archive into rows and objects, then reclaims the disk so the next
 * collection has somewhere to land.
 *
 * ── Ordering, which is the whole design ──────────────────────────────────────
 *
 * **Bytes land before the row exists.** Mirrors `sps-integration/pull-event.ts`
 * rather than the browser upload path: the upload path must pre-create a row to
 * presign a URL, and that window is where ghost tiles come from (lessons #21–23,
 * the eBay incident). We already hold the buffer, so we close the window. Every
 * exit path after the upload deletes the object it just wrote. The remaining
 * failure mode — an object with no row — is invisible garbage rather than a
 * broken tile, which is the cheaper of the two.
 *
 * **A photo in two Pixieset sets becomes ONE image linked to TWO sections.**
 * `section_images` is a link table and this is exactly what it models. Storing
 * the bytes twice would double the R2 bill on the every-set branch and give the
 * photographer visible duplicates in "All Images". This is also why the
 * every-set resolver is safe: dedupe happens here, by filename, after extraction.
 *
 * **Sets become sections, except the default one.** A collection whose only set
 * is Pixieset's default "All Photos" lands in the archive's intake section
 * ("Unsorted"), matching what an upload of the same photos would do. A collection
 * with real sets (Ceremony / Reception) keeps those names. The branch is logged,
 * because a silent resolver is how collections vanish.
 *
 * **Idempotent by (event, original_filename).** A partial run is safe to repeat.
 * Note the difference from the SPS lane, which needs a UNIQUE INDEX because its
 * slices run concurrently under Inngest: this script is sequential and local, so
 * a pre-read is sufficient and no migration is required.
 *
 * ⚠️ `.env.local` points at PRODUCTION Supabase and R2. There is no dev database.
 * Dry run is the default and prints exactly what would happen.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const KEEP_ZIP = argv.includes("--keep-zip");
const NEXT = argv.includes("--next");
const flag = (name: string): string | null => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1] ?? null;
};
const positional = argv.find((a) => !a.startsWith("--") && /^\d+$/.test(a)) ?? null;

const STAGING = path.join(os.homedir(), "pixieset-staging");
const VERIFIED = path.join(STAGING, "verified");
const INGESTED = path.join(STAGING, "ingested");

const QUEUE_PATH = path.join("scripts", "pixieset", "data", "queue.json");

/** Pixieset's default set name. Its presence alone is not an organisation scheme. */
const DEFAULT_SET = /^all[ _]photos$/i;

const JPEG = /\.(jpe?g)$/i;

interface QueueCollection {
  id: string;
  slug: string;
  name: string;
  eventDate: string | null;
  year: number | null;
  photoCount: number;
  state: string;
  atRisk: boolean;
  files: number | null;
  bytes: number | null;
  expectedFiles?: number | null;
  eventId?: string | null;
}

const n = (x: number) => x.toLocaleString("en-US");
const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;

/** Every ZIP part staged for a collection, in part order. */
function zipsFor(slug: string): string[] {
  if (!fs.existsSync(VERIFIED)) return [];
  return fs
    .readdirSync(VERIFIED)
    .filter((f) => f.startsWith(`${slug}-photo-download-`) && f.endsWith(".zip"))
    .map((f) => path.join(VERIFIED, f))
    .sort();
}

async function listEntries(zipPath: string): Promise<string[]> {
  const { stdout } = await run("unzip", ["-Z1", zipPath], { maxBuffer: 256 * 1024 * 1024 });
  return stdout.split("\n").map((l) => l.trim()).filter(Boolean).filter((l) => !l.endsWith("/"));
}

/** One entry's bytes, straight out of the archive — never extracted to disk. */
async function readEntry(zipPath: string, entry: string): Promise<Buffer> {
  const { stdout } = await run("unzip", ["-p", zipPath, entry], {
    maxBuffer: 512 * 1024 * 1024,
    encoding: "buffer",
  } as never);
  return stdout as unknown as Buffer;
}

/**
 * Plan the ingest: which photo lives where, and which sections it belongs to.
 *
 * Dedupe is by BASENAME, across every part and every set. Pixieset repeats a
 * photo's bytes in each set it belongs to, so a naive pass would upload the same
 * frame several times — and `photo_count` double-counts for precisely this
 * reason.
 */
function planEntries(byZip: { zipPath: string; entries: string[] }[]) {
  const photos = new Map<
    string,
    { zipPath: string; entry: string; sets: string[] }
  >();
  const setOrder: string[] = [];

  for (const { zipPath, entries } of byZip) {
    for (const entry of entries) {
      if (!JPEG.test(entry)) continue;
      const slash = entry.indexOf("/");
      const set = slash === -1 ? "(root)" : entry.slice(0, slash);
      const base = path.basename(entry);
      if (!setOrder.includes(set)) setOrder.push(set);

      const existing = photos.get(base);
      if (existing) {
        // Same photo, another set — a second section link, not a second upload.
        if (!existing.sets.includes(set)) existing.sets.push(set);
        continue;
      }
      photos.set(base, { zipPath, entry, sets: [set] });
    }
  }
  return { photos, setOrder };
}

/** Pixieset writes folder names with underscores; the archive shows them to humans. */
const prettySet = (s: string) => s.replace(/_/g, " ").trim();

async function main() {
  const { createServiceClient } = await import("../src/lib/supabase/server");
  const { buildImageKey, uploadToR2, deleteFromR2 } = await import("../src/lib/r2/client");
  const { generateThumbnailsFromBuffer } = await import("../src/lib/thumbnails/generate");
  const { parseFilename, extractExif } = await import("../src/lib/upload/parse-filename");
  const { INTAKE_SECTION_NAME } = await import("../src/lib/sections/intake");
  const { inngest } = await import("../src/lib/inngest/client");

  if (!fs.existsSync(QUEUE_PATH)) {
    console.error(`no queue at ${QUEUE_PATH} — run: node scripts/pixieset/queue.mjs build`);
    process.exit(1);
  }
  const queue = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8")) as {
    collections: Record<string, QueueCollection>;
  };

  // Which collection?
  let collection: QueueCollection | undefined;
  if (NEXT) {
    collection = Object.values(queue.collections)
      .filter((c) => c.state === "verified")
      .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || String(a.eventDate).localeCompare(String(b.eventDate)))[0];
    if (!collection) {
      console.error("nothing is verified and waiting to ingest.");
      process.exit(1);
    }
  } else {
    if (!positional) {
      console.error("usage: pixieset-ingest.ts <collectionId> [--apply]   (or --next)");
      process.exit(1);
    }
    collection = queue.collections[positional];
    if (!collection) {
      console.error(`collection ${positional} is not in the queue`);
      process.exit(1);
    }
  }

  console.log(`${collection.name}  (${collection.id} · ${collection.eventDate ?? "no date"})`);
  console.log(APPLY ? "MODE: APPLY — writing to PRODUCTION\n" : "MODE: dry run (pass --apply to write)\n");

  // Only a proven archive is allowed through. `verified` means CRC-checked, parts
  // complete, and dimensions sampled — the fidelity guard has already run.
  if (collection.state !== "verified") {
    console.error(
      `state is "${collection.state}", not "verified" — refusing to ingest an unproven archive.\n` +
      `  run: node scripts/pixieset/watch.mjs sweep`
    );
    process.exit(1);
  }

  const zips = zipsFor(collection.slug);
  if (!zips.length) {
    console.error(`no staged ZIPs for ${collection.slug} in ${VERIFIED}`);
    process.exit(1);
  }
  console.log(`archive: ${zips.length} part(s)`);

  const byZip = [];
  for (const z of zips) byZip.push({ zipPath: z, entries: await listEntries(z) });
  const { photos, setOrder } = planEntries(byZip);

  const totalEntries = byZip.reduce((a, z) => a + z.entries.filter((e) => JPEG.test(e)).length, 0);
  const duplicates = totalEntries - photos.size;

  console.log(`entries: ${n(totalEntries)} JPEGs across ${setOrder.length} set(s)`);
  console.log(`unique : ${n(photos.size)}${duplicates ? `  (${n(duplicates)} appear in more than one set — one image, several section links)` : ""}`);
  for (const s of setOrder) {
    const count = [...photos.values()].filter((p) => p.sets.includes(s)).length;
    console.log(`   ${prettySet(s)} — ${n(count)}`);
  }

  // Section plan. Logged because a silent resolver is how collections vanish.
  const singleDefault = setOrder.length === 1 && DEFAULT_SET.test(prettySet(setOrder[0]));
  const sectionNameFor = (set: string) => (singleDefault ? INTAKE_SECTION_NAME : prettySet(set));
  console.log(
    `\nsections: ${singleDefault
      ? `single default set → the archive's "${INTAKE_SECTION_NAME}" intake`
      : `${setOrder.length} named set(s) → sections of the same name`}`
  );

  const supabase = createServiceClient();

  // Owner. A new event needs one, and guessing is not acceptable on a live DB.
  let userId = flag("user");
  if (!userId) {
    const { data: owners, error } = await supabase.from("events").select("user_id").limit(500);
    if (error) throw error;
    const distinct = [...new Set((owners ?? []).map((o) => o.user_id))];
    if (distinct.length !== 1) {
      console.error(`cannot infer the owner (${distinct.length} distinct users) — pass --user <uuid>`);
      process.exit(1);
    }
    userId = distinct[0];
    console.log(`owner: ${userId} (only user in the archive)`);
  }

  // Existing event for this collection? Provenance lives on the event, so a
  // resumed ingest finds its own work rather than making a second event.
  const { data: linked, error: linkedErr } = await supabase
    .from("events")
    .select("id, name")
    .eq("user_id", userId)
    .contains("settings", { pixiesetCollectionId: collection.id })
    .maybeSingle();
  if (linkedErr) throw linkedErr;

  let eventId = linked?.id ?? null;
  if (eventId) console.log(`event : existing ${eventId} (resuming)`);

  // What is already in that event — the idempotency check.
  let present = new Set<string>();
  if (eventId) {
    const { data: rows, error: rowsErr } = await supabase
      .from("images")
      .select("original_filename")
      .eq("event_id", eventId);
    if (rowsErr) throw rowsErr;
    present = new Set((rows ?? []).map((r) => r.original_filename));
    console.log(`already in : ${n(present.size)} image(s)`);
  }

  const todo = [...photos.entries()].filter(([base]) => !present.has(base));
  const bytesEstimate = collection.bytes ?? 0;
  console.log(`to ingest  : ${n(todo.length)} image(s)${bytesEstimate ? ` · archive is ${mb(bytesEstimate)}` : ""}\n`);

  if (!todo.length) {
    console.log("nothing to do — every photo is already in the archive.");
    if (APPLY) await markIngested(queue, collection, eventId);
    return;
  }

  if (!APPLY) {
    console.log("dry run — no event, no objects, no rows were created.");
    console.log(`sample of what would land:`);
    for (const [base, p] of todo.slice(0, 5)) {
      console.log(`   ${base}  →  sections: ${p.sets.map(sectionNameFor).join(", ")}`);
    }
    return;
  }

  // ── everything below writes to production ──────────────────────────────────

  if (!eventId) {
    const slug = `${collection.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")}-${Date.now().toString(36)}`;
    const { data: event, error: eventErr } = await supabase
      .from("events")
      .insert({
        user_id: userId,
        name: collection.name,
        slug,
        event_date: collection.eventDate ? collection.eventDate.slice(0, 10) : null,
        settings: {
          pixiesetCollectionId: collection.id,
          pixiesetSlug: collection.slug,
          pixiesetImportedAt: new Date().toISOString(),
        },
      })
      .select("id")
      .single();
    if (eventErr) throw eventErr;
    eventId = event.id;
    console.log(`created event ${eventId}`);
  }

  // Sections, in the archive's own order.
  const sectionIds = new Map<string, string>();
  for (const [i, set] of setOrder.entries()) {
    const name = sectionNameFor(set);
    const { data: existing, error: exErr } = await supabase
      .from("sections")
      .select("id")
      .eq("event_id", eventId)
      .ilike("name", name)
      .maybeSingle();
    if (exErr) throw exErr;
    if (existing) {
      sectionIds.set(set, existing.id);
      continue;
    }
    const { data: created, error: secErr } = await supabase
      .from("sections")
      .insert({ event_id: eventId, name, sort_order: i, is_auto: false })
      .select("id")
      .single();
    if (secErr) throw secErr;
    sectionIds.set(set, created.id);
  }
  console.log(`sections ready: ${sectionIds.size}`);

  // Append after whatever each section already holds.
  const sortBase = new Map<string, number>();
  for (const [set, sid] of sectionIds) {
    const { data: tail, error: tailErr } = await supabase
      .from("section_images")
      .select("sort_order")
      .eq("section_id", sid)
      .order("sort_order", { ascending: false })
      .limit(1);
    if (tailErr) throw tailErr;
    sortBase.set(set, (tail?.[0]?.sort_order ?? -1) + 1);
  }

  let imported = 0;
  let failed = 0;
  let bytes = 0;
  const failures: { filename: string; reason: string }[] = [];
  const started = Date.now();

  for (const [base, plan] of todo) {
    try {
      const buffer = await readEntry(plan.zipPath, plan.entry);
      if (buffer.byteLength < 1024) throw new Error("entry too small to be a photograph");

      const id = randomUUID();
      const parsed = parseFilename(base);
      const filename = `${id}.${parsed.extension}`;
      const r2Key = buildImageKey(eventId, filename);

      // ── bytes first ──
      await uploadToR2(r2Key, buffer, "image/jpeg");
      const abandon = async () => {
        try {
          await deleteFromR2(r2Key);
        } catch (err) {
          console.error(`  orphaned R2 object ${r2Key}`, err);
        }
      };

      // ── the row ──
      const { error: insErr } = await supabase.from("images").insert({
        id,
        event_id: eventId,
        filename,
        original_filename: base,
        r2_key: r2Key,
        file_size: buffer.byteLength,
        mime_type: "image/jpeg",
        media_type: "image",
        parsed_name: parsed.name,
        processing_status: "pending",
      });
      if (insErr) {
        await abandon();
        throw insErr;
      }

      // ── section links — no orphans, and one per set the photo belongs to ──
      const links = plan.sets.map((set) => ({
        section_id: sectionIds.get(set)!,
        image_id: id,
        sort_order: (sortBase.get(set) ?? 0) + imported,
      }));
      const { error: linkErr } = await supabase.from("section_images").insert(links);
      if (linkErr) {
        await supabase.from("images").delete().eq("id", id);
        await abandon();
        throw linkErr;
      }

      // ── display work, then complete ──
      const update: Record<string, unknown> = { processing_status: "complete" };

      // Best-effort ON PURPOSE. A throw here would strand the row at "pending"
      // with its bytes already safe — and a stale pending row blocks the event's
      // ENTIRE AI pipeline (countPendingUploads gates it) while reading to the
      // photographer as "still uploading". One bad frame must not stall an event.
      try {
        const thumbs = await generateThumbnailsFromBuffer(buffer, eventId, filename);
        update.thumbnail_generated = true;
        update.thumb_bytes = thumbs.thumbBytes;
        if (thumbs.width) update.width = thumbs.width;
        if (thumbs.height) update.height = thumbs.height;
        if (thumbs.dominantColor) update.dominant_color = thumbs.dominantColor;
      } catch (thumbErr) {
        console.error(`  thumbnail failed for ${base}:`, thumbErr);
      }

      const exif = await extractExif(
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
      );
      if (exif) {
        if (exif.takenAt) update.taken_at = exif.takenAt;
        if (exif.cameraMake) update.camera_make = exif.cameraMake;
        if (exif.cameraModel) update.camera_model = exif.cameraModel;
        if (exif.lens) update.lens = exif.lens;
        if (exif.focalLength) update.focal_length = exif.focalLength;
        if (exif.aperture) update.aperture = exif.aperture;
        if (exif.shutterSpeed) update.shutter_speed = exif.shutterSpeed;
        if (exif.iso) update.iso = exif.iso;
        if (exif.gpsLat) update.gps_lat = exif.gpsLat;
        if (exif.gpsLng) update.gps_lng = exif.gpsLng;
      }

      const { error: updErr } = await supabase.from("images").update(update).eq("id", id);
      if (updErr) throw updErr;

      imported++;
      bytes += buffer.byteLength;
      if (imported % 25 === 0 || imported === todo.length) {
        const rate = imported / ((Date.now() - started) / 1000);
        console.log(`  ${n(imported)} / ${n(todo.length)} · ${mb(bytes)} · ${rate.toFixed(1)}/s`);
      }
    } catch (err) {
      failed++;
      const reason = err instanceof Error ? err.message : String(err);
      failures.push({ filename: base, reason });
      console.error(`  ✗ ${base}: ${reason}`);
    }
  }

  const secs = (Date.now() - started) / 1000;
  console.log(
    `\n${n(imported)} imported · ${n(failed)} failed · ${mb(bytes)} in ${secs.toFixed(0)}s ` +
    `(${(bytes / 1048576 / secs).toFixed(1)} MB/s)`
  );
  if (failures.length) {
    console.log("failures:");
    for (const f of failures.slice(0, 20)) console.log(`   ${f.filename} — ${f.reason}`);
  }

  // Settlement, once — both lanes debounce per event, and one send per photo is
  // how you get rate limited.
  if (imported) {
    try {
      await inngest.send({ name: "focal/auto.suggest", data: { eventId } });
      await inngest.send({ name: "ai/index.requested", data: { eventId } });
      console.log("settlement dispatched (focal points + AI indexing)");
    } catch (err) {
      console.error("settlement dispatch failed (not fatal):", err);
    }
  }

  // Only a clean run reclaims the disk. A partial ingest keeps its archive so the
  // rerun has something to read.
  if (!failed) {
    await markIngested(queue, collection, eventId);
    if (!KEEP_ZIP) {
      fs.mkdirSync(INGESTED, { recursive: true });
      for (const z of zips) fs.renameSync(z, path.join(INGESTED, path.basename(z)));
      console.log(`archive moved to ${INGESTED} — delete once you are happy it landed`);
    }
  } else {
    console.log("archive KEPT (there were failures) — rerun to fill the gaps; it is idempotent.");
  }
}

/** Walk the queue entry to `ingested` and record which event it became. */
async function markIngested(
  queue: { collections: Record<string, QueueCollection> },
  collection: QueueCollection,
  eventId: string | null
) {
  const c = queue.collections[collection.id];
  if (!c) return;
  c.state = "ingested";
  c.eventId = eventId;
  (c as unknown as { history: unknown[] }).history = [
    ...((c as unknown as { history: unknown[] }).history ?? []),
    { state: "ingested", at: new Date().toISOString(), eventId },
  ];
  const tmp = `${QUEUE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(queue, null, 2));
  fs.renameSync(tmp, QUEUE_PATH);
  console.log(`queue: ${collection.id} → ingested`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
