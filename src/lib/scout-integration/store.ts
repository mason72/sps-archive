/**
 * The Scout integration's server side: every database, R2 and Inngest write.
 *
 * Ownership: every row this creates belongs to the account that owns the
 * `tdp-website` gallery (looked up, never hard-coded). That is the studio
 * account the website, the crew roster and the crew faces already live under,
 * so a postcard can be published to a website scene and matched against the
 * crew without crossing an account boundary.
 *
 * The photo lands with the SAME write order as scripts/upload-folder-to-section.ts:
 *   bytes to R2 → images row → (claim the postcard) → section link →
 *   thumbnails → complete → EXIF
 * Bytes land before the row, so there is no ghost-tile window. Anything that
 * fails before `complete` is written is rolled back (row and bytes), so a
 * retried POST starts clean instead of finding a half-made photo. Then the
 * same Inngest events the upload path sends (`ai/index.requested`,
 * `focal/auto.suggest`) start the normal AI lane.
 */
import { randomUUID } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/server";
import {
  buildImageKey,
  deleteFromR2,
  deleteImageAssets,
  getPresignedDownloadUrl,
  uploadToR2,
} from "@/lib/r2/client";
import { processMutedVideoViaModal } from "@/lib/video/process";
import { mp4TrackKinds } from "@/lib/video/mp4-tracks";
import { generateThumbnailsFromBuffer } from "@/lib/thumbnails/generate";
import { extractExif } from "@/lib/upload/parse-filename";
import { reportSystemError } from "@/lib/monitoring/report";
import { inngest } from "@/lib/inngest/client";
import { WEBSITE_EVENT_SLUG, getWebsiteSection } from "@/lib/site/gallery";
import { syncSitePublication } from "@/lib/site/membership";
import { POSTCARD_VIDEO_MAX_BYTES, fetchCapped, fetchPostcardImage, fetchPostcardVideo } from "./fetch-image";
import { pickCrewMatches, type CrewInPhoto, type CrewRosterEntry } from "./crew-match";
import {
  claimOutcome,
  ingestDecision,
  postcardFilename,
  postcardStatus,
  type PostcardLink,
  type PostcardStatus,
} from "./postcard-state";
import {
  SCOUT_GIG_KIND,
  SCOUT_ROAD_NAME,
  SCOUT_ROAD_SLUG,
  SCOUT_VIDEO_MAX_SECONDS,
  gigSectionNames, type PostcardInput, type ScoutPublishTarget } from "./validate";

export type ScoutDb = ReturnType<typeof createServiceClient>;


/** A failure with an HTTP status the route should answer with. */
export class ScoutIntegrationError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ScoutIntegrationError";
  }
}

/** A service client whose every request carries a deadline (lesson 131). */
export function scoutDb(): ScoutDb {
  return createServiceClient({
    global: {
      fetch: (input, init) => {
        const deadline = AbortSignal.timeout(30_000);
        const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
        return fetch(input, { ...init, signal });
      },
    },
  });
}

const LINK_COLUMNS =
  "postcard_id, image_id, event_id, section_id, gig_id, author_email, created_at, published_target, published_at";

// ── lookups ────────────────────────────────────────────────────────────────

/** The studio account: whoever owns the `tdp-website` gallery. */
export async function loadOwnerUserId(db: ScoutDb): Promise<string> {
  const { data, error } = await db
    .from("events")
    .select("user_id")
    .eq("slug", WEBSITE_EVENT_SLUG)
    .maybeSingle();
  if (error) throw error;
  if (!data?.user_id) {
    throw new ScoutIntegrationError(
      `No "${WEBSITE_EVENT_SLUG}" gallery exists, so the Scout integration has no owner account.`,
      503
    );
  }
  return data.user_id;
}

export async function getLink(db: ScoutDb, postcardId: string): Promise<PostcardLink | null> {
  const { data, error } = await db
    .from("scout_postcard_links")
    .select(LINK_COLUMNS)
    .eq("postcard_id", postcardId)
    .maybeSingle();
  if (error) throw error;
  return (data as PostcardLink | null) ?? null;
}

