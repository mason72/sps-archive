/**
 * The "Unsorted" intake section — where a big upload lands so it never
 * pollutes Highlights (reserved for the photographer's curated/exported best-of).
 *
 * Lifecycle: seeded on event creation, and re-created on demand whenever a dump
 * has no explicit target. "Sort into sections" consumes it — the smart sections
 * cover every image, so the intake is deleted afterward. A later dump just makes
 * a fresh one. Highlights is NEVER an automatic upload target.
 */
export const INTAKE_SECTION_NAME = "Unsorted";
export const CURATED_SECTION_NAME = "Highlights";

/** The event's intake section id, matched by name (case-insensitive), or null. */
export function findIntakeSectionId(
  sections: { id: string; name: string }[]
): string | null {
  const want = INTAKE_SECTION_NAME.toLowerCase();
  return sections.find((s) => s.name.trim().toLowerCase() === want)?.id ?? null;
}
