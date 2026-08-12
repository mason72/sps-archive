/**
 * Which images a share exposes to a guest — resolved in ONE place.
 *
 * Every guest-facing reader (gallery payload, cover, OG card, search,
 * selfie-search, downloads) has to answer the same question, and each one used
 * to answer it inline with `share.share_type === "selection" ? narrow : don't`.
 * That reads as a selection special-case, but its real meaning is "anything
 * that isn't a selection gets the WHOLE event" — so the `section` and `person`
 * types the DB check constraint has allowed since 001_initial_schema (with
 * `shares.section_id` / `shares.person_id` columns to match) would each have
 * served the entire archive. Nothing creates those today — POST /api/shares
 * only writes `full` or `selection` — so it was latent, not exploitable; found
 * in the 2026-08-10 pre-alpha audit and closed here before a writer appears.
 *
 * The rule: a share type this module does not explicitly know how to NARROW
 * resolves to `none`. Adding `section`/`person` support means adding a case
 * here, and until then those shares serve nothing rather than everything.
 */

/** The share fields scope depends on — narrower than the full row so partial
 *  selects (the cover route fetches four columns) satisfy it. */
export interface ShareScopeFields {
  share_type: string;
  image_ids: string[] | null;
}

export type ShareImageScope =
  /** Every displayable image in the share's event. */
  | { kind: "event" }
  /** Exactly these image ids, and nothing else. */
  | { kind: "images"; imageIds: string[] }
  /** Nothing. The share type is unknown, or its subset is empty. */
  | { kind: "none" };

export function resolveShareImageScope(share: ShareScopeFields): ShareImageScope {
  switch (share.share_type) {
    case "full":
      return { kind: "event" };
    case "selection": {
      const imageIds = (share.image_ids ?? []).filter(Boolean);
      // A selection with no ids is a curation of nothing, not a whole gallery.
      return imageIds.length > 0 ? { kind: "images", imageIds } : { kind: "none" };
    }
    default:
      return { kind: "none" };
  }
}

/**
 * The scope as an id filter: `null` means "don't filter" (whole event), a Set
 * means "only these". `none` yields an EMPTY set, so a caller that forgets the
 * explicit deny branch still filters everything out — the fail-closed behavior
 * survives the omission that caused this bug in the first place.
 */
export function shareScopeIdFilter(scope: ShareImageScope): Set<string> | null {
  if (scope.kind === "event") return null;
  return new Set(scope.kind === "images" ? scope.imageIds : []);
}

/** True when the share exposes no images at all — the 404/empty branch. */
export function shareScopeIsEmpty(scope: ShareImageScope): boolean {
  return scope.kind === "none";
}

/**
 * True when the photographer hand-picked what this share contains, rather than
 * handing over the whole gallery.
 *
 * Guest-facing surfaces use this to drop features that only make sense when
 * there is something to FIND. On a curated set the photographer already did the
 * finding, so offering face search there re-asks a question that is already
 * answered — and worse, implies there are more photos of you somewhere you
 * weren't given (Mason, 2026-08-12: "I sent this woman her ~12 images… it seems
 * unnecessary and maybe even weird").
 *
 * Deliberately derived from the SCOPE, not from a face count. Face count is a
 * proxy that gets it wrong in both directions: a couple's 12-image selection has
 * two faces and still needs no search, while a full gallery of one person's
 * headshot session has one face and is a genuine archive. Curation is the
 * photographer's explicit signal; that is the thing worth reading.
 */
export function shareScopeIsCurated(scope: ShareImageScope): boolean {
  return scope.kind === "images";
}
