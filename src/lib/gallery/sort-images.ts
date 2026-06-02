/**
 * Shared image sort, used by BOTH the editor and the public gallery so
 * "Filename"/"Date taken"/"Latest" mean the SAME thing everywhere. Previously
 * each view had its own comparator and they drifted — the editor sorted
 * "Filename" by parsedName, the public by originalFilename, so the same section
 * showed a different order in each. Single source of truth, unit-tested.
 */

export type SortBy = "upload" | "filename" | "date-taken";

/** Minimal shape needed to sort — both ImageData and GalleryImage satisfy it. */
export interface SortableImage {
  originalFilename: string;
  takenAt?: string | null;
  createdAt?: string;
}

export function sortImages<T extends SortableImage>(images: T[], sortBy: SortBy): T[] {
  const sorted = [...images];
  switch (sortBy) {
    case "filename":
      // Always the ACTUAL filename (not an AI-parsed name). Plain
      // lexicographic, case-insensitive — matches the public gallery's
      // existing order (e.g. "181108…" before "2DUD…", since '1' < '2').
      // Deliberately NOT numeric-aware: numeric collation would compare the
      // leading numbers (2 vs 181108) and reorder them, diverging from what
      // clients already see.
      sorted.sort((a, b) =>
        (a.originalFilename || "").localeCompare(b.originalFilename || "", undefined, {
          sensitivity: "base",
        })
      );
      break;
    case "date-taken":
      sorted.sort((a, b) => {
        const at = a.takenAt || "";
        const bt = b.takenAt || "";
        if (!at && !bt) return 0;
        if (!at) return 1; // undated photos sink to the end
        if (!bt) return -1;
        return at.localeCompare(bt);
      });
      break;
    case "upload":
    default:
      // "Latest"/upload order = the server's created_at order; if createdAt is
      // present, sort by it ascending to be explicit, else keep input order.
      if (sorted.every((i) => i.createdAt)) {
        sorted.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
      }
      break;
  }
  return sorted;
}
