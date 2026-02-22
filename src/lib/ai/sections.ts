import { createServiceClient } from "@/lib/supabase/server";

/**
 * Auto-generate gallery sections based on AI scene tags.
 *
 * Images can appear in multiple sections (overlapping).
 * Sections are ordered by timeline (first appearance of tagged images).
 *
 * For a wedding, this might produce:
 *   "Getting Ready" → "Ceremony" → "Portraits" → "Reception" → "Speeches" → "First Dance"
 *
 * For a headshot event:
 *   Sections by person name (alphabetical) instead of scenes.
 */
export async function generateAutoSections(eventId: string) {
  const supabase = createServiceClient();

  // Get event type to determine sectioning strategy
  const { data: event } = await supabase
    .from("events")
    .select("event_type")
    .eq("id", eventId)
    .single();

  if (event?.event_type === "headshot") {
    return generateHeadshotSections(eventId);
  }

  return generateSceneSections(eventId);
}

/**
 * Generate sections by scene tags for event photography.
 */
async function generateSceneSections(eventId: string) {
  const supabase = createServiceClient();

  // Get all processed images with their scene tags and timestamps
  const { data: images, error } = await supabase
    .from("images")
    .select("id, scene_tags, taken_at, aesthetic_score")
    .eq("event_id", eventId)
    .eq("processing_status", "complete")
    .not("scene_tags", "is", null)
    .order("taken_at", { ascending: true, nullsFirst: false });

  if (error) throw error;
  if (!images || images.length === 0) return;

  // Count tag frequency and find earliest timestamp per tag
  const tagStats = new Map<
    string,
    { count: number; firstSeen: string | null; imageIds: string[] }
  >();

  for (const img of images) {
    if (!img.scene_tags) continue;

    for (const tag of img.scene_tags) {
      if (!tagStats.has(tag)) {
        tagStats.set(tag, { count: 0, firstSeen: img.taken_at, imageIds: [] });
      }
      const stat = tagStats.get(tag)!;
      stat.count++;
      stat.imageIds.push(img.id);
    }
  }

  // Filter: only create sections for tags with 3+ images
  const meaningfulTags = [...tagStats.entries()]
    .filter(([, stat]) => stat.count >= 3)
    .sort((a, b) => {
      // Sort by first appearance time, then by count
      if (a[1].firstSeen && b[1].firstSeen) {
        return a[1].firstSeen.localeCompare(b[1].firstSeen);
      }
      return b[1].count - a[1].count;
    });

  // Clean up existing auto sections
  await supabase
    .from("sections")
    .delete()
    .eq("event_id", eventId)
    .eq("is_auto", true);

  // Create sections
  for (let i = 0; i < meaningfulTags.length; i++) {
    const [tag, stat] = meaningfulTags[i];

    const displayName = formatSectionName(tag);

    const { data: section, error: sectionError } = await supabase
      .from("sections")
      .insert({
        event_id: eventId,
        name: displayName,
        sort_order: i,
        is_auto: true,
        filter_query: tag,
      })
      .select("id")
      .single();

    if (sectionError) throw sectionError;

    // Link images to this section
    const sectionImages = stat.imageIds.map((imageId, idx) => ({
      section_id: section.id,
      image_id: imageId,
      sort_order: idx,
    }));

    // Insert in batches of 500
    for (let j = 0; j < sectionImages.length; j += 500) {
      const batch = sectionImages.slice(j, j + 500);
      await supabase.from("section_images").insert(batch);
    }
  }
}

/**
 * Generate sections by person for headshot events.
 * Creates alphabetical sections (A, B, C...) or by individual person.
 */
async function generateHeadshotSections(eventId: string) {
  const supabase = createServiceClient();

  // Get all persons for this event, ordered by name
  const { data: persons, error } = await supabase
    .from("persons")
    .select("id, name, face_count")
    .eq("event_id", eventId)
    .order("name");

  if (error) throw error;
  if (!persons || persons.length === 0) return;

  // Clean up existing auto sections
  await supabase
    .from("sections")
    .delete()
    .eq("event_id", eventId)
    .eq("is_auto", true);

  // Group by first letter for alphabetical sections
  const letterGroups = new Map<string, typeof persons>();

  for (const person of persons) {
    const letter = (person.name?.[0] || "#").toUpperCase();
    if (!letterGroups.has(letter)) {
      letterGroups.set(letter, []);
    }
    letterGroups.get(letter)!.push(person);
  }

  const sortedLetters = [...letterGroups.keys()].sort();

  for (let i = 0; i < sortedLetters.length; i++) {
    const letter = sortedLetters[i];
    const groupPersons = letterGroups.get(letter)!;

    const { data: section, error: sectionError } = await supabase
      .from("sections")
      .insert({
        event_id: eventId,
        name: letter,
        sort_order: i,
        is_auto: true,
      })
      .select("id")
      .single();

    if (sectionError) throw sectionError;

    // Get all images for these persons (via face → person mapping)
    const personIds = groupPersons.map((p: { id: string }) => p.id);
    const { data: faces } = await supabase
      .from("faces")
      .select("image_id")
      .in("person_id", personIds);

    if (faces) {
      const uniqueImageIds = [...new Set(faces.map((f: { image_id: string }) => f.image_id))];
      const sectionImages = uniqueImageIds.map((imageId, idx) => ({
        section_id: section.id,
        image_id: imageId,
        sort_order: idx,
      }));

      for (let j = 0; j < sectionImages.length; j += 500) {
        const batch = sectionImages.slice(j, j + 500);
        await supabase.from("section_images").insert(batch);
      }
    }
  }
}

/** Convert a scene tag to a display-friendly section name */
function formatSectionName(tag: string): string {
  return tag
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
