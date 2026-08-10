import { createServiceClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";
import type { SPSEventImport, ArchiveEnhancements } from "./types";

/**
 * Import an event from SPS into Archive.
 *
 * ⚠️ BROKEN PREMISE (verified 2026-08-10) — do not use this path until fixed.
 * It was written believing SPS and Archive share one R2 bucket, so images
 * needn't be copied: just point Archive rows at the same keys. SPS v2 actually
 * serves from its own lane (`pub-7363d57d….r2.dev`) while the archive reads
 * `sps-prism`; listing `sps-prism` under an SPS key prefix returns 0 objects.
 * Rows minted here would reference keys the archive cannot read — ghost tiles
 * (lessons #21–23, #54). A correct import must MOVE THE BYTES; note also that
 * SPS re-compresses on ingest (~⅓ the bytes at identical pixel dimensions), so
 * it is a lossy source for an archive that is meant to hold the good copy.
 * Working reference: `scripts/backfill-sps-fou26.ts`.
 *
 * Flow:
 *   1. SPS sends event + image metadata via API
 *   2. Archive creates event + image records (no file copy!)
 *   3. Archive triggers AI processing pipeline
 *   4. Once processed, Archive sends enhancements back to SPS
 *
 * @param data - Event and image metadata from SPS
 * @param userId - Authenticated user ID (validated by the API route)
 */
export async function importFromSPS(
  data: SPSEventImport,
  userId: string
): Promise<{ eventId: string }> {
  const supabase = createServiceClient();

  // Create the event
  const slug =
    data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") +
    "-" +
    Date.now().toString(36);

  const { data: event, error: eventError } = await supabase
    .from("events")
    .insert({
      user_id: userId,
      name: data.name,
      slug,
      description: data.description || null,
      event_date: data.date || null,
      event_type: data.eventType || null,
      settings: { spsEventId: data.spsEventId, source: "sps-import" },
    })
    .select("id")
    .single();

  if (eventError) throw eventError;

  // Create image records pointing to existing R2 keys (no file copy!)
  const imageInserts = data.images.map((img) => ({
    event_id: event.id,
    filename: img.r2Key.split("/").pop() || img.originalFilename,
    original_filename: img.originalFilename,
    r2_key: img.r2Key,
    file_size: img.fileSize,
    width: img.width || null,
    height: img.height || null,
    mime_type: img.mimeType,
    taken_at: img.metadata?.takenAt || null,
    camera_make: img.metadata?.camera || null,
    lens: img.metadata?.lens || null,
    processing_status: "pending" as const,
  }));

  // Insert in batches of 500
  for (let i = 0; i < imageInserts.length; i += 500) {
    const batch = imageInserts.slice(i, i + 500);
    const { error } = await supabase.from("images").insert(batch);
    if (error) throw error;
  }

  // Trigger AI processing for all imported images via Inngest
  await inngest.send({
    name: "event/imported",
    data: { eventId: event.id, imageCount: data.images.length },
  });

  return { eventId: event.id };
}

/**
 * Generate enhancements to send back to SPS after AI processing.
 */
export async function generateEnhancements(
  eventId: string,
  spsEventId: string
): Promise<ArchiveEnhancements> {
  const supabase = createServiceClient();

  // Get sections with their images
  const { data: sections } = await supabase
    .from("sections")
    .select("id, name")
    .eq("event_id", eventId)
    .order("sort_order");

  const sectionResults = [];
  for (const section of sections || []) {
    const { data: sectionImages } = await supabase
      .from("section_images")
      .select("image_id")
      .eq("section_id", section.id);
    sectionResults.push({
      name: section.name,
      imageIds: (sectionImages || []).map((si) => si.image_id),
    });
  }

  // Get stacks with their images
  const { data: stacks } = await supabase
    .from("stacks")
    .select("id, cover_image_id, person_id")
    .eq("event_id", eventId);

  const stackResults = [];
  for (const stack of stacks || []) {
    const { data: stackImages } = await supabase
      .from("images")
      .select("id")
      .eq("stack_id", stack.id);

    let personName: string | undefined;
    if (stack.person_id) {
      const { data: person } = await supabase
        .from("persons")
        .select("name")
        .eq("id", stack.person_id)
        .single();
      personName = person?.name || undefined;
    }

    stackResults.push({
      coverImageId: stack.cover_image_id || "",
      imageIds: (stackImages || []).map((i) => i.id),
      personName,
    });
  }

  // Get image enhancements
  const { data: images } = await supabase
    .from("images")
    .select("id, scene_tags, aesthetic_score, stack_id")
    .eq("event_id", eventId)
    .eq("processing_status", "complete");

  return {
    eventId,
    spsEventId,
    sections: sectionResults,
    stacks: stackResults,
    imageEnhancements: (images || []).map((img) => ({
      spsImageId: img.id,
      sceneTags: img.scene_tags || [],
      aestheticScore: img.aesthetic_score || 0,
    })),
  };
}
