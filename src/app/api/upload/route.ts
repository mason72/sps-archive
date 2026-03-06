import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getAuthUser } from "@/lib/auth/helpers";
import {
  buildImageKey,
  getPresignedUploadUrl,
} from "@/lib/r2/client";
import { parseFilename } from "@/lib/upload/parse-filename";

/**
 * POST /api/upload
 *
 * Accepts file metadata, creates DB records, returns image IDs.
 * The actual file binary is uploaded via PUT /api/upload/[imageId].
 */
export async function POST(request: NextRequest) {
  try {
    const { supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const body = await request.json();
    const { eventId, sectionId, files } = body as {
      eventId: string;
      sectionId?: string;
      files: { name: string; type: string; size: number }[];
    };

    if (!eventId || !files?.length) {
      return NextResponse.json(
        { error: "eventId and files are required" },
        { status: 400 }
      );
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
        parsed_name: r.parsed.name,
        processing_status: "pending",
      }))
    );

    if (insertError) throw insertError;

    // If uploading to a section, assign images to it
    if (sectionId) {
      const sectionImageRows = records.map((r, i) => ({
        section_id: sectionId,
        image_id: r.id,
        sort_order: i,
      }));
      await supabase.from("section_images").insert(sectionImageRows);
    }

    // Generate presigned upload URLs so the browser uploads directly to R2
    // (bypasses the ~4.5MB Vercel request body limit)
    const uploads = await Promise.all(
      records.map(async (r) => ({
        imageId: r.id,
        r2Key: r.r2Key,
        uploadUrl: await getPresignedUploadUrl(r.r2Key, r.file.type, 3600),
        originalFilename: r.file.name,
        parsedName: r.parsed.name,
      }))
    );

    return NextResponse.json({ uploads });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Failed to prepare upload" },
      { status: 500 }
    );
  }
}
