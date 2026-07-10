import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getAuthUser } from "@/lib/auth/helpers";
import {
  buildImageKey,
  getPresignedUploadUrl,
} from "@/lib/r2/client";
import { parseFilename } from "@/lib/upload/parse-filename";
import { mediaTypeForMime, validateUploadFile } from "@/lib/upload/media";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * POST /api/upload
 *
 * Accepts file metadata, creates DB records, returns image IDs.
 * The actual file binary is uploaded via PUT /api/upload/[imageId].
 */
export async function POST(request: NextRequest) {
  let eventIdForReport: string | undefined;
  let fileCountForReport: number | undefined;
  try {
    const { supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const body = await request.json();
    const { eventId, sectionId, files, skipSection } = body as {
      eventId: string;
      sectionId?: string;
      files: { name: string; type: string; size: number }[];
      /**
       * Cover-image uploads set this: the image is stored for use as the gallery
       * cover ONLY and must NOT join a section (so it never shows in the grid /
       * "All Images"). Deliberately bypasses the no-orphans invariant below —
       * a cover is not a gallery image.
       */
      skipSection?: boolean;
    };

    eventIdForReport = eventId;
    fileCountForReport = files?.length;

    if (!eventId || !files?.length) {
      return NextResponse.json(
        { error: "eventId and files are required" },
        { status: 400 }
      );
    }

    // Server-side guard on format + size (the dropzone enforces the same
    // rules client-side; this catches anything that bypasses it).
    for (const file of files) {
      const problem = validateUploadFile(file);
      if (problem) {
        return NextResponse.json({ error: problem }, { status: 400 });
      }
    }

    // Verify event exists
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id")
      .eq("id", eventId)
      .single();

    if (eventError || !event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Locked sections don't accept uploads — editing them must be deliberate.
    if (sectionId && !skipSection) {
      const { data: target } = await supabase
        .from("sections")
        .select("name, locked")
        .eq("id", sectionId)
        .maybeSingle();
      if (target?.locked) {
        return NextResponse.json(
          { error: `"${target.name}" is locked — unlock it to upload here.` },
          { status: 423 }
        );
      }
    }

    // INVARIANT: every image must belong to a real section — no orphans, ever.
    // "All Photos" is a derived view, not an upload target. When no section is
    // specified, resolve the event's default (first) section, creating a
    // "Highlights" section if the event somehow has none.
    // (Cover uploads opt out via skipSection — they are not gallery images.)
    let targetSectionId = sectionId;
    if (!skipSection && !targetSectionId) {
      const { data: firstSection } = await supabase
        .from("sections")
        .select("id")
        .eq("event_id", eventId)
        .order("sort_order", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (firstSection) {
        targetSectionId = firstSection.id;
      } else {
        const { data: created, error: createErr } = await supabase
          .from("sections")
          .insert({
            event_id: eventId,
            name: "Highlights",
            sort_order: 0,
            is_auto: false,
          })
          .select("id")
          .single();
        if (createErr || !created) {
          throw createErr || new Error("Failed to create default section");
        }
        targetSectionId = created.id;
      }
    }

    if (!skipSection && !targetSectionId) {
      throw new Error("Could not resolve a target section for upload");
    }

    // Build all records
    const records = files.map((file) => {
      const id = randomUUID();
      const parsed = parseFilename(file.name);
      const uniqueFilename = `${id}.${parsed.extension}`;
      const r2Key = buildImageKey(eventId, uniqueFilename);
      return { id, parsed, uniqueFilename, r2Key, file };
    });

    // Batch insert all image records
    const { error: insertError } = await supabase.from("images").insert(
      records.map((r) => ({
        id: r.id,
        event_id: eventId,
        filename: r.uniqueFilename,
        original_filename: r.file.name,
        r2_key: r.r2Key,
        file_size: r.file.size,
        mime_type: r.file.type,
        media_type: mediaTypeForMime(r.file.type),
        parsed_name: r.parsed.name,
        processing_status: "pending",
      }))
    );

    if (insertError) throw insertError;

    // Link every image to the resolved section. If this fails, roll back the
    // image rows we just inserted so we never leave orphaned images behind.
    // Cover uploads (skipSection) intentionally create no link.
    if (!skipSection && targetSectionId) {
      const sectionIdForLinks = targetSectionId;
      const { error: linkError } = await supabase.from("section_images").insert(
        records.map((r, i) => ({
          section_id: sectionIdForLinks,
          image_id: r.id,
          sort_order: i,
        }))
      );
      if (linkError) {
        await supabase
          .from("images")
          .delete()
          .in(
            "id",
            records.map((r) => r.id)
          );
        throw linkError;
      }
    }

    // Generate presigned upload URLs so the browser uploads directly to R2
    // (bypasses the ~4.5MB Vercel request body limit). 4h expiry: URLs are
    // minted 50 at a time up front but drain 12 at a time, so in a multi-
    // thousand-file session a task can sit in the queue well past 1h — an
    // expired URL then fails the PUT with a 403 (the eBay HEADSHOTS incident).
    const uploads = await Promise.all(
      records.map(async (r) => ({
        imageId: r.id,
        r2Key: r.r2Key,
        uploadUrl: await getPresignedUploadUrl(r.r2Key, r.file.type, 14400),
        originalFilename: r.file.name,
        parsedName: r.parsed.name,
      }))
    );

    return NextResponse.json({ uploads, sectionId: targetSectionId });
  } catch (error) {
    console.error("Upload error:", error);
    await reportSystemError("upload.presign", error, { eventId: eventIdForReport, fileCount: fileCountForReport });
    return NextResponse.json(
      { error: "Failed to prepare upload" },
      { status: 500 }
    );
  }
}
