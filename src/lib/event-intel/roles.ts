/**
 * What a role IS — the one home for the vocabulary and its shape rule.
 *
 * Mason, 2026-08-15: "lead is more of an on/off thing while photographer,
 * stylist, MUA is 'select one of these'." The first build modelled all six as
 * one free multi-select, which allowed stylist AND photographer — impossible on
 * a real gig, and enforced in the API rather than only the UI because a UI rule
 * is not a rule.
 *
 * "digital tech" is gone: it never named a person, only a shift. The pair trade
 * off across the day and both do both.
 *
 * This lives in its own file because there are now THREE writers — the event
 * page's Intel tab, the confirm strip under the photos, and the create screen —
 * and a vocabulary re-declared per call site is a vocabulary that splits into
 * Photographer / photographer / Photog.
 */

export const DISCIPLINES = ["photographer", "stylist", "makeup artist"] as const;
export const KNOWN_ROLES = ["lead", ...DISCIPLINES] as const;

/**
 * Normalise a role set to the model: at most one discipline, plus an optional
 * `lead` flag. Unknown words are dropped rather than stored — free text is how
 * a pivot silently splits.
 *
 * When several disciplines arrive the LAST wins, which is what a picker does
 * when you change your mind.
 */
export function cleanRoles(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const asked = [...new Set(input.map((r) => String(r).toLowerCase().trim()))].filter((r) =>
    (KNOWN_ROLES as readonly string[]).includes(r)
  );
  const disciplines = asked.filter((r) => (DISCIPLINES as readonly string[]).includes(r));
  return [
    ...(asked.includes("lead") ? ["lead"] : []),
    ...(disciplines.length ? [disciplines[disciplines.length - 1]] : []),
  ];
}

/**
 * The subset a human has endorsed.
 *
 * Confirmation follows the roles the caller SENT and nothing else. A role they
 * just switched on is confirmed; a guess they left alone stays a guess — still
 * in `roles`, still shown dashed, still excluded from any tally. That is the
 * fix for clicking "lead" on Joey and silently blessing the machine's opinion
 * that he was also the photographer.
 *
 * Always a subset of `roles`: a confirmation of something not on the gig is not
 * a fact, it is a stale click.
 */
export function cleanConfirmedRoles(input: unknown, roles: string[]): string[] {
  if (!Array.isArray(input)) return roles;
  return [...new Set(input.map((r) => String(r).toLowerCase().trim()))].filter(
    (r) => (KNOWN_ROLES as readonly string[]).includes(r) && roles.includes(r)
  );
}
