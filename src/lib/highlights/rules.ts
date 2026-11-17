/**
 * What a Highlights set must never contain, and what it may contain only a
 * little of. The ONE home for these phrases and cutoffs.
 *
 * Why (2026-11-16): the Electronica 2026 auto-fill picked a robot dog (one
 * name-stack, about eight times in the cover mosaic), a mascot, black-and-white
 * frames, softbox / behind-the-scenes shots, backs of heads and a run of
 * hand-on-eyeglasses poses. Justin: "only humans, no shots in profile, no more
 * than 1-2 glasses holding shots, no b/w images, 1-3 group photos max".
 *
 * Each rule is a plain-English phrase scored against every photo's SigLIP
 * embedding (the model behind search), so nothing new is stored or computed at
 * upload. Cutoffs were set by LOOKING at the photos ranked around each one on
 * Electronica 2026 (4,964 photos; `scripts/triage/highlight-rules-probe.ts`,
 * `highlight-rules-band.ts`), not from the score distribution alone:
 *
 *   bw       RELATIVE to the event: 0.025 above the event's median score.
 *            On Electronica true black-and-white sits at 0.064-0.084 against a
 *            median of 0.032 (24 banned). A fixed 0.055 banned 2,559 of 3,429
 *            COLOR photos on LinkedIn Holiday Party 2016: a silver sequin
 *            photobooth backdrop reads as "black and white" to the model, and
 *            "black and white vs color" did not separate it either. Relative,
 *            that event bans 2, and Team Curry (median 0.087) bans 0. The rule
 *            catches the black-and-white edit in a color shoot, which is the
 *            complaint; a shoot delivered all in black and white keeps its look.
 *            The median, not a lower percentile: the 25th percentile measured
 *            worse (Team Curry 539 banned, LinkedIn 372).
 *            PLUS a per-capture test (`bwSiblings`): a photobooth that delivers
 *            each capture in color AND black and white puts both in one moment,
 *            where the median cannot help. Team Curry is exactly that (271
 *            captures x 3 frames, 2 of 3 black-and-white in every one); the
 *            sibling test keeps the color frame. At LinkedIn it also fires on
 *            two booths that fired in the same second (83 frames): harmless, the
 *            pair is one moment and only one frame of it can be picked.
 *   glasses  the hand-on-eyeglasses pose holds down to ~0.10, then turns into
 *            hand-on-chin; counts from 0.10 (90 photos), at most 2 per set
 *   profile  side and three-quarter views from 0.10 (21 photos)
 *   back     backs of heads and odd turned poses from 0.11 (7 photos)
 *   gear     softboxes, monitors, a photographer in frame from 0.055 (~40):
 *            the first run at 0.07 let a monitor shot through at 0.059
 *   mascot   costume frames from 0.11 (6 photos)
 *   robot    the robot dog from 0.11. "Only humans" is a face count, and the
 *            face detector found a false face on one dog frame, which the
 *            first run then picked. Also drops a person HOLDING the robot
 *            (0.122), the generous direction.
 *   hidden   a portrait or pair whose face is behind a prop, 0.055 above the
 *            EVENT's median (relative, like bw), because
 *            a hidden face cannot be recognised, so one-per-person cannot be
 *            enforced on it: Team Curry's host behind a fan (0.103) and a guest
 *            behind a magnifier (0.076) each got a second portrait on
 *            production, 2026-11-16. Portraits and pairs only: in a group one
 *            covered face changes nothing, and Team Curry's top 40 for this
 *            phrase were mostly groups with one magnifier. Relative because a
 *            fixed 0.07 banned 400 of LinkedIn's 3,429 photobooth photos, where
 *            frames, hats and masks are the point and most faces stay visible
 *            (median 0.037). Medians: Team Curry 0.018 (cutoff 0.073, catches
 *            0.076 and 0.103), LinkedIn 0.037 (0.092), Electronica 0.016 (0.071).
 *
 * Bans are cut GENEROUSLY on purpose: a ban that drops a few good photos costs
 * nothing when the pool is thousands deep, while one black-and-white or gear
 * shot that gets through is exactly the complaint. Calibrated on ONE
 * white-backdrop headshot event; a dark or candid shoot may sit differently,
 * which is why the probe scripts exist. Re-run them before moving a cutoff.
 */

