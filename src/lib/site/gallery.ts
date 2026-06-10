import type { createServiceClient } from "@/lib/supabase/server";
import { SITE_SCENES } from "./scenes";

type SupabaseClient = ReturnType<typeof createServiceClient>;

/**
 * The dedicated "TDP Website" gallery — one event whose sections are the
 * site's content slots. Identified by slug; settings.website marks it so the
 * UI can special-case it later without string-matching the name.
 */
export const WEBSITE_EVENT_SLUG = "tdp-website";
export const WEBSITE_EVENT_NAME = "TDP Website";

/**
 * Find (or lazily create) the website gallery for this user, and make sure a
 * section exists for every registry scene. Idempotent — safe to call on every
 * "add to website" gesture; new registry entries materialize as sections on
 * first use, so adding a scene stays a one-line code change.
 */
export async function getOrCreateWebsiteGallery(
  supabase: SupabaseClient,
  userId: string
): Promise<{ id: string }> {
  let { data: gallery } = await supabase
    .from("events")
    .select("id")
    .eq("slug", WEBSITE_EVENT_SLUG)
    .eq("user_id", userId)
    .maybeSingle();

  if (!gallery) {
    const { data: created, error } = await supabase
      .from("events")
      .insert({
        user_id: userId,
        name: WEBSITE_EVENT_NAME,
        slug: WEBSITE_EVENT_SLUG,
        description:
          "Two Dudes Photo website content — each section is a slot on the site.",
        event_type: "website",
        settings: { website: true },
      })
      .select("id")
      .single();
    if (error) throw error;
    gallery = created;
  }

  await ensureWebsiteSections(supabase, gallery.id);

  return { id: gallery.id };
}

/**
 * Scaffold any registry scenes that don't have a section yet. Idempotent and
 * cheap when complete (one indexed read). Called when the website gallery is
 * created AND every time it's opened in the editor — since the globe picker
 * was retired this is what materializes newly registered scenes, keeping
 * "adding a scene is a one-line change" true.
 */
export async function ensureWebsiteSections(
  supabase: SupabaseClient,
  eventId: string
): Promise<void> {
  const { data: existing, error: sectionsError } = await supabase
    .from("sections")
    .select("site_scene_key")
    .eq("event_id", eventId)
    .not("site_scene_key", "is", null);
  if (sectionsError) throw sectionsError;

  const have = new Set((existing ?? []).map((s) => s.site_scene_key));
  const missing = SITE_SCENES.map((scene, i) => ({ scene, i })).filter(
    ({ scene }) => !have.has(scene.key)
  );

  if (missing.length > 0) {
    const { error: insertError } = await supabase.from("sections").insert(
      missing.map(({ scene, i }) => ({
        event_id: eventId,
        name: scene.label,
        // Registry order = section order in the gallery sidebar.
        sort_order: i,
        is_auto: false,
        site_scene_key: scene.key,
      }))
    );
    if (insertError) throw insertError;
  }
}

/**
 * The website-gallery section backing a scene key (gallery and section are
 * created on demand). Returns ids the caller needs to insert membership.
 */
export async function getWebsiteSection(
  supabase: SupabaseClient,
  userId: string,
  sceneKey: string
): Promise<{ eventId: string; sectionId: string }> {
  const { id: eventId } = await getOrCreateWebsiteGallery(supabase, userId);

  const { data: section, error } = await supabase
    .from("sections")
    .select("id")
    .eq("event_id", eventId)
    .eq("site_scene_key", sceneKey)
    .single();
  if (error || !section) {
    throw error ?? new Error(`Website section missing for scene: ${sceneKey}`);
  }

  return { eventId, sectionId: section.id };
}
