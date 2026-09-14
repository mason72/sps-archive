/**
 * A name that labels an EVENT is not a person, however person-shaped it is.
 *
 * Every file of a booth export parses to the job's name — "Google Booth",
 * 287 of 287 on Core SJC — and `looksLikePersonName` waves two capitalised
 * words through. Measured across the archive on 2026-09-02: 79 (event, name)
 * pairs where one name covers at least a tenth of an event with 100+ photos,
 * and every one is a label — studio watermark tags ("2Dudes WF"), clients
 * ("Bay, Alarm", "IAEE", "Kinder"), venues ("Dolores", "Marathon"), and the
 * two that looked like people ("Haley Neil", "Mason, Tang") turned out to be
 * couples' and party names over 271 and 39 face clusters. Real single-person
 * sittings run 30–60 frames (the largest, "Nachi", is 48), never 100+.
 *
 * Judged PER EVENT: "Grace" may label one school's day and be a real Grace
 * at a headshot day. A dominant name loses only the event it dominates.
 * Faces were considered and rejected as the discriminator — a photographer
 * or host in many frames makes one cluster large on a label event too.
 */

import { foldName, nameText } from "./name-text";

/** A name covering fewer photos than this is never a label, whatever its share. */
export const EVENT_LABEL_MIN_COUNT = 100;
/**
 * …and it must carry at least this share of the event's photos.
 *
 * Started at 0.5; lowered to 0.1 the same day for "eBayHR" — 348 of an
 * 1,842-photo day (19%), beside "ebayhr red/blue/yellow/green" at 317 each.
 * Re-measured at 0.1: the 23 pairs it adds are all labels (booth colours,
 * "STAFF", "SCHOOLF", "Marriot2", "awardsdinner"). The people it must keep
 * sit far below it — Steven Hughes is 184 of DAIS 26's 9,092 (2%), and no
 * real person reaches 100 frames AND a tenth of an event.
 */
export const EVENT_LABEL_MIN_SHARE = 0.1;

/**
 * `keyByRow`: each photo's (event, identity key). `totalByEvent`: how many
 * photos each event holds, named or not — the share is against the whole
 * event, or a set of unnamed camera frames would hide a label.
 * Returns eventId → keys that label that event.
 */
export function eventLabelKeys(
  keyByRow: Iterable<{ eventId: string; key: string }>,
  totalByEvent: ReadonlyMap<string, number>
): Map<string, Set<string>> {
  const counts = countByEventKey(keyByRow);
  const labels = new Map<string, Set<string>>();
  for (const [eventId, perEvent] of counts) {
    const total = totalByEvent.get(eventId) ?? 0;
    if (total === 0) continue;
    for (const [key, n] of perEvent) {
      if (n >= EVENT_LABEL_MIN_COUNT && n / total >= EVENT_LABEL_MIN_SHARE) {
        const set = labels.get(eventId) ?? new Set<string>();
        set.add(key);
        labels.set(eventId, set);
      }
    }
  }
  return labels;
}

/**
 * A SESSION label is a label too small to be caught by share: an event's
 * coverage exported one folder per session, "Guardant_Team-Spirit-Night_13.jpg",
 * "CEMA_Recep_0053.jpg", "eBay_HR_6503.jpg". Each parses to a person-shaped
 * name, and each session is a few percent of its event, so `eventLabelKeys`
 * never fires. Measured 2026-09-14: 26 cards, 1,111 photos (lesson 153).
 *
 * Complements `nameHasSessionWord` below, not a duplicate: that one reads the
 * NAME's vocabulary and catches dated labels ("Team Shots"); this one reads the
 * FILE's shape and catches sessions with no session word ("Guardant NSM GS",
 * "eBay HR", "Atlassian Braindates"). Together they overlap on 22 cards; this
 * rule alone adds 4.
 *
 * The file is one when ALL of these hold:
 * - no date anchor proves where a name ends (a dated file names its sitter);
 * - the filename's first `_`/`-` token is, as a whole, a word of the EVENT's
 *   name ("Guardant" in "Guardant Event Photos"). A person's file leads with
 *   their own name, usually fused ("KellyBottarini_063");
 * - that word is not a first name the archive already knows (`firstNameKeys`).
 *   This is what keeps "Kelly_Bottarini_001.jpg" in KELLY BOTTARINI'S
 *   HEADSHOTS, or "Julia_Chambers_01.jpg" in "CoStar Group // Julia & Tom":
 *   a gallery titled for its sitter shares her first name with the files.
 *
 * Rejected on measurement: "the name shares a word with its event" (73 cards,
 * Kelly Bottarini, Bill/Dinah/Steve and every "Amy Chime" among them), and
 * "several names in the event start with the same word" (604). Every miss is
 * fail-safe: a brand that is also a first name ("Jordan") stays on the wall,
 * one "Not a person" click away, rather than a person vanishing silently.
 */
export function isSessionLabelFile(
  originalFilename: string,
  eventName: string,
  knownFirstNames: ReadonlySet<string>,
  /** `nameBeforeDate(originalFilename)`, which the caller already computed. */
  datedName: string | null
): boolean {
  if (datedName) return false;
  const lead = wordKey(
    nameText(originalFilename.replace(/^\(AI\)\s*/i, "")).replace(/\.\w+$/, "").split(/[_-]/)[0]
  );
  if (lead.length < 2 || knownFirstNames.has(lead)) return false;
  return nameWordKeys(eventName).includes(lead);
}