export type RuleKey = "bw" | "profile" | "back" | "gear" | "mascot" | "robot" | "hidden" | "glasses";

export interface HighlightRule {
  /** The phrase scored against each photo's image embedding. */
  text: string;
  /**
   * Similarity at or above which the rule applies to a photo, or, when
   * `relative`, the margin above the EVENT's median similarity.
   */
  at: number;
  relative?: boolean;
  /** "ban" drops the photo; "cap" limits how many such photos a set holds. */
  kind: "ban" | "cap";
  /** Applies only to portraits and pairs (at most 2 subject faces). */
  portraitsOnly?: boolean;
}

export const HIGHLIGHT_RULES: Record<RuleKey, HighlightRule> = {
  bw: { text: "a black and white photo", at: 0.025, kind: "ban", relative: true },
  profile: { text: "a side profile view of a person's face", at: 0.1, kind: "ban" },
  back: { text: "a person photographed from behind, facing away", at: 0.11, kind: "ban" },
  gear: { text: "photography lighting equipment, a softbox or umbrella", at: 0.055, kind: "ban" },
  mascot: { text: "a person wearing a mascot costume", at: 0.11, kind: "ban" },
  robot: { text: "a robot", at: 0.11, kind: "ban" },
  hidden: { text: "a person hiding their face behind an object", at: 0.055, kind: "ban", relative: true, portraitsOnly: true },
  glasses: { text: "a person touching their eyeglasses with their hand", at: 0.1, kind: "cap" },
};

export const RULE_KEYS = Object.keys(HIGHLIGHT_RULES) as RuleKey[];

/**
 * Taste rules, in the order they are relaxed when a set comes up short (Mason,
 * 2026-11-16: "taste rules, only to fill"). Never relaxed, because they are
 * what a photo IS or who it is of: a person in it, black and white, gear,
 * mascot, robot, a hidden face, and two portraits of one person.
 */
export const RELAX_STEPS = ["glasses", "group", "profile", "back"] as const;
export type RelaxStep = (typeof RELAX_STEPS)[number];

/** Tags a set may hold only a few of. */
export type CapTag = "glasses" | "group";

/** Justin: "no more than 1-2 glasses holding shots", "1 - 3 group photos max". */
export const HIGHLIGHT_CAPS: Record<CapTag, number> = { glasses: 2, group: 3 };

/** Faces in a frame that make it a group shot. */
export const GROUP_SHOT_FACES = 3;

/**
 * The group cap applies only to a shoot where group photos are a minority.
 * Justin's "1-3 group photos max" came from a headshot day (Electronica: 2% of
 * photos have 3+ faces). At a party they ARE the coverage: Team Curry Holiday
 * Party is 55% group shots, and the cap left it 11 of 40 picks. LinkedIn
 * Holiday Party (photobooth pairs) is 17% and keeps the cap.
 */
export const GROUP_CAP_MAX_SHARE = 0.2;

export interface FrameFacts {
  /** Whether AI indexing has run; an unindexed frame has no faces or scores YET. */
  indexed: boolean;
  /** Faces detected in the frame, any size ("only humans"). */
  faces: number;
  /** Faces of comparable size to the largest: who the photo is OF (group shots). */
  subjectFaces: number;
  /** Rule similarities; absent when the frame has no embedding. */
  scores: Partial<Record<RuleKey, number>>;
}

export type VetoReason = "no-face" | "unscored" | Exclude<RuleKey, "glasses">;

export type Cutoffs = Record<RuleKey, number>;

/**
 * The similarity each rule applies at for ONE event: the fixed cutoff, or for a
 * relative rule the event's median plus its margin. Feed it every photo's
 * scores, not a shortlist, or the median moves with the ranking.
 */
