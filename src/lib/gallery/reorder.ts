/**
 * Manual-order reordering when tiles can be STACKS as well as single images.
 *
 * The editor grid shows a person's frames as one stack tile, but the persisted
 * order is still one row per image (`section_images.sort_order`). So a drop is
 * computed over *item* ids and then expanded back to image ids, writing a
 * stack's members contiguously at the drop point.
 *
 * This lives outside the component because it is the step that can silently
 * corrupt a section: drop an image id and it vanishes from the gallery's order;
 * duplicate one and the sort becomes ambiguous. The invariant — output is
 * always a permutation of every image currently on screen — is worth a test.
 */

export interface ReorderInput {
  /** Item ids in current display order (stack ids and loose image ids). */
  ids: string[];
  /** Item id -> the image ids it stands for, in display order. */
  expand: (itemId: string) => string[];
  /** The item being dragged. */
  active: string;
  /** The item it was dropped on. */
  over: string | null;
  /**
   * Item ids moving together. A multi-selection of loose images moves as a
   * block; a stack always moves alone (it is already a block).
   */
  moveSet: string[];
}

/**
 * Returns the new flat image-id order, or null when the drop is a no-op
 * (no target, dropped on itself, or dropped onto a member of the move set).
 */
export function reorderWithStacks({
  ids,
  expand,
  active,
  over,
  moveSet,
}: ReorderInput): string[] | null {
  if (!over || over === active) return null;

  const set = moveSet.length > 0 ? moveSet : [active];
  const setLookup = new Set(set);
  if (setLookup.has(over)) return null;

  const remaining = ids.filter((id) => !setLookup.has(id));
  const insertAt = remaining.indexOf(over);
  if (insertAt === -1) return null;

  const nextItems = [
    ...remaining.slice(0, insertAt),
    ...set,
    ...remaining.slice(insertAt),
  ];
  return nextItems.flatMap(expand);
}
