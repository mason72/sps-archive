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
import { pathToFileURL } from "node:url";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/* Structural shapes for the helper below — the app's own generics are not
   importable at module scope here, and this file only ever holds the service
   client. */
type SupabaseLike = Awaited<ReturnType<typeof import("../src/lib/supabase/server").createServiceClient>>;
type ResolveSharePins = typeof import("../src/types/event-settings").resolveSharePins;

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

/** Same override as watch.mjs — one variable, or the two halves stage apart. */
const STAGING = process.env.PIXIESET_STAGING || path.join(os.homedir(), "pixieset-staging");
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

/**
 * A readable message for anything thrown here.
 *
 * A Supabase/PostgREST error is a PLAIN OBJECT, not an Error, so `String(err)`
 * renders it `[object Object]` — which is what 69 failure lines said during the
 * Perkin Elmer ingest, hiding a one-line cause (`22P02 invalid input syntax for
 * type double precision`) behind a diagnostic that carried no information at
 * all. Never let an error reach a log through `String()`.
 */
function pgMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const e = err as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [e.code && `[${e.code}]`, e.message, e.details, e.hint].filter(Boolean);
    if (parts.length) return parts.join(" ");
    try {
      return JSON.stringify(err);
    } catch {
      return "unserialisable error object";
    }
  }
  return String(err);
}

/** Every ZIP part staged for a collection, in part order. */
/** Staged ZIPs for a collection, from either staging directory.
 *  `ingested/` is included so a re-run can still read the source it already
 *  consumed — which is what makes republishing or filling a gap possible. */
function zipsFor(slug: string): string[] {
  const out: string[] = [];
  for (const dir of [VERIFIED, INGESTED]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(`${slug}-photo-download-`) && f.endsWith(".zip")) out.push(path.join(dir, f));
    }
  }
  return out.sort();
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

/**
 * Publish a gallery — i.e. mint a live share for it.
 *
 * Mason, 2026-08-13: imported galleries should arrive Published. His reasoning
 * settles the exposure question I raised — these are ALREADY public galleries on
 * Pixieset, so a Pixeltrunk share preserves the status quo rather than creating
 * new exposure, and it keeps the links working once Pixieset is cancelled. The
 * prompt was a real failure: a link went to a client for a gallery that had
 * never been published, and they could not download.
 *
 * "Published" is not a flag on the event; it is DERIVED from a live share
 * (`shares.is_active` — see lib/events/status.ts), so publishing means inserting
 * one.
 *
 * PINs go through `resolveSharePins()` and nothing else. CLAUDE.md is explicit
 * that shares are minted from several places, and that re-inlining inheritance
 * at a call site is exactly what broke the download PIN before. This script is
 * now one more of those places.
 *
 * Idempotent, and reachable from BOTH ingest paths — including the one where
 * every photo was already present, so a collection imported before this existed
 * does not stay a draft merely because it had no new photos to move.
 */
export async function publishGallery(
  supabase: SupabaseLike,
  eventId: string,
  resolveSharePins: ResolveSharePins,
  nanoid: (size?: number) => string
): Promise<void> {
  const { data: existing } = await supabase
    .from("shares")
    .select("id, slug")
    .eq("event_id", eventId)
    .eq("is_active", true)
    .maybeSingle();

  if (existing) {
    console.log(`already published: /gallery/${existing.slug}`);
    return;
  }

  const { data: ev } = await supabase
    .from("events")
    .select("settings")
    .eq("id", eventId)
    .single();
  const sharing = ((ev?.settings as Record<string, unknown>)?.sharing ?? {}) as never;
  const pins = resolveSharePins({ useEventDefaults: true, event: sharing });

  const slug = nanoid(10);
  const { error } = await supabase.from("shares").insert({
    event_id: eventId,
    slug,
    is_active: true,
    share_type: "full",
    allow_download: true,
    allow_favorites: true,
    download_quality: "original",
    download_pin: pins.downloadPin || null,
    require_pin_bulk: pins.requirePinBulk,
    require_pin_individual: pins.requirePinIndividual,
  });
  // Not fatal. The photos are in and the gallery can be published by hand;
  // losing an import over a share row would be the wrong trade.
  if (error) console.error("could not publish (photos are safe):", error.message);
  else console.log(`published: /gallery/${slug}`);
}

