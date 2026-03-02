import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getPresignedDownloadUrl } from "@/lib/r2/client";
import archiver from "archiver";

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

  // Check PIN protection for bulk download
  if (share.require_pin_bulk && share.download_pin) {
    const pinParam = request.nextUrl.searchParams.get("pin");
    if (!pinParam || pinParam !== share.download_pin) {
      return NextResponse.json(
        { error: "PIN required" },
        { status: 403 }
      );
    }
  }

  // 2. Fetch images
  let imagesQuery = supabase
    .from("images")
    .select("id, r2_key, original_filename")
    .eq("event_id", share.event_id)
    .neq("processing_status", "error");

  if (share.share_type === "selection" && share.image_ids?.length) {
    imagesQuery = imagesQuery.in("id", share.image_ids);
  }

  const { data: images } = await imagesQuery.order("created_at", {
    ascending: true,
  });

  if (!images || images.length === 0) {
    return NextResponse.json(
      { error: "No images available" },
      { status: 404 }
    );
  }

  // 3. Fetch event name for ZIP filename
  const { data: event } = await supabase
    .from("events")
    .select("name")
    .eq("id", share.event_id)
    .single();

  const zipFilename = `${(event?.name || "gallery")
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .replace(/\s+/g, "-")}.zip`;

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

        // Use original filename, handle duplicates
        const filename = img.original_filename;

        // Read the response as an ArrayBuffer and add to archive
        const buffer = await response.arrayBuffer();
        archive.append(Buffer.from(buffer), { name: filename });
      }

      await archive.finalize();
    } catch (err) {
      console.error("ZIP streaming error:", err);
      archive.abort();
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipFilename}"`,
    },
  });
}