/**
 * First-word keys of person-shaped names read from DATED filenames, where the
 * date proves where the name ends. Pass names already judged person-shaped.
 * A brand or session word never leads one: Guardant, Atlassian, CEMA and eBay
 * all count 0 across 213,114 rows; Julia 185, Kelly 223, Bill 67.
 */
export function firstNameKeys(personNames: Iterable<string>): Set<string> {
  const keys = new Set<string>();
  for (const name of personNames) {
    const first = nameWordKeys(name)[0];
    if (first) keys.add(first);
  }
  return keys;
}

/** Same folding as `normalizeNameKey` (index-people.ts imports this file). */
function wordKey(s: string): string {
  return foldName(s).replace(/[^a-z]/g, "");
}

function nameWordKeys(s: string): string[] {
  return nameText(s)
    .split(/[^\p{L}\p{M}]+/u)
    .map(wordKey)
    .filter((w) => w.length >= 2);
}

/** eventId → identity key → how many of that event's photos carry it. */
export function countByEventKey(
  keyByRow: Iterable<{ eventId: string; key: string }>
): Map<string, Map<string, number>> {
  const counts = new Map<string, Map<string, number>>();
  for (const { eventId, key } of keyByRow) {
    const perEvent = counts.get(eventId) ?? new Map<string, number>();
    perEvent.set(key, (perEvent.get(key) ?? 0) + 1);
    counts.set(eventId, perEvent);
  }
  return counts;
}

/**
 * A single-word name may be a person — "Nachi", "Sunita", "Leo" are real
 * sittings — but the same shape is also every tag a photographer types:
 * "untitled", "highlights", "MS", "twodudesphoto". Mason's call (2026-09-02):
 * admit them, with guardrails, and let the one-click "Not a person" exclusion
 * catch the brand or venue word that slips through. The guardrails are the
 * shapes tags take and people's names do not: digits, shouting, gallery
 * vocabulary, and volume — a person's sitting is tens of frames, and a
 * single word carrying more than that in one event is a label the share
 * rule was too small to catch.
 */
export const SINGLE_NAME_MAX_FRAMES_PER_EVENT = 60;

/** Section/gallery words that arrive as filenames and are nobody. */
const SINGLE_NAME_STOP = new Set([
  "untitled", "highlights", "highlight", "misc", "group", "groups", "family",
  "kids", "booth", "staff", "team", "event", "photo", "photos", "headshot",
  "headshots", "portrait", "portraits", "final", "finals", "edit", "edits",
  "raw", "web", "print", "prints", "test", "sample", "samples", "copy",
  "image", "images", "img", "dsc", "thumb", "cover", "logo", "bts", "crew",
  "wedding", "party", "dinner", "lunch", "ceremony", "reception", "guests",
  "guest", "candids", "candid", "detail", "details", "setup", "selects",
  "favorites", "favourites", "extra", "extras", "new", "old", "untagged",
]);

/**
 * Shape check only — the per-event frame cap is applied by the caller, which
 * holds the counts. Latin letters (accents included — "Zoë", "Łukasz"; the
 * key is folded Latin, see looksLikePersonName; with an apostrophe or hyphen
 * inside), three or more, not all-caps ("MS", "KARN" are codes; a shouted
 * real name is the price), not a gallery word.
 */
export function looksLikeSingleName(name: string): boolean {
  const w = nameText(name).trim();
  if (w.length < 3 || /\s/.test(w)) return false;
  if (!/^\p{Script=Latin}[\p{Script=Latin}\p{M}'’-]*[\p{Script=Latin}\p{M}]$/u.test(w)) return false;
  if (w === w.toUpperCase()) return false;
  return !SINGLE_NAME_STOP.has(w.toLowerCase());
}

/**
 * Words that make a multi-word name a SESSION label, not a person.
 *
 * Event coverage is often exported per session: "Guardant General Session"
 * (83), "Atlassian Breakouts" (92), "Team Shots" (79), "CEMA Recep" (78),
 * "Name Unknown" (53). Each passes `looksLikePersonName` and sits under the
 * 100-frame label floor, which cannot come down because a personal sitting is
 * the same size (Kelly Bottarini: 92 frames, all of her own gallery). The
 * vocabulary is the signal instead. Measured 2026-09-14 on the live wall: this
 * list matched 38 cards and every one was a label.
 *
 * Only words no one's name contains. "Booth" and "Gala" are real surnames and
 * are deliberately absent ("Dahairya Gala" may be Dhairya Gala); "Hall",
 * "Brand", "Holiday" and cities likewise. The single-word stoplist above is
 * NOT reused: it holds words like "new" and "old" that are harmless alone and
 * wrong as a veto on a two-word name.
 */
const MULTI_WORD_LABEL_WORDS = new Set([
  "session", "sessions", "breakout", "breakouts", "reception", "recep",
  "receptions", "keynote", "keynotes", "panel", "panels", "party", "parties",
  "afterparty", "highlights", "highlight", "candids", "candid", "stepandrepeat",
  "backdrop", "photobooth", "awards", "bts", "headshots", "group", "groups",
  "team", "shots", "unknown", "untitled", "welcome", "dinner", "lunch",
  "luncheon", "ceremony",
]);

/** A two-plus-word name carrying a session word ("Guardant Welcome Reception"). */
export function nameHasSessionWord(name: string): boolean {
  return nameText(name)
    .toLowerCase()
    .split(/[^\p{L}\p{M}]+/u)
    .some((w) => MULTI_WORD_LABEL_WORDS.has(w));
}
