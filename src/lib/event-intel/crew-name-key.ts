/**
 * The comparison key for "is this typed name someone already on the roster?"
 *
 * Letters and digits only, lower-cased, accents folded: "Sergio Gomez",
 * "sergio gomez " and "Sergio Gómez" are one person; so are "J. Smith" and
 * "JSmith". Deliberately loose — a duplicate roster row is the expensive
 * mistake here (a person with none of their history), and the picker shows
 * the match before anything is written, so a human sees who they are being
 * matched to. Used by apply-gig as the server-side backstop for the same rule.
 */
export function crewNameKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
