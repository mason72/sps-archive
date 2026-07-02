import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { createServiceClient } from "@/lib/supabase/server";
import { getPresignedDownloadUrl } from "@/lib/r2/client";
import archiver from "archiver";
import { logActivity } from "@/lib/analytics/log";
import { timingSafeEqualStr } from "@/lib/shares/hash";
import { checkAuthRateLimit, clientIp } from "@/lib/security/rate-limit";
import { reportSystemError } from "@/lib/monitoring/report";

// A full-gallery ZIP fetches every original from R2 — a 1500-photo event ran
// straight into Vercel's 300s default and got killed MID-STREAM, shipping a
// truncated (unexpandable) archive. 800s is the Fluid Compute ceiling; the
// parallel prefetch below is what actually keeps real galleries far under it.
export const maxDuration = 800;

/**
 * How many R2 fetches to keep in flight ahead of the ZIP append cursor.
 * Sequential fetching cost ~0.4s of latency PER FILE (that alone blew the
 * timeout at 1500+ files); a window of 8 hides that latency while keeping
 * at most ~8 image buffers in memory.
 */
const PREFETCH_WINDOW = 8;

/** Pause appending when archiver has this much buffered for a slow client. */
const BUFFER_HIGH_WATER = 64 * 1024 * 1024;

