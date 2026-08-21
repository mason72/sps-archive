import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { timingSafeEqualStr } from "@/lib/shares/hash";
import { verifyDownloadToken } from "@/lib/shares/download-token";
import { checkAuthRateLimit } from "@/lib/security/rate-limit";
import { resolveShareImageScope } from "@/lib/gallery/share-scope";
import { downloadGateKind } from "@/lib/gallery/download-gate";

/**
 * Shared core for gallery ZIP downloads — used by the synchronous streaming
 * route (small galleries), the prepare/status endpoints, and the background
 * Inngest builder (large galleries). One implementation of share auth and
 * image selection so the three paths can never disagree about who may
 * download what.
 */

type DB = SupabaseClient<Database>;
export type ShareRow = Database["public"]["Tables"]["shares"]["Row"];

/**
 * Sync-stream ceiling. Under it, the request lambda streams the ZIP directly
 * (worst-case transport buffering stays far below the 2GB function memory —
 * the OOM we hit live buffered a ~4GB gallery). Over it, the download is
 * built by the background job into R2.
 */
export const SYNC_MAX_COUNT = 300;
export const SYNC_MAX_BYTES = 750 * 1024 * 1024;

/** How long a built ZIP (and its presigned links) stays valid. */
export const ZIP_JOB_TTL_HOURS = 24;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const safeFolder = (n: string) =>
  n.replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "-").trim() || "Section";

export interface DownloadScope {
  favorites?: boolean;
  /** Section id — download just this section. */
  section?: string;
  /** Explicit image ids (smart-stack "download all N"). */
  images?: string[];
  /** Label for explicit sets (person name) — filename only, not authz. */
  name?: string;
}

/** Parse a scope from URL search params (sync route) or a JSON body (prepare). */
export function scopeFrom(input: {
  favorites?: string | boolean | null;
  section?: string | null;
  images?: string | string[] | null;
  name?: string | null;
}): DownloadScope {
  const scope: DownloadScope = {};
  if (input.favorites === true || input.favorites === "true") scope.favorites = true;
  if (input.section) scope.section = input.section;
  const images =
    typeof input.images === "string"
      ? input.images.split(",").filter(Boolean)
      : Array.isArray(input.images)
      ? input.images.filter(Boolean)
      : [];
  if (!scope.section && images.length > 0) {
    scope.images = images;
    if (input.name) scope.name = input.name;
  }
  return scope;
}

export type DownloadAuthResult =
  | { ok: true; share: ShareRow }
  | { ok: false; status: number; message: string };

/**
 * Resolve a share by slug and run every download gate: active, unexpired,
 * downloads allowed, password cookie, PIN (download token preferred, raw PIN
 * honored as fallback, rate-limited).
 *
 * Which PIN gate applies comes from `downloadGateKind`: the bulk one ONLY for
 * the whole gallery of a full share; every subset (a person's stack, a section,
 * favorites, a picked selection, a curated share link) is gated like a single
 * photo. Pass the ZIP `scope`; `kind: "individual"` is the per-image route's
 * explicit override. Both PINs are the share's single `download_pin`; the
 * flags only decide which actions demand it, so one verified token satisfies
 * either.
 */