export function eventCutoffs(scores: Iterable<Partial<Record<RuleKey, number>>>): Cutoffs {
  const values = new Map<RuleKey, number[]>();
  for (const row of scores) {
    for (const key of RULE_KEYS) {
      const v = row[key];
      if (v == null || !HIGHLIGHT_RULES[key].relative) continue;
      const arr = values.get(key) ?? [];
      arr.push(v);
      values.set(key, arr);
    }
  }
  const out = {} as Cutoffs;
  for (const key of RULE_KEYS) {
    const rule = HIGHLIGHT_RULES[key];
    if (!rule.relative) {
      out[key] = rule.at;
      continue;
    }
    const arr = (values.get(key) ?? []).sort((a, b) => a - b);
    // No scores at all: nothing to compare against, so the rule never fires.
    out[key] = arr.length ? arr[Math.floor(arr.length / 2)] + rule.at : Infinity;
  }
  return out;
}

/**
 * Why this frame can never be a Highlight, or null. "Only humans" is a face
 * count, not a phrase: no face found covers the robot dog, an empty set, a
 * back of a head. It applies only once a frame is indexed, so a gallery still
 * processing is not emptied by its own backlog.
 */
export function vetoReason(
  f: FrameFacts,
  cutoffs: Cutoffs,
  relaxed: ReadonlySet<string> = new Set()
): VetoReason | null {
  if (f.indexed && f.faces === 0) return "no-face";
  // No image embedding (not indexed yet, or indexing gave up): no rule can be
  // checked, so the frame cannot be proposed. The auto-fill counts gave-up
  // frames as settled, and an unscored robot or gear shot would otherwise pass
  // every ban (review, 2026-11-16).
  if (!RULE_KEYS.some((k) => f.scores[k] != null)) return "unscored";
  for (const key of RULE_KEYS) {
    if (HIGHLIGHT_RULES[key].kind !== "ban" || relaxed.has(key)) continue;
    if (HIGHLIGHT_RULES[key].portraitsOnly && f.subjectFaces > 2) continue;
    const s = f.scores[key];
    if (s != null && s >= cutoffs[key]) return key as VetoReason;
  }
  return null;
}

/** Which capped kinds this frame counts toward. */
export function capTags(f: FrameFacts, cutoffs: Cutoffs): CapTag[] {
  const tags: CapTag[] = [];
  const g = f.scores.glasses;
  if (g != null && g >= cutoffs.glasses) tags.push("glasses");
  if (f.subjectFaces >= GROUP_SHOT_FACES) tags.push("group");
  return tags;
}

/**
 * A face counts as a SUBJECT of the photo when its box is at least this share
 * of the largest face's area (half the width). Background faces (a staffer
 * behind a guest) neither make a group shot nor block the guest's photo under
 * one-per-person.
 */
export const SUBJECT_FACE_AREA_SHARE = 0.25;

export interface FaceRow {
  person_id: string | null;
  bbox_x?: number | null;
  bbox_y?: number | null;
  bbox_w: number | null;
  bbox_h: number | null;
  embedding?: unknown;
}

/** Whether a face of this box area is a subject next to the frame's largest face. */
export function isSubjectFace(area: number, largest: number): boolean {
  return largest === 0 || area >= largest * SUBJECT_FACE_AREA_SHARE;
}

/** A box covering more than this share of a smaller box is the same face detected twice. */
export const DUPLICATE_FACE_OVERLAP = 0.5;

const faceArea = (r: FaceRow) => (r.bbox_w ?? 0) * (r.bbox_h ?? 0);

function overlapShare(a: FaceRow, b: FaceRow): number {
  if (a.bbox_x == null || a.bbox_y == null || b.bbox_x == null || b.bbox_y == null) return 0;
  const w = Math.min(a.bbox_x + (a.bbox_w ?? 0), b.bbox_x + (b.bbox_w ?? 0)) - Math.max(a.bbox_x, b.bbox_x);
  const h = Math.min(a.bbox_y + (a.bbox_h ?? 0), b.bbox_y + (b.bbox_h ?? 0)) - Math.max(a.bbox_y, b.bbox_y);
  const smaller = Math.min(faceArea(a), faceArea(b));
  return w > 0 && h > 0 && smaller > 0 ? (w * h) / smaller : 0;
}