async function requireLink(db: ScoutDb, postcardId: string): Promise<PostcardLink> {
  const link = await getLink(db, postcardId);
  if (!link) throw new ScoutIntegrationError("No such postcard in Pixeltrunk.", 404);
  return link;
}

// ── the Scout Road gallery and its gig sections ────────────────────────────

const isUniqueViolation = (e: { code?: string } | null) => e?.code === "23505";

/** The private crew-BTS gallery, created once. Never a website or Work gallery. */
export async function ensureScoutRoadEvent(db: ScoutDb, ownerId: string): Promise<string> {
  const read = async () => {
    const { data, error } = await db
      .from("events")
      .select("id, user_id")
      .eq("slug", SCOUT_ROAD_SLUG)
      .maybeSingle();
    if (error) throw error;
    if (data && data.user_id !== ownerId) {
      throw new ScoutIntegrationError(
        `The "${SCOUT_ROAD_SLUG}" gallery belongs to a different account than the website gallery.`,
        409
      );
    }
    return data?.id ?? null;
  };
  const existing = await read();
  if (existing) return existing;

  const { data, error } = await db
    .from("events")
    .insert({
      user_id: ownerId,
      name: SCOUT_ROAD_NAME,
      slug: SCOUT_ROAD_SLUG,
      description:
        "Crew behind-the-scenes photos from Scout postcards, one section per gig. Private: no share is ever created by the integration.",
      settings: { scoutRoad: true },
    })
    .select("id")
    .single();
  if (!error) return data.id;
  // Another postcard created it a moment ago (the slug is unique).
  if (isUniqueViolation(error)) {
    const raced = await read();
    if (raced) return raced;
  }
  throw error;
}

/** One section per Scout gig, found by `job_meta.scout_gig_id`. Reused, never duplicated. */
export async function ensureGigSection(
  db: ScoutDb,
  eventId: string,
  gig: { gigId: string; gigTitle: string; gigStart: string | null }
): Promise<string> {
  const read = async () => {
    const { data, error } = await db
      .from("sections")
      .select("id")
      .eq("event_id", eventId)
      .filter("job_meta->>scout_gig_id", "eq", gig.gigId)
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) throw error;
    return data?.[0]?.id ?? null;
  };
  const existing = await read();
  if (existing) return existing;

  const { data: tail, error: tailErr } = await db
    .from("sections")
    .select("sort_order")
    .eq("event_id", eventId)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (tailErr) throw tailErr;

  // Section names are unique per event (case-insensitive, migration 048), and
  // gigs repeat titles year to year, so a taken name moves to the next
  // candidate. A unique violation is first checked against the gig marker: a
  // concurrent postcard may have made this very section a moment ago.
  for (const name of gigSectionNames(gig)) {
    const { data, error } = await db
      .from("sections")
      .insert({
        event_id: eventId,
        name,
        sort_order: (tail?.[0]?.sort_order ?? -1) + 1,
        is_auto: false,
        job_meta: { kind: SCOUT_GIG_KIND, scout_gig_id: gig.gigId, scout_gig_start: gig.gigStart },
      })
      .select("id")
      .single();
    if (!error) return data.id;
    if (!isUniqueViolation(error)) throw error;
    const raced = await read();
    if (raced) return raced;
  }
  throw new ScoutIntegrationError(`Could not name a section for gig ${gig.gigId}: every candidate name is taken.`, 409);
}

// ── POST /postcards ────────────────────────────────────────────────────────

export interface IngestResult {
  link: PostcardLink;
  created: boolean;
  status: PostcardStatus;
  /** False when the AI lane could not be woken; the 30-minute sweep will. */
  aiIndexRequested: boolean | null;
}