export async function authorizeShareDownload(
  supabase: DB,
  slug: string,
  opts: {
    cookieShareId: string | null;
    downloadToken: string | null;
    pin: string | null;
    ip: string;
    kind?: "individual";
    /** The ZIP scope being requested — decides bulk vs individual gate. */
    scope?: DownloadScope;
  }
): Promise<DownloadAuthResult> {
  const { data: share, error } = await supabase
    .from("shares")
    .select("*")
    .eq("slug", slug)
    .eq("is_active", true)
    .single();

  if (error || !share) {
    return { ok: false, status: 404, message: "Gallery not found" };
  }
  if (share.expires_at && new Date(share.expires_at) < new Date()) {
    return { ok: false, status: 410, message: "Link expired" };
  }
  const shareScope = resolveShareImageScope(share);
  // A share type nothing knows how to narrow exposes no images, so there is
  // nothing to authorize a download of (see share-scope).
  if (shareScope.kind === "none") {
    return { ok: false, status: 404, message: "Gallery not found" };
  }
  if (!share.allow_download) {
    return { ok: false, status: 403, message: "Downloads not allowed" };
  }
  if (share.password_hash && opts.cookieShareId !== share.id) {
    return { ok: false, status: 401, message: "Authentication required" };
  }

  const kind =
    opts.kind ??
    downloadGateKind({
      curated: shareScope.kind === "images",
      scope: opts.scope ?? {},
    });
  const pinRequired =
    kind === "individual"
      ? share.require_pin_individual
      : share.require_pin_bulk;

  // A share can carry the flag with no PIN set — the sidebar auto-generates
  // one, but the field can be cleared afterwards. Fail CLOSED: "a PIN is
  // required" plus "no PIN exists" means nobody may download, not everybody.
  // (The old `pinRequired && download_pin` read handed the asset to anyone.)
  // Such a share is already unusable — verify-pin 404s on a null pin — so
  // this turns a silent bypass into an honest, visible refusal.
  if (pinRequired && !share.download_pin) {
    return {
      ok: false,
      status: 403,
      message: "Downloads are locked — ask your photographer for the PIN",
    };
  }

  if (pinRequired && share.download_pin) {
    const tokenOk = opts.downloadToken
      ? verifyDownloadToken(opts.downloadToken, share.id)
      : false;
    if (!tokenOk) {
      if (!(await checkAuthRateLimit(supabase, "pin", slug, opts.ip))) {
        return {
          ok: false,
          status: 429,
          message: "Too many attempts — try again in a few minutes",
        };
      }
      if (!opts.pin || !timingSafeEqualStr(opts.pin, share.download_pin)) {
        return { ok: false, status: 403, message: "PIN required" };
      }
    }
  }

  return { ok: true, share };
}

export interface DownloadImage {
  id: string;
  r2_key: string;
  original_filename: string;
  file_size: number;
}

export type DownloadSelection = {
  images: DownloadImage[];
  totalBytes: number;
  /** Folder-per-section map for full-gallery ZIPs; empty for scoped ones. */
  sectionsByImage: Map<string, string[]>;
  zipFilename: string;
  eventUserId: string | null;
  /** Content hash of the selected image ids — the job cache key. */
  scopeKey: string;
};

export type SelectionResult =
  | ({ ok: true } & DownloadSelection)
  | { ok: false; status: number; message: string };

/**
 * The single definition of "which images this share is allowed to hand out":
 * the share's own event, thumbnail generated (the display gate), and whatever
 * `resolveShareImageScope` says the share exposes. Both the bulk ZIP and the
 * per-image download route build on this, so a foreign id can never resolve
 * through one path after being rejected by the other.
 *
 * A `none` scope must filter to NOTHING, never fall through to an unfiltered
 * query — that would hand an unknown share type the entire event, which is the
 * exact fail-open share-scope.ts exists to prevent.
 */
function shareImages(supabase: DB, share: ShareRow) {
  const q = supabase
    .from("images")
    .select("id, r2_key, original_filename, file_size")
    .eq("event_id", share.event_id)
    .eq("thumbnail_generated", true);
  const scope = resolveShareImageScope(share);
  if (scope.kind === "event") return q;
  return q.in("id", scope.kind === "images" ? scope.imageIds : []);
}

/**
 * Resolve ONE image a share may hand out. Returns null when the id isn't part
 * of this share — a foreign or undisplayable id is indistinguishable from a
 * missing one, by design.
 */
export async function selectShareImage(
  supabase: DB,
  share: ShareRow,
  imageId: string
): Promise<DownloadImage | null> {
  // Postgres rejects a malformed uuid with 22P02 — an ERROR, not an empty
  // result. Without this the caller's catch turns every junk id into a 500
  // plus a system_errors row, which is an unauthenticated way to flood the
  // alarm table and bury real failures. A bad id is simply not found.
  if (!UUID_RE.test(imageId)) return null;

  const { data, error } = await shareImages(supabase, share)
    .eq("id", imageId)
    .maybeSingle();
  // A Supabase error is a return value, not a throw — a 400 here would
  // otherwise read as "image not in this share" and 404 forever.
  if (error) throw error;
  return data ?? null;
}

/**
 * Resolve the exact image set for a scope. Every filter only NARROWS the
 * share's own event images, so foreign section/image ids simply don't match.
 */
