/**
 * What the archive sends BACK to SimplePhotoShare after AI processing —
 * sections, stacks, scene tags and aesthetic scores SPS can show in its own
 * gallery.
 *
 * Lives apart from the pull lane on purpose: this is the return leg, and the
 * only direction in which SPS is the consumer. Read by
 * `/api/sps/enhancements/[eventId]`, which SPS calls server-side (JWT or the
 * X-SPS-Key shared secret) — the one route under /api/sps that has no session
 * and is therefore public in middleware.
 *
 * Extracted from the deleted `import.ts` (2026-08-11), which paired it with an
 * importer built on the false premise that SPS and the archive share an R2
 * bucket. The importer is gone; see `pull-event.ts` for the one that moves bytes.
 */
import { createServiceClient } from "@/lib/supabase/server";
import type { ArchiveEnhancements } from "./types";

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