/** Faces with duplicate detections removed, keeping the one that has an embedding, then the bigger. */
function distinctFaces<R extends FaceRow>(rows: R[]): R[] {
  const ordered = [...rows].sort(
    (a, b) => Number(b.embedding != null) - Number(a.embedding != null) || faceArea(b) - faceArea(a)
  );
  const kept: R[] = [];
  for (const r of ordered) {
    if (!kept.some((k) => overlapShare(k, r) > DUPLICATE_FACE_OVERLAP)) kept.push(r);
  }
  return kept;
}

/**
 * A frame's SUBJECT faces, largest first: duplicate detections removed (a box
 * mostly covering another; Electronica holds 105 such, all without an
 * embedding, which made pairs read as groups), then only faces of comparable
 * size to the largest. The ONE list both the group count and the face vectors
 * come from, so they cannot disagree (third review, 2026-11-16).
 */
export function subjectFaceRows<R extends FaceRow>(rows: R[]): R[] {
  const kept = distinctFaces(rows);
  const largest = Math.max(0, ...kept.map(faceArea));
  return kept.filter((r) => isSubjectFace(faceArea(r), largest)).sort((a, b) => faceArea(b) - faceArea(a));
}

/** One frame's faces: how many (duplicates removed), how many are subjects, and the subjects' person ids. */
export function summarizeFaces(rows: FaceRow[]): {
  faces: number;
  subjectFaces: number;
  subjectPersonIds: string[];
} {
  const subjects = subjectFaceRows(rows);
  return {
    faces: distinctFaces(rows).length,
    subjectFaces: subjects.length,
    subjectPersonIds: subjects.map((r) => r.person_id).filter((p): p is string => !!p),
  };
}

/**
 * A black-and-white median at or above this (the old fixed cutoff): a grey
 * backdrop or an all-black-and-white shoot. Propose returns it as a diagnostic
 * note only (no alert: Mason, 2026-11-16, events are all colour or all black
 * and white, and a mixed one keeps colour, which the sibling test does).
 */
export const BW_BASELINE_HIGH = 0.055;

/**
 * The note propose returns when the black-and-white baseline is too high to
 * trust, or null. Feed it cutoffs computed WITHOUT the sibling-removed frames:
 * at a colour+black-and-white booth most frames are black and white, and their
 * median would raise the note on every fill (Team Curry, 0.087).
 */
export function bwBaselineNote(cutoffs: Cutoffs): string | null {
  const baseline = cutoffs.bw - HIGHLIGHT_RULES.bw.at;
  if (!Number.isFinite(baseline) || baseline < BW_BASELINE_HIGH) return null;
  return `bw-baseline-high:${baseline.toFixed(3)}`;
}

/** How much more "black and white" than its own capture's colour frame a frame must score. */
export const BW_SIBLING_MARGIN = 0.02;

/**
 * Frames that are a black-and-white version of a capture that also exists in
 * colour: within one capture time, any frame scoring BW_SIBLING_MARGIN above
 * the capture's lowest black-and-white score. Frames with no capture time are
 * their own capture and never match.
 */
export function bwSiblings(frames: { id: string; capture: string | null; bw?: number }[]): Set<string> {
  const low = new Map<string, number>();
  for (const f of frames) {
    if (!f.capture || f.bw == null) continue;
    low.set(f.capture, Math.min(low.get(f.capture) ?? Infinity, f.bw));
  }
  const out = new Set<string>();
  for (const f of frames) {
    if (!f.capture || f.bw == null) continue;
    if (f.bw >= low.get(f.capture)! + BW_SIBLING_MARGIN) out.add(f.id);
  }
  return out;
}

/**
 * How hard looking like an already-chosen face pulls a candidate down, in
 * score percentiles per unit of face similarity (ArcFace cosine: the same
 * person is ~0.5+, strangers mostly under ~0.3). Mason, 2026-11-16, chose
 * variety by appearance over labelling anyone's gender or race. Measured on
 * Electronica (65 picks): mean pairwise face similarity 0.0153 with the old
 * picker, 0.0083 with one-per-person alone, 0.0065 with this pull on. Modest;
 * one-per-person does most of the spreading (lesson 207).
 */
export const HIGHLIGHT_VARIETY = 0.5;
