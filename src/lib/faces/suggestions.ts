/**
 * People suggestions — surface disagreements between face identity (clusters)
 * and filename identity (labels), for the photographer to resolve with one
 * click. Suggest-only, always: nothing here mutates anything.
 *
 * Hard-won rules (Mason, 2026-08-10):
 *  - SOLO PORTRAITS ONLY for mislabels. A group photo carries several
 *    people's faces; flagging it from each person's cluster would ping-pong
 *    renames forever (Jenny → Sally → Jenny…). Group photos are FOUND via
 *    faces, never re-labeled.
 *  - NAME FAMILIES don't conflict. "Sami Hadouaj" vs "Sami Hadouaj Mundra"
 *    is a truncated export, not a different person — one name extending the
 *    other is agreement. The longer form instead produces a REFINEMENT
 *    suggestion (adopt the full name), because names get truncated, not
 *    invented.
 *  - Mislabels GROUP per (person, filed-as) pair — five photos misfiled the
 *    same way are one decision, not five rows.
 */

export interface SuggestionPerson {
  id: string;
  name: string | null;
  /** Member image ids (deduped). */
  imageIds: string[];
  faceCount: number;
}

export interface SuggestionImageMeta {
  parsedName: string | null;
  originalFilename: string;
}

export interface MislabelSuggestion {
  key: string;
  type: "mislabel";
  personId: string;
  personName: string;
  imageIds: string[];
  filedAs: string;
}

export interface MergeSuggestion {
  key: string;
  type: "merge";
  /** Smaller cluster — merges into `intoId`. */
  fromId: string;
  intoId: string;
  name: string;
}

export interface SplitSuggestion {
  key: string;
  type: "split";
  personId: string;
  personName: string | null;
  /** The two filename camps, larger first. */
  groups: { name: string; count: number; sampleImageId: string }[];
}

export interface RefinementSuggestion {
  key: string;
  type: "refine-name";
  personId: string;
  currentName: string;
  fullName: string;
  /** How many of the person's files carry the fuller name. */
  supportingCount: number;
}

/** Conflicting members above this share of the cluster suppress mislabels. */
const MISLABEL_MINORITY_CEILING = 0.2;
/** A fuller name needs at least this many supporting files to be suggested. */
const REFINEMENT_MIN_SUPPORT = 2;

import { filenameSplitGroups, sameNameFamily } from "./split";

export { sameNameFamily };