async function main() {
  const { createServiceClient } = await import("../src/lib/supabase/server");
  const { buildImageKey, uploadToR2, deleteFromR2 } = await import("../src/lib/r2/client");
  const { generateThumbnailsFromBuffer } = await import("../src/lib/thumbnails/generate");
  const { parseFilename, extractExif } = await import("../src/lib/upload/parse-filename");
  const { INTAKE_SECTION_NAME } = await import("../src/lib/sections/intake");
  const { inngest } = await import("../src/lib/inngest/client");
  const { resolveSharePins } = await import("../src/types/event-settings");
  const { nanoid } = await import("nanoid");

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
  // `verified` means CRC-checked, parts complete, dimensions sampled — the
  // fidelity guard has run. `ingested` is also allowed because it is verified
  // plus finished: re-running is idempotent (every photo is already present, so
  // nothing moves) and it is how an already-imported gallery gets published, or
  // how a partial run fills its gaps. Anything else is an unproven archive.
  if (collection.state !== "verified" && collection.state !== "ingested") {
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
    console.log("nothing new to import — every photo is already in the archive.");
    if (APPLY) {
      // Still publish: a collection ingested before publishing existed, or a
      // re-run after a partial failure, must not stay a draft just because
      // there were no NEW photos to move.
      if (eventId) await publishGallery(supabase, eventId, resolveSharePins, nanoid);
      await markIngested(queue, collection, eventId);
    }
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
  let exifSkipped = 0;
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
      const displayUpdate: Record<string, unknown> = { processing_status: "complete" };
      const exifUpdate: Record<string, unknown> = {};

      // Best-effort ON PURPOSE. A throw here would strand the row at "pending"
      // with its bytes already safe — and a stale pending row blocks the event's
      // ENTIRE AI pipeline (countPendingUploads gates it) while reading to the
      // photographer as "still uploading". One bad frame must not stall an event.
      try {
        const thumbs = await generateThumbnailsFromBuffer(buffer, eventId, filename);
        displayUpdate.thumbnail_generated = true;
        displayUpdate.thumb_bytes = thumbs.thumbBytes;
        if (thumbs.width) displayUpdate.width = thumbs.width;
        if (thumbs.height) displayUpdate.height = thumbs.height;
        if (thumbs.dominantColor) displayUpdate.dominant_color = thumbs.dominantColor;
      } catch (thumbErr) {
        console.error(`  thumbnail failed for ${base}:`, thumbErr);
      }

      const exif = await extractExif(
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
      );
      if (exif) {
        if (exif.takenAt) exifUpdate.taken_at = exif.takenAt;
        if (exif.cameraMake) exifUpdate.camera_make = exif.cameraMake;
        if (exif.cameraModel) exifUpdate.camera_model = exif.cameraModel;
        if (exif.lens) exifUpdate.lens = exif.lens;
        if (exif.focalLength) exifUpdate.focal_length = exif.focalLength;
        if (exif.aperture) exifUpdate.aperture = exif.aperture;
        if (exif.shutterSpeed) exifUpdate.shutter_speed = exif.shutterSpeed;
        if (exif.iso) exifUpdate.iso = exif.iso;
        if (exif.gpsLat) exifUpdate.gps_lat = exif.gpsLat;
        if (exif.gpsLng) exifUpdate.gps_lng = exif.gpsLng;
      }

      /**
       * DISPLAY FIRST, ENRICHMENT SECOND — in two writes, deliberately.
       *
       * These used to be one update, so a single unconvertible EXIF value took
       * `processing_status` and `thumbnail_generated` down with it and left the
       * row at `pending` with no thumbnail: a ghost tile, with its bytes safely
       * in R2 and nothing pointing at them. That is exactly what happened to 69
       * frames of Perkin Elmer Accelerate 2018, where a GPS-equipped Canon 1DX
       * produced a DMS tuple the double-precision column could not take.
       *
       * The camera metadata is a decoration. It must never be able to break the
       * photograph — same rule as the dashboard enrichment legs.
       */
      const { error: updErr } = await supabase
        .from("images")
        .update(displayUpdate)
        .eq("id", id);
      if (updErr) throw updErr;

      if (Object.keys(exifUpdate).length) {
        const { error: exifErr } = await supabase
          .from("images")
          .update(exifUpdate)
          .eq("id", id);
        if (exifErr) {
          // Reported, never thrown: the photo is already complete and visible.
          exifSkipped++;
          console.error(
            `  ⚠ EXIF not stored for ${base} (photo is fine): ${pgMessage(exifErr)}`
          );
        }
      }

      imported++;
      bytes += buffer.byteLength;
      if (imported % 25 === 0 || imported === todo.length) {
        const rate = imported / ((Date.now() - started) / 1000);
        console.log(`  ${n(imported)} / ${n(todo.length)} · ${mb(bytes)} · ${rate.toFixed(1)}/s`);
      }
    } catch (err) {
      failed++;
      const reason = pgMessage(err);
      failures.push({ filename: base, reason });
      console.error(`  ✗ ${base}: ${reason}`);
    }
  }

  const secs = (Date.now() - started) / 1000;
  console.log(
    `\n${n(imported)} imported · ${n(failed)} failed · ${mb(bytes)} in ${secs.toFixed(0)}s ` +
    `(${(bytes / 1048576 / secs).toFixed(1)} MB/s)`
  );
  if (exifSkipped) {
    console.log(`${n(exifSkipped)} photo(s) stored without camera metadata (visible and complete).`);
  }
  if (failures.length) {
    console.log("failures:");
    for (const f of failures.slice(0, 20)) console.log(`   ${f.filename} — ${f.reason}`);
  }

  /**
   * Publish the gallery — i.e. mint a live share.
   *
   * Mason, 2026-08-13: imported galleries should arrive Published. His reasoning
   * settles the exposure question: these are ALREADY public galleries on
   * Pixieset, so a Pixeltrunk share preserves the status quo rather than
   * creating new exposure — and it keeps the links alive once Pixieset is
   * cancelled. The prompt was a real failure: a link was shared for a gallery
   * that had never been published, and the client could not download.
   *
   * "Published" is not a flag on the event; it is derived from a LIVE share
   * (`shares.is_active`) — see lib/events/status.ts. So publishing means
   * inserting one.
   *
   * PINs go through `resolveSharePins()` and nothing else. CLAUDE.md is explicit
   * that shares are minted from several places and that re-inlining inheritance
   * at a call site is what broke the download PIN before; this script is now one
   * more of those places.
   */
  if (!failed) await publishGallery(supabase, eventId, resolveSharePins, nanoid);

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

    /**
     * Release the archive — but only against PIXELTRUNK, never against our own
     * success counters.
     *
     * The archives used to be parked in `ingested/` with "delete once you are
     * happy it landed", which meant a human verifying and deleting by hand
     * after every collection. Doing that ~1,371 times is not a plan, and the
     * one time it is skipped the staging volume fills and the pipeline stops.
     *
     * The check deliberately re-reads the DATABASE rather than trusting
     * `imported`/`failed` from the loop above. Those counters say what this
     * process believes it did; the query says what a visitor to the gallery
     * will actually see. Perkin Elmer reported "947 imported / 69 failed" while
     * the database held 1,016 rows — the counters and the truth disagreed, and
     * the truth was the one worth acting on.
     *
     * Three conditions, all required: every expected image present, every one
     * with a thumbnail (a row without one is a ghost tile), and a live share
     * (an unpublished gallery is one the client cannot open). Anything short of
     * that keeps the bytes.
     */
    const release = await verifyLanded(supabase, eventId, todo.length);
    if (KEEP_ZIP) {
      console.log("archive kept (--keep-zip)");
    } else if (release.ok) {
      let freed = 0;
      for (const z of zips) {
        try { freed += fs.statSync(z).size; fs.unlinkSync(z); }
        catch (err) { console.error(`  could not release ${path.basename(z)}: ${String(err)}`); }
      }
      console.log(
        `archive released — ${release.detail}. ` +
        `${(freed / 1073741824).toFixed(2)} GB back on the staging volume.`
      );
    } else {
      fs.mkdirSync(INGESTED, { recursive: true });
      for (const z of zips) fs.renameSync(z, path.join(INGESTED, path.basename(z)));
      console.log(`archive KEPT in ${INGESTED} — ${release.detail}`);
    }
  } else {
    console.log("archive KEPT (there were failures) — rerun to fill the gaps; it is idempotent.");
  }
}