export async function selectDownloadImages(
  supabase: DB,
  share: ShareRow,
  scope: DownloadScope
): Promise<SelectionResult> {
  // Paginate: a single select caps at 1000 rows and large events exceed it.
  // What the SHARE exposes (distinct from `scope`, which is what the guest
  // asked for). Re-resolved rather than inherited from the auth call: this
  // function is exported and the background ZIP builder calls it on its own.
  if (resolveShareImageScope(share).kind === "none") {
    return { ok: false, status: 404, message: "No images available" };
  }
  const allImages: DownloadImage[] = [];
  const IMG_PAGE = 1000;
  for (let off = 0; ; off += IMG_PAGE) {
    const { data: page } = await shareImages(supabase, share)
      .order("created_at", { ascending: true })
      .range(off, off + IMG_PAGE - 1);
    if (!page || page.length === 0) break;
    allImages.push(...page);
    if (page.length < IMG_PAGE) break;
  }

  if (allImages.length === 0) {
    return { ok: false, status: 404, message: "No images available" };
  }

  let images = allImages;
  let zipSuffix = "";
  let scopedFlat = false;

  if (scope.favorites) {
    const { data: favs } = await supabase
      .from("favorites")
      .select("image_id")
      .eq("share_id", share.id);
    const favSet = new Set((favs ?? []).map((f) => f.image_id));
    images = images.filter((img) => favSet.has(img.id));
    if (images.length === 0) {
      return { ok: false, status: 404, message: "No favorites selected" };
    }
    zipSuffix = "-favorites";
  }

  if (scope.section) {
    const { data: section } = await supabase
      .from("sections")
      .select("id, name")
      .eq("id", scope.section)
      .eq("event_id", share.event_id)
      .single();
    if (!section) {
      return { ok: false, status: 404, message: "Section not found" };
    }
    const memberIds = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data: links } = await supabase
        .from("section_images")
        .select("image_id")
        .eq("section_id", section.id)
        .range(from, from + 999);
      if (!links || links.length === 0) break;
      for (const l of links) memberIds.add(l.image_id);
      if (links.length < 1000) break;
    }
    images = images.filter((img) => memberIds.has(img.id));
    if (images.length === 0) {
      return { ok: false, status: 404, message: "No images in this section" };
    }
    zipSuffix = `-${safeFolder(section.name)}`;
    scopedFlat = true;
  } else if (scope.images?.length) {
    const requested = new Set(scope.images);
    images = images.filter((img) => requested.has(img.id));
    if (images.length === 0) {
      return { ok: false, status: 404, message: "No matching images" };
    }
    zipSuffix = `-${scope.name ? safeFolder(scope.name) : "selection"}`;
    scopedFlat = true;
  }

  // Folder-per-section layout only for full-gallery ZIPs — a one-section or
  // one-stack ZIP reads better flat.
  const sectionsByImage = new Map<string, string[]>();
  if (!scopedFlat) {
    const imageIds = images.map((i) => i.id);
    const { data: sectionRows } = await supabase
      .from("sections")
      .select("id, name")
      .eq("event_id", share.event_id);
    const sectionName = new Map(
      (sectionRows ?? []).map((s) => [s.id, s.name as string])
    );
    for (let from = 0; ; from += 1000) {
      const { data: links } = await supabase
        .from("section_images")
        .select("image_id, section_id")
        .in("image_id", imageIds)
        .range(from, from + 999);
      if (!links || links.length === 0) break;
      for (const l of links) {
        const folder = sectionName.get(l.section_id);
        if (!folder) continue;
        const arr = sectionsByImage.get(l.image_id);
        if (arr) arr.push(folder);
        else sectionsByImage.set(l.image_id, [folder]);
      }
      if (links.length < 1000) break;
    }
  }

  const { data: event } = await supabase
    .from("events")
    .select("name, user_id")
    .eq("id", share.event_id)
    .single();

  const zipFilename = `${(event?.name || "gallery")
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .replace(/\s+/g, "-")}${zipSuffix}.zip`;

  const totalBytes = images.reduce((sum, img) => sum + (img.file_size || 0), 0);

  // Content-addressed cache key: same share + same exact image set → same
  // job. Any gallery or favorites change produces different ids → rebuild.
  const scopeKey = createHash("sha256")
    .update(images.map((i) => i.id).join(","))
    .digest("hex")
    .slice(0, 24);

  return {
    ok: true,
    images,
    totalBytes,
    sectionsByImage,
    zipFilename,
    eventUserId: event?.user_id ?? null,
    scopeKey,
  };
}