export async function ingestPostcard(db: ScoutDb, input: PostcardInput): Promise<IngestResult> {
  const decision = ingestDecision(await getLink(db, input.postcardId));
  if (decision.action === "return-existing") {
    return {
      link: decision.link,
      created: false,
      status: await statusOf(db, decision.link.image_id),
      aiIndexRequested: null,
    };
  }

  if (input.mediaType === "video") return ingestPostcardVideo(db, input);

  // Fetch BEFORE writing anything: a bad URL or a non-JPEG leaves no trace
  // (not even an empty gallery or gig section).
  const buffer = await fetchPostcardImage(input.imageUrl);

  const ownerId = await loadOwnerUserId(db);
  const eventId = await ensureScoutRoadEvent(db, ownerId);
  const sectionId = await ensureGigSection(db, eventId, input);

  const imageId = randomUUID();
  const filename = `${imageId}.jpg`;
  const r2Key = buildImageKey(eventId, filename);

  // ── bytes first ──
  await uploadToR2(r2Key, buffer, "image/jpeg");

  let rowWritten = false;
  const rollback = async (why: string) => {
    if (rowWritten) {
      // Cascades the claim (scout_postcard_links) and the section link.
      const { error } = await db.from("images").delete().eq("id", imageId);
      if (error) {
        // The row (and maybe its claim) is still there, so its bytes must stay:
        // deleting them would leave a row pointing at nothing. Mark it failed
        // so Scout reads "failed" instead of "processing" until someone looks.
        await reportSystemError("scout.ingest.rollback-row", error, { imageId, why });
        const { error: markErr } = await db
          .from("images")
          .update({ processing_status: "failed" })
          .eq("id", imageId);
        if (markErr) await reportSystemError("scout.ingest.rollback-mark", markErr, { imageId });
        return;
      }
    }
    const failed = await deleteImageAssets(r2Key, "image");
    if (failed.length) {
      await reportSystemError("scout.ingest.rollback-r2", new Error("R2 delete failed"), { imageId, failed, why });
    }
  };

  try {
    const { error: insErr } = await db.from("images").insert({
      id: imageId,
      event_id: eventId,
      filename,
      original_filename: postcardFilename(input.postcardId),
      r2_key: r2Key,
      file_size: buffer.byteLength,
      mime_type: "image/jpeg",
      media_type: "image",
      parsed_name: null,
      processing_status: "pending",
      ...(input.width ? { width: input.width } : {}),
      ...(input.height ? { height: input.height } : {}),
    });
    if (insErr) throw insErr;
    rowWritten = true;

    // ── the claim: the postcard id is the primary key ──
    const { error: claimErr } = await db.from("scout_postcard_links").insert({
      postcard_id: input.postcardId,
      image_id: imageId,
      event_id: eventId,
      section_id: sectionId,
      gig_id: input.gigId,
      author_email: input.authorEmail,
    });
    const outcome = claimOutcome(claimErr);
    if (outcome === "lost") {
      await rollback("lost the claim race");
      const winner = await requireLink(db, input.postcardId);
      return { link: winner, created: false, status: await statusOf(db, winner.image_id), aiIndexRequested: null };
    }
    if (outcome === "error") throw claimErr;

    // ── section link ──
    const { data: tail, error: tailErr } = await db
      .from("section_images")
      .select("sort_order")
      .eq("section_id", sectionId)
      .order("sort_order", { ascending: false })
      .limit(1);
    if (tailErr) throw tailErr;
    const { error: linkErr } = await db
      .from("section_images")
      .insert({ section_id: sectionId, image_id: imageId, sort_order: (tail?.[0]?.sort_order ?? -1) + 1 });
    if (linkErr) throw linkErr;

    // ── display: thumbnails, then complete. A thumbnail failure leaves the
    // photo complete and the grid self-heals, exactly as the upload path does.
    const display: Record<string, unknown> = { processing_status: "complete" };
    try {
      const thumbs = await generateThumbnailsFromBuffer(buffer, eventId, filename);
      display.thumbnail_generated = true;
      display.thumb_bytes = thumbs.thumbBytes;
      if (thumbs.width) display.width = thumbs.width;
      if (thumbs.height) display.height = thumbs.height;
      if (thumbs.dominantColor) display.dominant_color = thumbs.dominantColor;
    } catch (thumbErr) {
      await reportSystemError("scout.ingest.thumbnail", thumbErr, { imageId, postcardId: input.postcardId });
    }
    const { error: updErr } = await db.from("images").update(display).eq("id", imageId);
    if (updErr) throw updErr;
  } catch (err) {
    await rollback(err instanceof Error ? err.message : String(err));
    throw err;
  }

  // ── enrichment, never fatal ──
  await storeExif(db, imageId, buffer, input.takenAt);

  // ── the AI lane: the same two events the upload path sends, awaited (a bare
  // fire-and-forget does not survive a serverless return). A failed send is
  // reported, and the ai-index sweep picks the photo up within 30 minutes.
  let aiIndexRequested = true;
  for (const name of ["ai/index.requested", "focal/auto.suggest"] as const) {
    try {
      await inngest.send({ name, data: { eventId } });
    } catch (err) {
      if (name === "ai/index.requested") aiIndexRequested = false;
      await reportSystemError("scout.ingest.inngest", err, { name, eventId, imageId });
    }
  }

  const link = await requireLink(db, input.postcardId);
  return { link, created: true, status: "processing", aiIndexRequested };
}

