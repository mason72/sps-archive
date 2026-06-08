/**
 * Manual (drag-to-reorder) ordering — the "Manual" sort mode.
 *
 * Unlike the comparator in sort-images.ts (which sorts a flat image list by an
 * intrinsic field), manual order is PER-SECTION and lives in
 * section_images.sort_order. The server delivers each section's members as an
 * already-ordered `imageIds` list; these helpers apply that order on the client
 * and derive the read-only "All Images" reflection. Pure + unit-tested, like
 * sortImages, so the editor and public gallery share one definition of "Manual".
 */

export interface ManualSection {
  /** sections.id */
  id: string;
  /** sections.sort_order — the section's position within the event. */
  sortOrder: number;
  /** Member image ids, already in section_images.sort_order order. */
  imageIds: string[];
}

/**
 * Order `images` by an explicit section id list (that section's manual order).
 * Any image not present in `orderedIds` sinks to the end, ordered by id so the
 * result is deterministic.
 */
export function orderBySectionManual<T extends { id: string }>(
  images: T[],
  orderedIds: string[]
): T[] {
  const rank = new Map<string, number>();
  orderedIds.forEach((id, i) => rank.set(id, i));
  const end = orderedIds.length;
  return [...images].sort((a, b) => {
    const ra = rank.get(a.id) ?? end;
    const rb = rank.get(b.id) ?? end;
    if (ra !== rb) return ra - rb;
    return a.id.localeCompare(b.id);
  });
}

/**
 * "All Images" read-only reflection of the per-section manual orders.
 *
 * Each image is placed by its PRIMARY section — the section with the lowest
 * sort_order that the image belongs to — then by its position within that
 * section. An image in several sections appears once (under its primary).
 * Images in no section sink to the end, ordered by id.
 */
export function orderByPrimarySection<T extends { id: string }>(
  images: T[],
  sections: ManualSection[]
): T[] {
  const ordered = [...sections].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)
  );

  const sectionRank = new Map<string, number>(); // image id -> primary section index
  const withinRank = new Map<string, number>(); // image id -> index within that section
  ordered.forEach((s, si) => {
    s.imageIds.forEach((id, ii) => {
      if (!sectionRank.has(id)) {
        sectionRank.set(id, si);
        withinRank.set(id, ii);
      }
    });
  });

  const end = ordered.length;
  return [...images].sort((a, b) => {
    const sa = sectionRank.get(a.id) ?? end;
    const sb = sectionRank.get(b.id) ?? end;
    if (sa !== sb) return sa - sb;
    const wa = withinRank.get(a.id) ?? 0;
    const wb = withinRank.get(b.id) ?? 0;
    if (wa !== wb) return wa - wb;
    return a.id.localeCompare(b.id);
  });
}
