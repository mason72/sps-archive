import { isCuratedSectionName } from "./intake";
import { isAiLooksMeta } from "./ai-looks";

/**
 * What "Rebuild all sections" does to a section that already exists.
 *
 * One rule, shared by the preview (GET section-plan) and the apply (POST
 * auto-sections), so the dialog can only ever promise what the sort then does.
 *
 * Rebuild REPLACES every section except five kinds (Mason, 2026-10-09):
 *   - Highlights: curated picks, never discarded by a sort (re-picking is the
 *     Review button's job).
 *   - a locked section: the lock is the photographer's "hands off".
 *   - a smart section (`filter_query`): an AI query the photographer wrote.
 *   - a website-lane section (`site_scene_key`): membership there IS
 *     publication on the marketing site, so deleting one unpublishes photos.
 *   - AI Looks (`job_meta.kind = "ai-looks"`): the renders gathered by the AI
 *     Looks button. Its members are links, so a rebuild would not lose a photo
 *     by deleting it, but it would silently undo a click and the name sorter
 *     never recreates it (ai-looks.ts).
 *
 * Before this, only sections the sorter itself had made (`is_auto`) were
 * replaced, and everything else counted as "your own". That was wrong for the
 * ~600 migrated galleries: the Pixieset ingest files a gallery's sets as
 * ordinary sections, so Rebuild stacked A–L / M–W next to Pixieset's C–D /
 * K–M / J instead of replacing them, and the dialog had promised "3 sections".
 */
export interface RebuildCandidate {
  name: string;
  locked: boolean | null;
  filterQuery: string | null;
  siteSceneKey: string | null;
  /** `sections.job_meta`, raw; AI Looks is marked here. Omitted = null. */
  jobMeta?: unknown;
}

export type KeepReason = "highlights" | "locked" | "smart" | "site" | "ai-looks";

/** Why a section survives a rebuild, or null when it is replaced. */
export function rebuildKeepReason(s: RebuildCandidate): KeepReason | null {
  if (isCuratedSectionName(s.name)) return "highlights";
  if (s.locked) return "locked";
  if (s.filterQuery) return "smart";
  if (s.siteSceneKey) return "site";
  if (isAiLooksMeta(s.jobMeta)) return "ai-looks";
  return null;
}

/** One existing section as the preview endpoint reports it to the dialog. */
export interface ExistingSectionFate {
  id: string;
  name: string;
  imageCount: number;
  /** Why it survives the rebuild, or null when it is replaced. */
  keep: KeepReason | null;
}

/** Short label for the dialog's "kept" list. */
export const KEEP_REASON_LABEL: Record<KeepReason, string> = {
  highlights: "your picks",
  locked: "locked",
  smart: "smart section",
  site: "website",
  // Renders gathered by the AI Looks button; the dialog prints this after the
  // section's own name ("AI Looks · AI renders"), so it stays short like the rest.
  "ai-looks": "AI renders",
};