// ── POST /postcards, a clip ────────────────────────────────────────────────

/** Where Scout's clip waits, WITH its audio, while the pipeline makes the silent copy. */
export function scoutStagingKey(imageId: string): string {
  // Outside events/: no gallery, purge, sweep, share or ZIP path walks this
  // prefix, and nothing references it once the request ends.
  return `scout-staging/${imageId}.mp4`;
}

/** Ffprobe and Scout may disagree by a frame or a rounding; past this, it is a longer clip. */
const DURATION_SLACK_S = 0.5;

/**
 * A clip is filed SILENT (Mason, 2026-11-24: crew phone clips record
 * conversations and client names). The bytes Scout sends never become the
 * stored original:
 *
 *   Scout MP4 → R2 staging key → Modal `mute` → the stored original
 *   (`events/<id>/originals/<image>.mp4`: video copied as is, audio, subtitle
 *   and data streams dropped, metadata cleared) + its three posters
 *
 * then this server downloads what Modal wrote and reads its tracks itself
 * (`mp4TrackKinds`): any `soun` track and nothing is filed. Because the stored
 * original is the silent file, everything downstream is silent by
 * construction: the editor, downloads, ZIPs, and the website (a silent clip of
 * 60 s or less publishes on the R2 video lane, where the played file IS this
 * original; a longer one goes to Cloudflare Stream, which pulls the same
 * original). The staging object is deleted on every path.
 *
 * Same order and rollback as a photo otherwise: bytes before the row, the
 * claim on the postcard id, the section link, then `complete`. A clip is not
 * AI-indexed (the lane reads images only), so no Inngest event is sent; the
 * pipeline runs inside this request, the way /api/upload/complete hands a
 * video to Modal, but awaited so the answer is final.
 */
