/**
 * The "AI Looks" section: every AI render in a gallery, gathered into one tab
 * with a click (Mason, 2026-10-09: "how do I make a section that just shows
 * the AI images?").
 *
 * An AI render is a frame SimplePhotoShare generated from a guest's photo and
 * sent across with the pull. The archive marks it by ONE column,
 * `images.sps_source_image_id` (not null = a render; CLAUDE.md calls it "the
 * ONE filter if renders ever leave clustering"). Smart section cannot do this:
 * it is semantic search over what a photo shows, and a render looks like a
 * photo of the same person.
 *
 * `section_images` is a LINK table, so AI Looks ADDS a membership per render
 * and removes nothing: a render stays filed beside its person and also appears
 * here. The section is recognised by `job_meta.kind === "ai-looks"` (name is
 * the fallback for one made by hand), which is what lets "Rebuild all
 * sections" keep it (rebuild.ts) and lets a second click add only the renders
 * that landed since.
 */
export const AI_LOOKS_SECTION_NAME = "AI Looks";
export const AI_LOOKS_KIND = "ai-looks";

/** The `sections.job_meta` document an AI Looks section carries. */
export const AI_LOOKS_JOB_META = { kind: AI_LOOKS_KIND } as const;

/** True when a section's `job_meta` marks it as the AI Looks section. */
export function isAiLooksMeta(jobMeta: unknown): boolean {
  return (
    !!jobMeta &&
    typeof jobMeta === "object" &&
    (jobMeta as { kind?: unknown }).kind === AI_LOOKS_KIND
  );
}

/**
 * Is this the event's AI Looks section? The marker wins; the name is accepted
 * for a section a person made by hand before the button existed (names are
 * unique per event, case-insensitively, so the route would otherwise collide
 * with it on insert).
 */
export function isAiLooksSection(s: { name: string; jobMeta?: unknown }): boolean {
  if (isAiLooksMeta(s.jobMeta)) return true;
  return s.name.trim().toLowerCase() === AI_LOOKS_SECTION_NAME.toLowerCase();
}

/**
 * Which renders still need a link, with sort_order continuing after the
 * section's current members. Pure, so a second click is provably a no-op for
 * everything already there: `renderIds` is every render in the event (in the
 * order the route read them), `existing` is the section's current membership.
 */
export function planAiLooksLinks(
  renderIds: readonly string[],
  existing: readonly { imageId: string; sortOrder: number | null }[]
): { imageId: string; sortOrder: number }[] {
  const linked = new Set(existing.map((e) => e.imageId));
  let next = existing.reduce((max, e) => Math.max(max, e.sortOrder ?? -1), -1) + 1;
  const out: { imageId: string; sortOrder: number }[] = [];
  const seen = new Set<string>();
  for (const id of renderIds) {
    if (linked.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ imageId: id, sortOrder: next++ });
  }
  return out;
}
