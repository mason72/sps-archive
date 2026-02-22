import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { createServiceClient } from "@/lib/supabase/server";
import { getPresignedUploadUrl, buildImageKey } from "@/lib/r2/client";
import { parseFilename } from "@/lib/upload/parse-filename";

/**
 * POST /api/upload
 *
 * Generates presigned URLs for direct client-to-R2 uploads.
 * This avoids routing large files through our server.
 *
 * Request body:
 * {
 *   eventId: string,
 *   files: [{ name: string, type: string, size: number }]
 * }
 *
 * Response:
 * {
 *   uploads: [{
 *     imageId: string,
 *     uploadUrl: string,   // presigned R2 URL
 *     r2Key: string,
 *   }]
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { eventId, files } = body as {
      eventId: string;
      files: { name: string; type: string; size: number }[];
    };

    if (!eventId || !files?.length) {
      return NextResponse.json(
        { error: "eventId and files are required" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Verify event exists
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id")
      .eq("id", eventId)
      .single();

    if (eventError || !event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Generate presigned URLs and create image records
    const uploads = await Promise.all(
      files.map(async (file) => {
        const id = nanoid();
        const parsed = parseFilename(file.name);
        const uniqueFilename = `${id}.${parsed.extension}`;
        const r2Key = buildImageKey(eventId, uniqueFilename);

        // Create image record in pending state
        const { error: insertError } = await supabase.from("images").insert({
          id,
          event_id: eventId,
          filename: uniqueFilename,
          original_filename: file.name,
          r2_key: r2Key,
          file_size: file.size,
          mime_type: file.type,
          parsed_name: parsed.name,
          processing_status: "pending",
        });

        if (insertError) throw insertError;

        // Generate presigned upload URL
        const uploadUrl = await getPresignedUploadUrl(r2Key, file.type);

        return {
          imageId: id,
          uploadUrl,
          r2Key,
          originalFilename: file.name,
          parsedName: parsed.name,
        };
      })
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