async function ingestPostcardVideo(db: ScoutDb, input: PostcardInput): Promise<IngestResult> {
  if (!input.videoUrl) throw new ScoutIntegrationError("video_url is required for a video.", 400);
  const clip = await fetchPostcardVideo(input.videoUrl);

  const ownerId = await loadOwnerUserId(db);
  const eventId = await ensureScoutRoadEvent(db, ownerId);
  const sectionId = await ensureGigSection(db, eventId, input);

  const imageId = randomUUID();
  const filename = `${imageId}.mp4`;
  const r2Key = buildImageKey(eventId, filename);
  const stagingKey = scoutStagingKey(imageId);

  let rowWritten = false;
  const rollback = async (why: string) => {
    if (rowWritten) {
      const { error } = await db.from("images").delete().eq("id", imageId);
      if (error) {
        await reportSystemError("scout.ingest-video.rollback-row", error, { imageId, why });
        const { error: markErr } = await db
          .from("images")
          .update({ processing_status: "failed" })
          .eq("id", imageId);
        if (markErr) await reportSystemError("scout.ingest-video.rollback-mark", markErr, { imageId });
        return;
      }
    }
    // Original (the silent copy, if Modal got that far) + posters.
    const failed = await deleteImageAssets(r2Key, "video");
    if (failed.length) {
      await reportSystemError("scout.ingest-video.rollback-r2", new Error("R2 delete failed"), { imageId, failed, why });
    }
  };

  await uploadToR2(stagingKey, clip, "video/mp4");
  try {
    let silent: Awaited<ReturnType<typeof processMutedVideoViaModal>>;
    let storedBytes: number;
    try {
      silent = await processMutedVideoViaModal(stagingKey, r2Key, { userId: ownerId, eventId });
      if (!silent.ok) {
        throw new ScoutIntegrationError(silent.error ?? "The clip could not be read as H.264 video.", 415);
      }
      if ((silent.durationSeconds ?? 0) > SCOUT_VIDEO_MAX_SECONDS + DURATION_SLACK_S) {
        throw new ScoutIntegrationError(
          `The clip runs ${silent.durationSeconds} s; the longest is ${SCOUT_VIDEO_MAX_SECONDS} s.`,
          400
        );
      }
      storedBytes = await assertStoredClipIsSilent(r2Key);
    } catch (err) {
      await rollback(err instanceof Error ? err.message : String(err));
      throw err;
    }

    try {
      const { error: insErr } = await db.from("images").insert({
        id: imageId,
        event_id: eventId,
        filename,
        original_filename: postcardFilename(input.postcardId, "video"),
        r2_key: r2Key,
        file_size: storedBytes,
        mime_type: "video/mp4",
        media_type: "video",
        parsed_name: null,
        processing_status: "pending",
      });
      if (insErr) throw insErr;
      rowWritten = true;

      const { error: claimErr } = await db.from("scout_postcard_links").insert({
        postcard_id: input.postcardId,
        image_id: imageId,
        event_id: eventId,
        section_id: sectionId,
        gig_id: input.gigId,
        author_email: input.authorEmail,
      });
      const outcome = claimOutcome(claimErr);
      if (outcome === "lost") {
        await rollback("lost the claim race");
        const winner = await requireLink(db, input.postcardId);
        return { link: winner, created: false, status: await statusOf(db, winner.image_id), aiIndexRequested: null };
      }
      if (outcome === "error") throw claimErr;

      const { data: tail, error: tailErr } = await db
        .from("section_images")
        .select("sort_order")
        .eq("section_id", sectionId)
        .order("sort_order", { ascending: false })
        .limit(1);
      if (tailErr) throw tailErr;
      const { error: linkErr } = await db
        .from("section_images")
        .insert({ section_id: sectionId, image_id: imageId, sort_order: (tail?.[0]?.sort_order ?? -1) + 1 });
      if (linkErr) throw linkErr;

      // The same fields the video/uploaded job stores, except has_audio,
      // which describes the STORED file: silent, proven above.
      const { error: updErr } = await db
        .from("images")
        .update({
          duration_seconds: silent.durationSeconds,
          has_audio: false,
          width: silent.width,
          height: silent.height,
          thumbnail_generated: true,
          processing_status: "complete",
          processing_error: null,
          ...(input.takenAt ? { taken_at: new Date(input.takenAt).toISOString() } : {}),
        })
        .eq("id", imageId);
      if (updErr) throw updErr;
    } catch (err) {
      await rollback(err instanceof Error ? err.message : String(err));
      throw err;
    }
  } finally {
    // The only copy with sound. Never left behind on purpose; a failed delete
    // is reported with its key so it can be removed by hand.
    try {
      await deleteFromR2(stagingKey);
    } catch (err) {
      await reportSystemError("scout.ingest-video.staging-delete", err, { stagingKey });
    }
  }

  const link = await requireLink(db, input.postcardId);
  return { link, created: true, status: "ready", aiIndexRequested: null };
}

/**
 * Read back what the pipeline stored and check its tracks with our own parser.
 * Returns the stored size. Throws (and the caller rolls back) on any audio
 * track, on no video track, or on a file that cannot be read: "could not
 * check" is never "silent".
 */
