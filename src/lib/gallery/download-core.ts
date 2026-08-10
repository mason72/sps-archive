import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { timingSafeEqualStr } from "@/lib/shares/hash";
import { verifyDownloadToken } from "@/lib/shares/download-token";
import { checkAuthRateLimit } from "@/lib/security/rate-limit";
import { resolveShareImageScope } from "@/lib/gallery/share-scope";

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
 * downloads allowed, password cookie, bulk PIN (download token preferred,
 * raw PIN honored as fallback, rate-limited).
 */
export async function authorizeShareDownload(
  supabase: DB,
  slug: string,
  opts: {
    cookieShareId: string | null;
    downloadToken: string | null;
    pin: string | null;
    ip: string;
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
  // A share type nothing knows how to narrow exposes no images, so there is
  // nothing to authorize a download of (see share-scope).
  if (resolveShareImageScope(share).kind === "none") {
    return { ok: false, status: 404, message: "Gallery not found" };
  }
  if (!share.allow_download) {
    return { ok: false, status: 403, message: "Downloads not allowed" };
  }
  if (share.password_hash && opts.cookieShareId !== share.id) {
    return { ok: false, status: 401, message: "Authentication required" };
  }

  if (share.require_pin_bulk && share.download_pin) {
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
  const shareScope = resolveShareImageScope(share);
  if (shareScope.kind === "none") {
    return { ok: false, status: 404, message: "No images available" };
  }
  const selectionIds = shareScope.kind === "images" ? shareScope.imageIds : null;
  const allImages: DownloadImage[] = [];
  const IMG_PAGE = 1000;
  for (let off = 0; ; off += IMG_PAGE) {
    let q = supabase
      .from("images")
      .select("id, r2_key, original_filename, file_size")
      .eq("event_id", share.event_id)
      // Display gate: anything with a thumbnail is a real, downloadable photo.
      .eq("thumbnail_generated", true);
    if (selectionIds) q = q.in("id", selectionIds);
    const { data: page } = await q
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
