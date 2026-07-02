import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getPresignedDownloadUrl } from "@/lib/r2/client";
import archiver from "archiver";
import { logActivity } from "@/lib/analytics/log";
import { timingSafeEqualStr } from "@/lib/shares/hash";
import { checkAuthRateLimit, clientIp } from "@/lib/security/rate-limit";

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

  // 2b. Build per-image section membership so the ZIP can be foldered by
  // section. An image in multiple sections is placed in each. Images in no
  // section go to the root. Section names are sanitized for use as folders.
  const imageIds = images.map((i) => i.id);
  const { data: sectionRows } = await supabase
    .from("sections")
    .select("id, name")
    .eq("event_id", share.event_id);
  const sectionName = new Map(
    (sectionRows ?? []).map((s) => [s.id, s.name as string])
  );
  const sectionsByImage = new Map<string, string[]>();
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
  const safeFolder = (n: string) =>
    n.replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "-").trim() || "Section";

  // 3. Fetch event name for ZIP filename
  const { data: event } = await supabase
    .from("events")
    .select("name, user_id")
    .eq("id", share.event_id)
    .single();

  const zipFilename = `${(event?.name || "gallery")
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .replace(/\s+/g, "-")}${favoritesOnly ? "-favorites" : ""}.zip`;

  // 4. Stream ZIP
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  const archive = archiver("zip", { zlib: { level: 1 } }); // Fast compression for photos

  // Pipe archive output to the writer
  archive.on("data", (chunk: Buffer) => {
    writer.write(chunk);
  });
  archive.on("end", () => {
    writer.close();
  });
  archive.on("error", (err: Error) => {
    console.error("Archive error:", err);
    writer.abort(err);
  });

  // Fetch each image and add to archive (don't await - let it stream)
  (async () => {
    try {
      for (const img of images) {
        const url = await getPresignedDownloadUrl(img.r2_key, 3600);
        if (!url) continue;

        const response = await fetch(url);
        if (!response.ok || !response.body) continue;

        const buffer = Buffer.from(await response.arrayBuffer());

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

      await archive.finalize();
    } catch (err) {
      console.error("ZIP streaming error:", err);
      archive.abort();
    }
  })();

  // Log gallery download (fire and forget)
  if (event?.user_id) {
    logActivity({
      userId: event.user_id,
      action: "gallery_download",
      eventId: share.event_id,
      shareId: share.id,
      metadata: { imageCount: images.length },
    });
  }

  return new Response(readable, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipFilename}"`,
    },
  });
}