export async function assertStoredClipIsSilent(
  r2Key: string,
  read: (key: string) => Promise<Buffer> = readStoredClip
): Promise<number> {
  const bytes = await read(r2Key);
  let kinds: string[];
  try {
    kinds = mp4TrackKinds(bytes);
  } catch (err) {
    throw new ScoutIntegrationError(`The silent copy could not be checked: ${err instanceof Error ? err.message : err}`, 502);
  }
  if (kinds.includes("soun")) {
    throw new ScoutIntegrationError("The pipeline's copy still has an audio track; nothing was filed.", 502);
  }
  if (!kinds.includes("vide")) {
    throw new ScoutIntegrationError("The pipeline's copy has no video track; nothing was filed.", 502);
  }
  return bytes.byteLength;
}

async function readStoredClip(r2Key: string): Promise<Buffer> {
  const url = new URL(await getPresignedDownloadUrl(r2Key, 600));
  // Muting only removes streams, so the copy is never larger than the clip.
  return fetchCapped(url, { maxBytes: POSTCARD_VIDEO_MAX_BYTES }, "the silent copy");
}

async function storeExif(db: ScoutDb, imageId: string, buffer: Buffer, takenAt: string | null) {
  try {
    const exif = await extractExif(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
    );
    const update: Record<string, unknown> = {};
    // EXIF wins; Scout's zoned instant fills in when the phone stripped it.
    if (exif?.takenAt) update.taken_at = exif.takenAt;
    else if (takenAt) update.taken_at = new Date(takenAt).toISOString();
    if (exif?.cameraMake) update.camera_make = exif.cameraMake;
    if (exif?.cameraModel) update.camera_model = exif.cameraModel;
    if (exif?.lens) update.lens = exif.lens;
    if (exif?.focalLength) update.focal_length = exif.focalLength;
    if (exif?.aperture) update.aperture = exif.aperture;
    if (exif?.shutterSpeed) update.shutter_speed = exif.shutterSpeed;
    if (exif?.iso) update.iso = exif.iso;
    if (exif?.gpsLat != null) update.gps_lat = exif.gpsLat;
    if (exif?.gpsLng != null) update.gps_lng = exif.gpsLng;
    if (!Object.keys(update).length) return;
    const { error } = await db.from("images").update(update).eq("id", imageId);
    if (error) throw error;
  } catch (err) {
    await reportSystemError("scout.ingest.exif", err, { imageId });
  }
}

// ── GET /postcards/:id ─────────────────────────────────────────────────────