/**
 * Did this collection actually land, as a visitor would see it?
 *
 * Asks the database, not the importer. Used to decide whether the downloaded
 * archive may be deleted, so it fails CLOSED: any doubt keeps the bytes, and
 * the bytes can always be re-downloaded from Pixieset anyway. The asymmetry
 * matters — a wrongly-kept archive costs disk, a wrongly-deleted one costs a
 * re-download of something irreplaceable.
 */
export async function verifyLanded(
  supabase: SupabaseLike,
  eventId: string,
  expected: number
): Promise<{ ok: boolean; detail: string }> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const db = supabase as any;
  try {
    const head = () =>
      db.from("images").select("*", { count: "exact", head: true }).eq("event_id", eventId);

    const totalRes = await head();
    if (totalRes.error) throw totalRes.error;
    const thumbRes = await head().eq("thumbnail_generated", true);
    if (thumbRes.error) throw thumbRes.error;
    const { data: shares, error: shErr } = await db
      .from("shares").select("slug").eq("event_id", eventId).eq("is_active", true);
    if (shErr) throw shErr;

    const total = totalRes.count as number;
    const thumbed = thumbRes.count as number;
    const live = (shares ?? []).length > 0;
    const ok = total >= expected && thumbed === total && live;

    return {
      ok,
      detail: `${total}/${expected} images · ${thumbed} with thumbnails · ${live ? "published" : "NOT published"}`,
    };
  } catch (err) {
    // A failed check is not a pass. Keep the archive and say why.
    return { ok: false, detail: `verification failed: ${pgMessage(err)}` };
  }
}

