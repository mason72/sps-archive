/**
 * The client logo, carried across with an SPS pull.
 *
 * SPS holds the logo a host set for the event's gallery header
 * (`events.header_image_url`) and sends it on the manifest as `logoUrl`
 * (contract change 2026-10-24). A pulled gallery starts with the mosaic cover
 * in Insert mode (`newGalleryCoverDefaults`), and Insert with no `logoKey`
 * draws a plain mosaic, so until this module existed Mason uploaded the same
 * logo again in Design > Cover after every import. This fetches the bytes and
 * stores them where that upload would have put them, so the Insert works on
 * the first open of the editor.
 *
 * Three rules:
 *
 *  1. **A logo that cannot be fetched never fails the pull.** It is branding,
 *     not a photo; the import's job is the photos. Every failure here is
 *     reported through `reportSystemError` and leaves `logoKey` unset, which
 *     is exactly the state the gallery was in before this module.
 *  2. **Bytes land before the row points at them** — same invariant as the
 *     photos. The R2 object is written first; `settings` is updated after.
 *  3. **The type is read from the BYTES.** SPS's URL may end in anything and
 *     its content-type header is a claim; `sniffImageMime` decides, with SVG
 *     (text, so unsniffable) accepted only when the document itself opens
 *     with an `<svg` element. Anything else is refused, because the key
 *     extension drives how the raster job and the editor load it.
 *
 * Writes `settings.cover.mosaic.logoKey` only. Never a display column, never
 * `processing_status` (CLAUDE.md: the AI/import lanes write their own columns).
 */
import type { createServiceClient } from "@/lib/supabase/server";
import { uploadToR2 } from "@/lib/r2/client";
import { sniffImageMime } from "@/lib/upload/media";
import { reportSystemError } from "@/lib/monitoring/report";
import { COVER_LOGO_EXTENSIONS, coverLogoKey } from "@/types/event-settings";
import type { Json } from "@/lib/supabase/database.types";

type SupabaseDB = ReturnType<typeof createServiceClient>;

/** Same cap as the Design > Cover upload: it is a logo, not a photo. */
export const LOGO_MAX_BYTES = 5 * 1024 * 1024;

/** The import click waits on this; a slow logo host must not hold it long. */
export const LOGO_FETCH_TIMEOUT_MS = 10_000;

export interface LogoBytes {
  bytes: Buffer;
  mime: string;
  ext: string;
}

/**
 * Which accepted cover-logo type these bytes are, or null when they are not
 * one. Raster types by magic number; SVG by reading the document head.
 */
export function classifyLogoBytes(
  bytes: Uint8Array,
  contentType: string | null | undefined
): { mime: string; ext: string } | null {
  const sniffed = sniffImageMime(bytes);
  if (sniffed && COVER_LOGO_EXTENSIONS[sniffed]) {
    return { mime: sniffed, ext: COVER_LOGO_EXTENSIONS[sniffed] };
  }
  if (sniffed) return null; // a real image, but not a type a logo may be (gif, tiff)

  // SVG is text. Accept it on the document, not on the header alone: a
  // `<svg` root (after an optional XML prolog, comments or a DOCTYPE) within
  // the first KB. The header is consulted only to refuse quickly when the
  // host says it is something else entirely.
  const header = (contentType ?? "").toLowerCase().split(";")[0].trim();
  if (header && !header.startsWith("image/svg") && !header.startsWith("text/") && header !== "application/xml") {
    return null;
  }
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("utf8").replace(/^﻿/, "");
  const stripped = head
    .replace(/<\?xml[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .trimStart();
  if (/^<svg[\s>]/i.test(stripped)) {
    return { mime: "image/svg+xml", ext: COVER_LOGO_EXTENSIONS["image/svg+xml"] };
  }
  return null;
}

/**
 * GET the logo and decide what it is. Throws on anything that is not a usable
 * logo (bad URL, non-2xx, over the cap, unrecognised bytes); the caller turns
 * the throw into a system error and moves on.
 */
export async function fetchSpsLogo(
  url: string,
  fetchImpl: typeof fetch = fetch
): Promise<LogoBytes> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("SPS logo URL is not a URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`SPS logo URL has an unsupported scheme: ${parsed.protocol}`);
  }

  const res = await fetchImpl(url, {
    signal: AbortSignal.timeout(LOGO_FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`SPS logo fetch returned ${res.status}`);
  }

  const declared = Number.parseInt(res.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > LOGO_MAX_BYTES) {
    throw new Error(`SPS logo is ${declared} bytes; cap is ${LOGO_MAX_BYTES}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0) throw new Error("SPS logo fetch returned no bytes");
  if (bytes.length > LOGO_MAX_BYTES) {
    throw new Error(`SPS logo is ${bytes.length} bytes; cap is ${LOGO_MAX_BYTES}`);
  }

  const kind = classifyLogoBytes(bytes, res.headers.get("content-type"));
  if (!kind) {
    throw new Error(
      `SPS logo is not an accepted image type (header ${res.headers.get("content-type") ?? "none"})`
    );
  }
  return { bytes, ...kind };
}

/** `settings` with the mosaic cover pointing at `logoKey`; everything else kept. */
export function withMosaicLogoKey(
  settings: Record<string, unknown>,
  logoKey: string
): Record<string, unknown> {
  const cover = (settings.cover ?? {}) as Record<string, unknown>;
  const mosaic = (cover.mosaic ?? {}) as Record<string, unknown>;
  return {
    ...settings,
    cover: { ...cover, mosaic: { ...mosaic, logoKey } },
  };
}

/**
 * Copy the SPS header logo onto a freshly created archive event.
 *
 * Call it once the event row exists and BEFORE the pull job is queued, with
 * the exact `settings` object that was inserted, so the update needs no
 * re-read and races nothing. Returns the settings now on the row — unchanged
 * when there was no logo or it could not be brought across. Never throws.
 */
export async function attachSpsCoverLogo(
  supabase: SupabaseDB,
  args: {
    eventId: string;
    spsEventId: string;
    settings: Record<string, unknown>;
    logoUrl: string | null | undefined;
  },
  deps: { fetchImpl?: typeof fetch } = {}
): Promise<{ settings: Record<string, unknown>; logoKey: string | null }> {
  const { eventId, spsEventId, settings, logoUrl } = args;
  if (!logoUrl) return { settings, logoKey: null };

  try {
    const logo = await fetchSpsLogo(logoUrl, deps.fetchImpl);
    const logoKey = coverLogoKey(eventId, logo.ext);

    // Rule 2: the object exists before any row names it.
    await uploadToR2(logoKey, logo.bytes, logo.mime);

    const next = withMosaicLogoKey(settings, logoKey);
    const { error } = await supabase
      .from("events")
      .update({ settings: next as Json })
      .eq("id", eventId);
    if (error) throw error;

    return { settings: next, logoKey };
  } catch (err) {
    // Rule 1. The URL is a public logo address, safe to record; the SPS token
    // never comes near this module.
    await reportSystemError("sps.pull-logo", err, { eventId, spsEventId, logoUrl });
    return { settings, logoKey: null };
  }
}