async function loadImageState(db: ScoutDb, imageId: string) {
  const { data, error } = await db
    .from("images")
    .select("id, processing_status, ai_indexed_at, ai_index_attempts, aesthetic_score, thumbnail_generated, media_type")
    .eq("id", imageId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ScoutIntegrationError("The postcard's photo no longer exists.", 404);
  return data;
}

async function statusOf(db: ScoutDb, imageId: string): Promise<PostcardStatus> {
  return postcardStatus(await loadImageState(db, imageId));
}

export interface PostcardDetail {
  status: PostcardStatus;
  media_type: "photo" | "video";
  image_id: string;
  aesthetic_score: number | null;
  crew: CrewInPhoto[];
  published_target: string | null;
  published_at: string | null;
}

export async function postcardDetail(db: ScoutDb, postcardId: string): Promise<PostcardDetail> {
  const link = await requireLink(db, postcardId);
  const image = await loadImageState(db, link.image_id);
  const status = postcardStatus(image);

  let crew: CrewInPhoto[] = [];
  // A clip has no detected faces (the face lane reads images), so no crew.
  if (status === "ready" && image.media_type !== "video") {
    const ownerId = await loadOwnerUserId(db);
    const { data: candidates, error } = await db.rpc("scout_image_crew_candidates", {
      p_image_id: link.image_id,
      p_user_id: ownerId,
      p_per_face: 3,
    });
    if (error) throw error;
    const rows = candidates ?? [];
    const crewIds = [...new Set(rows.map((r) => r.crew_id))];
    const roster = new Map<string, CrewRosterEntry>();
    if (crewIds.length) {
      const { data: people, error: crewErr } = await db
        .from("crew")
        .select("id, display_name, primary_email")
        .eq("user_id", ownerId)
        .in("id", crewIds);
      if (crewErr) throw crewErr;
      for (const p of people ?? []) roster.set(p.id, p);
    }
    crew = pickCrewMatches(rows, roster);
  }

  return {
    status,
    media_type: image.media_type === "video" ? "video" : "photo",
    image_id: link.image_id,
    aesthetic_score: image.aesthetic_score ?? null,
    crew,
    published_target: link.published_target,
    published_at: link.published_at,
  };
}

// ── publish / unpublish ────────────────────────────────────────────────────

async function websiteSectionFor(db: ScoutDb, ownerId: string, target: string) {
  const { sectionId } = await getWebsiteSection(db, ownerId, target);
  const { data, error } = await db
    .from("sections")
    .select("id, name, locked")
    .eq("id", sectionId)
    .single();
  if (error) throw error;
  return data;
}

/** Re-sync the public lane; a copy or delete that failed is an error, not a footnote. */
async function syncOrThrow(db: ScoutDb, imageId: string, what: string) {
  const sync = await syncSitePublication(db, [imageId]);
  if (sync.failed.length) {
    throw new ScoutIntegrationError(
      `${what}: the website copy did not ${what === "publish" ? "land" : "go"} (R2). Retry the request.`,
      502
    );
  }
}

async function removeFromTarget(db: ScoutDb, ownerId: string, imageId: string, target: string) {
  const section = await websiteSectionFor(db, ownerId, target);
  if (section.locked) {
    throw new ScoutIntegrationError(`"${section.name}" is locked in Pixeltrunk; unlock it to remove photos.`, 423);
  }
  const { error } = await db
    .from("section_images")
    .delete()
    .eq("section_id", section.id)
    .eq("image_id", imageId);
  if (error) throw error;
}

export async function publishPostcard(db: ScoutDb, postcardId: string, target: ScoutPublishTarget) {
  const link = await requireLink(db, postcardId);
  const image = await loadImageState(db, link.image_id);
  if (image.processing_status !== "complete" || !image.thumbnail_generated) {
    throw new ScoutIntegrationError("The photo is still being archived; publish it once it is ready.", 409);
  }
  const ownerId = await loadOwnerUserId(db);

  // Check the NEW scene before touching the old one, so a refusal leaves the
  // photo exactly where it was.
  const section = await websiteSectionFor(db, ownerId, target);
  if (section.locked) {
    throw new ScoutIntegrationError(`"${section.name}" is locked in Pixeltrunk; unlock it to add photos.`, 423);
  }

  // One scene at a time: moving targets takes it off the old one. The sync
  // below reconciles both memberships in one pass.
  if (link.published_target && link.published_target !== target) {
    await removeFromTarget(db, ownerId, link.image_id, link.published_target);
  }
  const { data: tail, error: tailErr } = await db
    .from("section_images")
    .select("sort_order")
    .eq("section_id", section.id)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (tailErr) throw tailErr;
  const { error: upErr } = await db
    .from("section_images")
    .upsert(
      { section_id: section.id, image_id: link.image_id, sort_order: (tail?.[0]?.sort_order ?? -1) + 1 },
      { onConflict: "section_id,image_id", ignoreDuplicates: true }
    );
  if (upErr) throw upErr;

  // Membership IS publication: this copies the public variants and schedules
  // the same debounced TDP_SITE_REVALIDATE_URL ping as /api/site/gallery.
  await syncOrThrow(db, link.image_id, "publish");

  const publishedAt = new Date().toISOString();
  const { error: markErr } = await db
    .from("scout_postcard_links")
    .update({ published_target: target, published_at: publishedAt })
    .eq("postcard_id", postcardId);
  if (markErr) throw markErr;
  return { published_target: target, published_at: publishedAt, image_id: link.image_id };
}

export async function unpublishPostcard(db: ScoutDb, postcardId: string) {
  const link = await requireLink(db, postcardId);
  if (!link.published_target) return { published_target: null, changed: false };
  const ownerId = await loadOwnerUserId(db);
  await removeFromTarget(db, ownerId, link.image_id, link.published_target);
  await syncOrThrow(db, link.image_id, "unpublish");
  const { error } = await db
    .from("scout_postcard_links")
    .update({ published_target: null, published_at: null })
    .eq("postcard_id", postcardId);
  if (error) throw error;
  return { published_target: null, changed: true };
}

// ── DELETE /postcards/:id ──────────────────────────────────────────────────

/**
 * Scout deleted the postcard. Unpublish first (so no public copy outlives the
 * row), then follow the editor's section-scoped delete (`partitionSectionDelete`):
 * if a person has also filed the photo in another, non-website section, only
 * the Scout Road copy goes and the photo stays where they put it; otherwise the
 * row is hard-deleted with its whole R2 footprint (`deleteImageAssets`).
 */
export async function deletePostcard(db: ScoutDb, postcardId: string) {
  const link = await requireLink(db, postcardId);
  const imageId = link.image_id;

  const { data: memberships, error: memErr } = await db
    .from("section_images")
    .select("section_id, sections!inner(name, locked, site_scene_key, is_auto)")
    .eq("image_id", imageId);
  if (memErr) throw memErr;
  const rows = (memberships ?? []) as unknown as {
    section_id: string;
    sections: { name: string; locked: boolean; site_scene_key: string | null; is_auto: boolean };
  }[];

  const locked = rows.filter((r) => r.sections.locked);
  if (locked.length) {
    throw new ScoutIntegrationError(
      `Nothing deleted: the photo is in locked section(s) ${locked.map((r) => `"${r.sections.name}"`).join(", ")}.`,
      423
    );
  }

  const { data: img, error: imgErr } = await db
    .from("images")
    .select("r2_key, media_type, site_published_at")
    .eq("id", imageId)
    .maybeSingle();
  if (imgErr) throw imgErr;

  // 1. Off the website, everywhere it appears. The sync runs whenever the row
  // says it is published, not only when a membership was just removed: a
  // retry after a failed sync finds no memberships left, and skipping the sync
  // then would orphan the public copy forever once the row is gone.
  const websiteSectionIds = rows.filter((r) => r.sections.site_scene_key).map((r) => r.section_id);
  if (websiteSectionIds.length) {
    const { error } = await db
      .from("section_images")
      .delete()
      .eq("image_id", imageId)
      .in("section_id", websiteSectionIds);
    if (error) throw error;
  }
  if (websiteSectionIds.length || img?.site_published_at) {
    await syncOrThrow(db, imageId, "unpublish");
  }

  // 2. Kept elsewhere by a PERSON? Then only the Scout Road copy goes. A
  // section the sorter made (`is_auto`) is not a person's filing.
  const elsewhere = rows.filter(
    (r) => !r.sections.site_scene_key && !r.sections.is_auto && r.section_id !== link.section_id
  );
  if (elsewhere.length) {
    if (link.section_id) {
      const { error } = await db
        .from("section_images")
        .delete()
        .eq("image_id", imageId)
        .eq("section_id", link.section_id);
      if (error) throw error;
    }
    const { error: linkErr } = await db.from("scout_postcard_links").delete().eq("postcard_id", postcardId);
    if (linkErr) throw linkErr;
    return { deleted: false, removed_from_scout_road: true, kept_in_sections: elsewhere.length };
  }

  // 3. The last copy: hard delete, then the whole R2 footprint.
  const { error: delErr } = await db.from("images").delete().eq("id", imageId); // cascades the link
  if (delErr) throw delErr;
  if (img?.r2_key) {
    const failed = await deleteImageAssets(img.r2_key, img.media_type);
    if (failed.length) {
      // The row is gone; the orphaned keys are recorded so the sweep can find them.
      await reportSystemError("scout.delete.r2", new Error("R2 delete failed"), { imageId, failed });
    }
  }
  return { deleted: true, removed_from_scout_road: true, kept_in_sections: 0 };
}

