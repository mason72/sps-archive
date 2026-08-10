/**
 * People suggestions — surface disagreements between face identity (clusters)
 * and filename identity (labels), for the photographer to resolve with one
 * click. Suggest-only, always: nothing here mutates anything.
 *
 * Born from a real case (2026-08-10): a headshot export filed one of Jenna's
 * photos as "Katie Zeff" — the cluster caught the mislabel. See tasks/todo.md.
 *
 * Two suggestion kinds:
 *  - mislabel: a NAMED person's member image whose effective name (parsedName
 *    else filename-extracted) disagrees with the person. Only flagged while
 *    conflicts are a small minority of the cluster (a mostly-disagreeing
 *    cluster means the CLUSTER name is the suspect, not the files).
 *  - merge: two named persons sharing a name — fragments of one human.
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
  imageId: string;
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

/** Conflicting members above this share of the cluster suppress mislabels. */
const MISLABEL_MINORITY_CEILING = 0.2;

export function computeSuggestions(
  persons: SuggestionPerson[],
  imageMeta: Map<string, SuggestionImageMeta>,
  extractName: (filename: string) => string,
  personLike: (name: string) => boolean,
  dismissed: Set<string>
): { mislabels: MislabelSuggestion[]; merges: MergeSuggestion[] } {
  const mislabels: MislabelSuggestion[] = [];

  for (const person of persons) {
    if (!person.name) continue;
    const personKey = person.name.trim().toLowerCase();
    const conflicts: { imageId: string; filedAs: string }[] = [];
    let considered = 0;
    for (const imageId of person.imageIds) {
      const meta = imageMeta.get(imageId);
      if (!meta) continue;
      // An exactly-matching parsedName is the accepted-fix marker (the
      // fix-label action writes it). Raw parsedName is otherwise NOT the
      // signal — upload-time parsing keeps event tokens ("Katie Zeff
      // Appfolio"), which would make every member look like a conflict. The
      // filename extraction is the same parser cluster auto-naming trusts.
      if (meta.parsedName?.trim().toLowerCase() === personKey) {
        considered += 1;
        continue;
      }
      const fileClaim = extractName(meta.originalFilename).trim();
      if (!fileClaim) continue;
      considered += 1;
      if (fileClaim.toLowerCase() !== personKey && personLike(fileClaim)) {
        conflicts.push({ imageId, filedAs: fileClaim });
      }
    }
    if (!considered || conflicts.length === 0) continue;
    if (conflicts.length / considered > MISLABEL_MINORITY_CEILING) continue;
    for (const c of conflicts) {
      const key = `mislabel:${c.imageId}:${person.id}`;
      if (dismissed.has(key)) continue;
      mislabels.push({
        key,
        type: "mislabel",
        personId: person.id,
        personName: person.name,
        imageId: c.imageId,
        filedAs: c.filedAs,
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

  return { mislabels, merges };
}
