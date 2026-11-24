import { SILENT_R2_MAX_DURATION_SECONDS } from "@/lib/stream/client";

/**
 * Input rules for the Scout integration routes. Pure: no I/O, so every rule
 * here has a test beside it.
 */

/** The website BTS scenes a postcard may be published to. One home for the list. */
export const SCOUT_PUBLISH_TARGETS = [
  "bts/headshot-booth",
  "bts/photo-booth",
  "bts/anti-booth",
] as const;
export type ScoutPublishTarget = (typeof SCOUT_PUBLISH_TARGETS)[number];

export function isScoutPublishTarget(v: unknown): v is ScoutPublishTarget {
  return typeof v === "string" && (SCOUT_PUBLISH_TARGETS as readonly string[]).includes(v);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar day as YYYY-MM-DD (2026-02-30 is refused). */
export function isDay(v: unknown): v is string {
  if (typeof v !== "string" || !DAY.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * An ISO instant that carries its own zone (Z or ±hh:mm). A bare local time
 * would be read in the server's zone, which is the capture-time bug of lesson
 * 165, so it is refused rather than guessed.
 */
export function isZonedInstant(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v)) return false;
  return !Number.isNaN(new Date(v).getTime());
}

export interface PostcardInput {
  postcardId: string;
  gigId: string;
  gigTitle: string;
  gigStart: string | null;
  takenAt: string | null;
  authorEmail: string | null;
  /** For a clip, the POSTER JPEG (still required, so the contract is one shape). */
  imageUrl: string;
  width: number | null;
  height: number | null;
  /** "photo" unless Scout sends media_type "video". */
  mediaType: "photo" | "video";
  /** The clip itself (video only). */
  videoUrl: string | null;
  /** Scout's measured length (video only); the pipeline's own probe is checked too. */
  durationS: number | null;
}

/**
 * Longest clip accepted, in seconds: Scout's own cap, and the R2 video lane's
 * limit for a silent clip, so nothing accepted can land on Stream.
 */
export const SCOUT_VIDEO_MAX_SECONDS = SILENT_R2_MAX_DURATION_SECONDS;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const posInt = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v > 0 && v < 100_000 ? v : null;

export function parsePostcardBody(body: unknown): Parsed<PostcardInput> {
  if (!body || typeof body !== "object") return { ok: false, error: "Body must be a JSON object." };
  const b = body as Record<string, unknown>;

  if (!isUuid(b.postcard_id)) return { ok: false, error: "postcard_id must be a uuid." };
  const gigId = str(b.gig_id);
  if (!gigId || gigId.length > 200) return { ok: false, error: "gig_id is required (1-200 characters)." };
  const gigTitle = str(b.gig_title);
  if (!gigTitle || gigTitle.length > 300) return { ok: false, error: "gig_title is required (1-300 characters)." };

  if (b.gig_start != null && !isDay(b.gig_start)) return { ok: false, error: "gig_start must be YYYY-MM-DD." };
  if (b.taken_at != null && !isZonedInstant(b.taken_at)) {
    return { ok: false, error: "taken_at must be an ISO instant with a zone (Z or ±hh:mm)." };
  }
  let authorEmail: string | null = null;
  if (b.author_email != null) {
    authorEmail = str(b.author_email).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authorEmail) || authorEmail.length > 320) {
      return { ok: false, error: "author_email is not an email address." };
    }
  }
  const imageUrl = str(b.image_url);
  if (!imageUrl) return { ok: false, error: "image_url is required." };
  if (b.width != null && posInt(b.width) == null) return { ok: false, error: "width must be a positive integer." };
  if (b.height != null && posInt(b.height) == null) return { ok: false, error: "height must be a positive integer." };

  // Photos are today's request, unchanged. A clip says so explicitly and
  // carries its own URL and length; a video field on a photo is refused
  // rather than ignored, so a half-wired sender fails at the first request.
  const mediaType = b.media_type == null || b.media_type === "photo" ? "photo" : b.media_type === "video" ? "video" : null;
  if (!mediaType) return { ok: false, error: 'media_type must be "photo" or "video".' };
  let videoUrl: string | null = null;
  let durationS: number | null = null;
  if (mediaType === "video") {
    videoUrl = str(b.video_url);
    if (!videoUrl) return { ok: false, error: "video_url is required for a video." };
    const url = checkImageUrl(videoUrl, "video_url");
    if (!url.ok) return { ok: false, error: url.error };
    if (typeof b.duration_s !== "number" || !Number.isFinite(b.duration_s) || b.duration_s <= 0) {
      return { ok: false, error: "duration_s must be a positive number of seconds for a video." };
    }
    if (b.duration_s > SCOUT_VIDEO_MAX_SECONDS) {
      return { ok: false, error: `duration_s is ${b.duration_s}; the longest clip is ${SCOUT_VIDEO_MAX_SECONDS} s.` };
    }
    durationS = b.duration_s;
  } else if (b.video_url != null || b.duration_s != null) {
    return { ok: false, error: 'video_url and duration_s are only for media_type "video".' };
  }

  return {
    ok: true,
    value: {
      postcardId: (b.postcard_id as string).toLowerCase(),
      gigId,
      gigTitle,
      gigStart: (b.gig_start as string | undefined) ?? null,
      takenAt: (b.taken_at as string | undefined) ?? null,
      authorEmail,
      imageUrl,
      width: posInt(b.width),
      height: posInt(b.height),
      mediaType,
      videoUrl,
      durationS,
    },
  };
}