/** Fetch an image's bytes with a couple retries for transient R2/network blips. */
async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok && response.body) {
        return Buffer.from(await response.arrayBuffer());
      }
    } catch {
      // fall through to retry
    }
    // Small backoff before the next try (0, 250, 500ms).
    if (attempt < 2) await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
  }
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const supabase = createServiceClient();

  // 1. Resolve share
  const { data: share, error } = await supabase
    .from("shares")
    .select("*")
    .eq("slug", slug)
    .eq("is_active", true)
    .single();

  if (error || !share) {
    return NextResponse.json({ error: "Gallery not found" }, { status: 404 });
  }

  // Check expiration
  if (share.expires_at && new Date(share.expires_at) < new Date()) {
    return NextResponse.json({ error: "Link expired" }, { status: 410 });
  }

  // Check download allowed
  if (!share.allow_download) {
    return NextResponse.json(
      { error: "Downloads not allowed" },
      { status: 403 }
    );
  }

  // Check password protection (via auth cookie)
  if (share.password_hash) {
    const authCookie = request.cookies.get(`gallery_auth_${slug}`);
    if (!authCookie || authCookie.value !== share.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }
  }

  // Check PIN protection for bulk download (rate-limited — this endpoint is
  // just as brute-forceable as verify-pin)
  if (share.require_pin_bulk && share.download_pin) {
    if (!(await checkAuthRateLimit(supabase, "pin", slug, clientIp(request)))) {
      return NextResponse.json(
        { error: "Too many attempts — try again in a few minutes" },
        { status: 429 }
      );
    }
    const pinParam = request.nextUrl.searchParams.get("pin");
    if (!pinParam || !timingSafeEqualStr(pinParam, share.download_pin)) {
      return NextResponse.json(
        { error: "PIN required" },
        { status: 403 }
      );
    }
  }

  // 2. Fetch images — paginate so a >1000-photo gallery downloads ALL of them
  // (a single select caps at 1000 rows; without this the ZIP silently dropped
  // everything past the first 1000).
  const selectionIds =
    share.share_type === "selection" && share.image_ids?.length
      ? (share.image_ids as string[])
      : null;
  const allImages: { id: string; r2_key: string; original_filename: string }[] = [];
  {
    const IMG_PAGE = 1000;
    for (let off = 0; ; off += IMG_PAGE) {
      let q = supabase
        .from("images")
        .select("id, r2_key, original_filename")
        .eq("event_id", share.event_id)
        // Match the gallery's display gate: anything with a thumbnail is a real,
        // downloadable photo. (Was neq 'error' — a status value that never
        // exists, so it silently included everything; now explicit + consistent.)
        .eq("thumbnail_generated", true);
      if (selectionIds) q = q.in("id", selectionIds);
      const { data: page } = await q
        .order("created_at", { ascending: true })
        .range(off, off + IMG_PAGE - 1);
      if (!page || page.length === 0) break;
      allImages.push(...page);
      if (page.length < IMG_PAGE) break;
    }
  }

  if (!allImages || allImages.length === 0) {
    return NextResponse.json(
      { error: "No images available" },
      { status: 404 }
    );
  }

  const safeFolder = (n: string) =>
    n.replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "-").trim() || "Section";

  // 2a. Favorites-only download: keep just the favorited images for this share.
  const favoritesOnly = request.nextUrl.searchParams.get("favorites") === "true";
  let images = allImages;
  if (favoritesOnly) {
    const { data: favs } = await supabase
      .from("favorites")
      .select("image_id")
      .eq("share_id", share.id);
    const favSet = new Set((favs ?? []).map((f) => f.image_id));
    images = allImages.filter((img) => favSet.has(img.id));
    if (images.length === 0) {
      return NextResponse.json(
        { error: "No favorites selected" },
        { status: 404 }
      );
    }
  }

  // 2a-ii. Scoped downloads: a single section (?section=<id>) or an explicit
  // image set (?images=<id,...> — smart-stack "download all N"). Both only
  // ever narrow allImages, which is already scoped to this share's event, so
  // foreign ids simply don't match. Scoped ZIPs are flat (no section folders).
  const sectionParam = request.nextUrl.searchParams.get("section");
  const imagesParam = request.nextUrl.searchParams.get("images");
  let zipSuffix = favoritesOnly ? "-favorites" : "";
  let scopedFlat = false;

  if (sectionParam) {
    const { data: section } = await supabase
      .from("sections")
      .select("id, name")
      .eq("id", sectionParam)
      .eq("event_id", share.event_id)
      .single();
    if (!section) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 });
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
      return NextResponse.json(
        { error: "No images in this section" },
        { status: 404 }
      );
    }
    zipSuffix = `-${safeFolder(section.name)}`;
    scopedFlat = true;
  } else if (imagesParam) {
    const requested = new Set(imagesParam.split(",").filter(Boolean));
    images = images.filter((img) => requested.has(img.id));
    if (images.length === 0) {
      return NextResponse.json(
        { error: "No matching images" },
        { status: 404 }
      );
    }
    const label = request.nextUrl.searchParams.get("name");
    zipSuffix = `-${label ? safeFolder(label) : "selection"}`;
    scopedFlat = true;
  }

  // 2b. Build per-image section membership so the full-gallery ZIP can be
  // foldered by section. An image in multiple sections is placed in each.
  // Images in no section go to the root. Skipped for scoped downloads — a
  // one-section or one-stack ZIP reads better flat.
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
    // Page through links so large galleries aren't truncated at 1000.
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

  // 3. Fetch event name for ZIP filename
  const { data: event } = await supabase
    .from("events")
    .select("name, user_id")
    .eq("id", share.event_id)
    .single();

  const zipFilename = `${(event?.name || "gallery")
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .replace(/\s+/g, "-")}${zipSuffix}.zip`;

  // 4. Stream ZIP. `store: true` — photos are already compressed; deflate
  // just burns CPU in the hot loop for ~0% size win. The archive's Readable
  // side is adapted to a web stream (Readable.toWeb), which gives us real
  // backpressure — the old hand-rolled TransformStream bridge fired
  // writer.write() without awaiting it, so a slow client ballooned memory.
  const archive = archiver("zip", { store: true });

  archive.on("error", (err: Error) => {
    console.error("Archive error:", err);
  });

  // Fetch each image and add to archive (don't await - let it stream).
  // Fetches run PREFETCH_WINDOW ahead of the append cursor (appends stay in
  // order); sequentially, per-file latency alone exceeded the platform
  // timeout on big galleries. A per-image fetch failure must never silently
  // shrink the ZIP: we retry, and anything that still won't download is
  // recorded in a manifest appended to the archive so the client can SEE
  // what's missing instead of guessing.
  (async () => {
    const failed: string[] = [];
    const pending = new Map<number, Promise<Buffer | null>>();
    const fetchOne = async (img: { r2_key: string }) => {
      try {
        const url = await getPresignedDownloadUrl(img.r2_key, 3600);
        return url ? await fetchImageBuffer(url) : null;
      } catch {
        return null;
      }
    };
    try {
      for (let i = 0; i < images.length; i++) {
        for (let j = i; j < Math.min(i + PREFETCH_WINDOW, images.length); j++) {
          if (!pending.has(j)) pending.set(j, fetchOne(images[j]));
        }
        const buffer = await pending.get(i)!;
        pending.delete(i);
        const img = images[i];
        if (!buffer) {
          failed.push(img.original_filename);
          continue;
        }

        // If the client drains slower than R2 feeds us, archiver's internal
        // buffer grows without bound — hold appends until it drains. A
        // destroyed archive means the client went away: stop fetching.
        while (archive.readableLength > BUFFER_HIGH_WATER && !archive.destroyed) {
          await new Promise((r) => setTimeout(r, 50));
        }
        if (archive.destroyed) return;

        // Place the file in a folder per section it belongs to (in each, if
        // multiple); root if it belongs to none.
        const folders = sectionsByImage.get(img.id);
        if (folders && folders.length > 0) {
          for (const folder of folders) {
            archive.append(buffer, {
              name: `${safeFolder(folder)}/${img.original_filename}`,
            });
          }
        } else {
          archive.append(buffer, { name: img.original_filename });
        }
      }

      // Surface any drops: a manifest inside the ZIP + an admin alarm. The
      // client gets a complete-as-possible, VALID archive either way.
      if (failed.length > 0) {
        archive.append(
          `These ${failed.length} of ${images.length} photos couldn't be included ` +
            `and may need to be re-downloaded individually:\n\n${failed.join("\n")}\n`,
          { name: "_MISSING_FILES.txt" }
        );
        void reportSystemError(
          "gallery.download",
          `${failed.length}/${images.length} images failed to fetch`,
          { slug, shareId: share.id }
        );
      }

      await archive.finalize();
    } catch (err) {
      // A destroyed archive is a client-side cancel, not a system failure —
      // don't page the admin for someone closing their laptop mid-download.
      if (archive.destroyed) {
        console.warn("ZIP stream closed early (client canceled)");
        return;
      }
      console.error("ZIP streaming error:", err);
      void reportSystemError("gallery.download", err, { slug, shareId: share.id });
      // Finalize (not abort) so the client still receives a valid ZIP of
      // whatever was appended before the error, rather than a corrupt stream.
      try {
        await archive.finalize();
      } catch {
        archive.abort();
      }
    }
  })();

  // Log gallery download (fire and forget)
  if (event?.user_id) {
    logActivity({
      userId: event.user_id,
      action: "gallery_download",
      eventId: share.event_id,
      shareId: share.id,
      metadata: {
        imageCount: images.length,
        scope: favoritesOnly
          ? "favorites"
          : sectionParam
          ? "section"
          : imagesParam
          ? "selection"
          : "all",
      },
    });
  }

  return new Response(Readable.toWeb(archive) as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipFilename}"`,
    },
  });
}