/** Walk the queue entry to `ingested` and record which event it became. */
async function markIngested(
  queue: { collections: Record<string, QueueCollection> },
  collection: QueueCollection,
  eventId: string | null
) {
  /**
   * Re-read the queue, change only OUR row, write it back — under a lock.
   *
   * `queue` was read when this run started, twenty minutes and several gigabytes
   * ago. Writing that whole object back republishes a stale snapshot of every
   * OTHER collection too, erasing anything the watcher recorded meanwhile. That
   * is exactly what happened on 2026-08-14: two collections the watcher had
   * marked `verified` silently reverted to `queued`, which would have re-
   * downloaded archives already sitting on disk.
   *
   * The lock protocol matches `store.mjs#withQueue` — same file, same semantics
   * — so the watcher and the ingest genuinely serialise against each other.
   */
  const LOCK = `${QUEUE_PATH}.lock`;
  const started = Date.now();
  for (;;) {
    try {
      fs.writeFileSync(LOCK, String(process.pid), { flag: "wx" });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") throw err;
      const age = (() => {
        try { return Date.now() - fs.statSync(LOCK).mtimeMs; } catch { return Infinity; }
      })();
      if (age > 120000) { fs.rmSync(LOCK, { force: true }); continue; }  // holder died
      if (Date.now() - started > 30000) throw new Error("queue lock held too long by another pixieset process");
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  try {
    const fresh = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8")) as {
      collections: Record<string, QueueCollection>;
      updatedAt?: string;
    };
    const c = fresh.collections[collection.id];
    if (!c) return;
    c.state = "ingested";
    (c as unknown as { eventId: string | null }).eventId = eventId;
    (c as unknown as { history: unknown[] }).history = [
      ...((c as unknown as { history: unknown[] }).history ?? []),
      { state: "ingested", at: new Date().toISOString(), eventId },
    ];
    fresh.updatedAt = new Date().toISOString();
    const tmp = `${QUEUE_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(fresh, null, 2));
    fs.renameSync(tmp, QUEUE_PATH);
    console.log(`queue: ${collection.id} → ingested`);
  } finally {
    fs.rmSync(LOCK, { force: true });
  }
}

/**
 * Only run the CLI when this file IS the entry point.
 *
 * `publishGallery` is exported so the repair script can reuse it rather than
 * re-inlining a share insert — and without this guard, importing it ran the
 * whole ingest CLI, which printed a usage error and exited the caller.
 */
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
})();

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