export function computeSuggestions(
  persons: SuggestionPerson[],
  imageMeta: Map<string, SuggestionImageMeta>,
  faceCountByImage: Map<string, number>,
  extractName: (filename: string) => string,
  personLike: (name: string) => boolean,
  dismissed: Set<string>
): {
  mislabels: MislabelSuggestion[];
  merges: MergeSuggestion[];
  refinements: RefinementSuggestion[];
  splits: SplitSuggestion[];
} {
  const mislabels: MislabelSuggestion[] = [];
  const refinements: RefinementSuggestion[] = [];
  const splits: SplitSuggestion[] = [];

  const filenameOf = new Map<string, string>();
  for (const [id, meta] of imageMeta) filenameOf.set(id, meta.originalFilename);

  // Split detection runs FIRST and for every person, named or not: a cluster
  // whose files form two strong non-family name camps is probably two people
  // (it's also exactly why consensus naming left it blank). When a split
  // fires, the person's mislabel/refinement cards are suppressed — the split
  // is the better explanation of the same disagreement.
  const splitFlagged = new Set<string>();
  for (const person of persons) {
    const camps = filenameSplitGroups(person.imageIds, filenameOf, extractName, personLike);
    if (!camps) continue;
    splitFlagged.add(person.id);
    const key = `split:${person.id}`;
    if (dismissed.has(key)) continue;
    splits.push({
      key,
      type: "split",
      personId: person.id,
      personName: person.name,
      groups: camps.map((c) => ({
        name: c.name,
        count: c.imageIds.length,
        sampleImageId: c.imageIds[0],
      })),
    });
  }

  for (const person of persons) {
    if (!person.name || splitFlagged.has(person.id)) continue;
    const personName = person.name.trim();
    const conflicts = new Map<string, { display: string; imageIds: string[] }>();
    const extensions = new Map<string, { display: string; count: number }>();
    let considered = 0;

    for (const imageId of person.imageIds) {
      // Solo portraits only — group photos are never rename candidates.
      if ((faceCountByImage.get(imageId) ?? 0) !== 1) continue;
      const meta = imageMeta.get(imageId);
      if (!meta) continue;
      const fileClaim = extractName(meta.originalFilename).trim();
      // A fuller FILENAME form is refinement evidence regardless of any
      // accepted fix — the filename outlives parsed_name edits, and names
      // get truncated, not invented.
      if (
        fileClaim &&
        sameNameFamily(fileClaim, personName) &&
        fileClaim.length > personName.length
      ) {
        const k = fileClaim.toLowerCase();
        const cur = extensions.get(k) ?? { display: fileClaim, count: 0 };
        cur.count += 1;
        extensions.set(k, cur);
      }
      // A family-matching parsedName is the accepted-fix marker. Raw
      // parsedName is otherwise NOT the signal — upload-time parsing keeps
      // event tokens ("Katie Zeff Appfolio"). The filename extraction is the
      // same parser cluster auto-naming trusts.
      if (meta.parsedName && sameNameFamily(meta.parsedName, personName)) {
        considered += 1;
        continue;
      }
      if (!fileClaim) continue;
      considered += 1;
      if (sameNameFamily(fileClaim, personName)) continue;
      if (personLike(fileClaim)) {
        const k = fileClaim.toLowerCase();
        const cur = conflicts.get(k) ?? { display: fileClaim, imageIds: [] };
        cur.imageIds.push(imageId);
        conflicts.set(k, cur);
      }
    }

    // Refinement: adopt the best-supported fuller name.
    let bestExt: { display: string; count: number } | null = null;
    for (const ext of extensions.values()) {
      if (!bestExt || ext.count > bestExt.count) bestExt = ext;
    }
    if (bestExt && bestExt.count >= REFINEMENT_MIN_SUPPORT) {
      const key = `refine:${person.id}:${bestExt.display.toLowerCase()}`;
      if (!dismissed.has(key)) {
        refinements.push({
          key,
          type: "refine-name",
          personId: person.id,
          currentName: personName,
          fullName: bestExt.display,
          supportingCount: bestExt.count,
        });
      }
    }

    if (!considered || conflicts.size === 0) continue;
    const conflictTotal = [...conflicts.values()].reduce((s, c) => s + c.imageIds.length, 0);
    if (conflictTotal / considered > MISLABEL_MINORITY_CEILING) continue;
    for (const [filedKey, c] of conflicts) {
      const key = `mislabel:${person.id}:${filedKey}`;
      if (dismissed.has(key)) continue;
      mislabels.push({
        key,
        type: "mislabel",
        personId: person.id,
        personName,
        imageIds: c.imageIds,
        filedAs: c.display,
      });
    }
  }

  const merges: MergeSuggestion[] = [];
  const byName = new Map<string, SuggestionPerson[]>();
  for (const person of persons) {
    if (!person.name) continue;
    const k = person.name.trim().toLowerCase();
    const list = byName.get(k) ?? [];
    list.push(person);
    byName.set(k, list);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => b.faceCount - a.faceCount);
    const into = sorted[0];
    for (const from of sorted.slice(1)) {
      const key = `merge:${from.id}:${into.id}`;
      if (dismissed.has(key)) continue;
      merges.push({ key, type: "merge", fromId: from.id, intoId: into.id, name: into.name! });
    }
  }

  return { mislabels, merges, refinements, splits };
}