/**
 * The one place Scout's image bytes may come from: Scout's own Supabase
 * Storage, by a signed URL. Anything else is refused, so this route cannot be
 * pointed at an internal address (SSRF) or an arbitrary host. A new Scout
 * storage host is a deliberate one-line change here, and fails loudly until then.
 */
export const SCOUT_STORAGE_HOST = "ezubznenjcogwocccznj.supabase.co";

export function checkImageUrl(raw: string, label = "image_url"): Parsed<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: `${label} is not a URL.` };
  }
  if (u.protocol !== "https:") return { ok: false, error: `${label} must be https.` };
  if (u.username || u.password) return { ok: false, error: `${label} must not carry credentials.` };
  if (u.hostname !== SCOUT_STORAGE_HOST || (u.port && u.port !== "443")) {
    return { ok: false, error: `${label} must be a Scout storage URL (${SCOUT_STORAGE_HOST}).` };
  }
  if (!u.pathname.startsWith("/storage/v1/object/")) {
    return { ok: false, error: `${label} must be a Supabase Storage object URL.` };
  }
  return { ok: true, value: u };
}

/** Longest window /gig-crew will read, in days (inclusive of both ends). */
export const GIG_CREW_MAX_DAYS = 120;

export function parseDayWindow(
  from: string | null,
  to: string | null
): Parsed<{ from: string; to: string }> {
  if (!isDay(from) || !isDay(to)) return { ok: false, error: "from and to must be YYYY-MM-DD." };
  if (from > to) return { ok: false, error: "from must not be after to." };
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > GIG_CREW_MAX_DAYS) {
    return { ok: false, error: `The window is ${days} days; the most is ${GIG_CREW_MAX_DAYS}.` };
  }
  return { ok: true, value: { from, to } };
}

/**
 * Names to try, in order, for a gig's section in the Scout Road gallery.
 * Section names are unique per gallery (case-insensitively) and gig titles
 * repeat ("Acme Headshots" every spring), so the date, then the gig id, tell
 * two of them apart. The last candidate carries the whole gig id, which is
 * unique by construction.
 */
export function gigSectionNames(gig: { gigId: string; gigTitle: string; gigStart: string | null }): string[] {
  const names = [gig.gigTitle];
  if (gig.gigStart) names.push(`${gig.gigTitle} · ${gig.gigStart}`);
  names.push(`${gig.gigTitle} · ${gig.gigId.slice(0, 8)}`, `${gig.gigTitle} · ${gig.gigId}`);
  return [...new Set(names)];
}

/** `sections.job_meta.kind` for a gig section in the Scout Road gallery. */
export const SCOUT_GIG_KIND = "scout-gig";

/**
 * True when a section's `job_meta` marks it as a Scout gig section. Read by
 * "Rebuild all sections" (rebuild.ts), which keeps these: each holds a gig's
 * postcards and is what `scout_postcard_links.section_id` points at.
 */
export function isScoutGigMeta(jobMeta: unknown): boolean {
  return (
    !!jobMeta &&
    typeof jobMeta === "object" &&
    (jobMeta as { kind?: unknown }).kind === SCOUT_GIG_KIND &&
    typeof (jobMeta as { scout_gig_id?: unknown }).scout_gig_id === "string"
  );
}

/** The private crew-BTS gallery every postcard is filed in (one section per gig). */
export const SCOUT_ROAD_SLUG = "scout-road";
export const SCOUT_ROAD_NAME = "Scout Road (crew BTS)";
