/**
 * Section-scoped delete semantics ("copies" mental model).
 *
 * Each section shows what reads as a copy of the photo. Deleting while a
 * section is open removes THAT copy; deleting the last copy deletes the
 * photo itself. One button, no separate "remove from section" gesture, and
 * the user never has to know the copies all reference one image.
 *
 * An image counts as deletable-from-section only when it is a member of the
 * CURRENT section AND has at least one membership elsewhere (any section of
 * any event — website sections included). Everything else falls through to a
 * permanent delete: last-copy images, and images not in the current section
 * at all (stale client state — treat the gesture as plain delete).
 */
export interface DeletePartition {
  /** Member of the current section with other memberships → unlink only. */
  removeFromSection: string[];
  /** Last copy (or not in this section) → delete the image permanently. */
  hardDelete: string[];
}

export function partitionSectionDelete(
  imageIds: string[],
  /** Total membership count per image id, across ALL sections. */
  membershipCounts: Map<string, number>,
  /** Image ids that are members of the current section. */
  currentSectionMembers: Set<string>
): DeletePartition {
  const removeFromSection: string[] = [];
  const hardDelete: string[] = [];
  for (const id of imageIds) {
    if (currentSectionMembers.has(id) && (membershipCounts.get(id) ?? 0) > 1) {
      removeFromSection.push(id);
    } else {
      hardDelete.push(id);
    }
  }
  return { removeFromSection, hardDelete };
}
