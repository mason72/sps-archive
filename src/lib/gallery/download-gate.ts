/**
 * Which download PIN gate an action falls under.
 *
 * The "bulk" PIN guards taking the ENTIRE gallery — nothing else. A person's
 * stack, a section, favorites, a hand-picked selection, or a curated share
 * link (which is a handful of photos, not a gallery) are all subsets, and a
 * subset is gated the way single photos are: by `requirePinIndividual`.
 *
 * This used to be "any ZIP is bulk", so a guest opening one person's 18-shot
 * group from a PIN-gated headshot day hit the PIN wall on "Download all 18"
 * (Mason, 2026-08-21, client-side). Shared by the server routes and the
 * gallery client so the prompt and the refusal can never disagree.
 *
 * Pure and dependency-free on purpose: it is imported by a client component.
 */
export type DownloadGateKind = "bulk" | "individual";

export interface DownloadGateScope {
  favorites?: boolean | string | null;
  section?: string | null;
  images?: string | string[] | null;
}

/** True when the scope names nothing — i.e. "everything this share exposes". */
export function scopeIsWholeGallery(scope: DownloadGateScope): boolean {
  if (scope.favorites === true || scope.favorites === "true") return false;
  if (scope.section) return false;
  const images = scope.images;
  if (typeof images === "string" ? images.length > 0 : images?.length) return false;
  return true;
}

export function downloadGateKind(args: {
  /** The share is a curated selection, not a whole-gallery link. */
  curated: boolean;
  scope: DownloadGateScope;
}): DownloadGateKind {
  return !args.curated && scopeIsWholeGallery(args.scope) ? "bulk" : "individual";
}
