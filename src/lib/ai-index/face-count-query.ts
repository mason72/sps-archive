/**
 * Structural search: some words describe how many people are in the frame,
 * and the face detector already answered that for every photo. "group" is
 * not a visual concept the model scores well (top 0.115 on a headshot day,
 * and to SigLIP it means a crowd, so two-person frames fell under the cut —
 * 14 of 36 found). A group photo IS a frame with two or more faces. This
 * turns those words into a face-count range, which both search routes and
 * the Smart section modal apply BEFORE spending an embed call.
 *
 * Pure and tiny on purpose; the vocabulary is the whole feature. Extend it
 * here, never inline at a route.
 */
export interface FaceCountRule {
  min: number;
  max?: number;
  /** Which phrase matched — for the UI tag and for logs. */
  label: string;
}

const RULES: { re: RegExp; rule: Omit<FaceCountRule, "label"> }[] = [
  // Exactly two — a pair. Checked first so "two people" never reads as
  // "people" (2+).
  { re: /\b(two people|two persons|pair|pairs|couple|couples|duo|duos)\b/, rule: { min: 2, max: 2 } },
  // Crowds — five or more.
  {
    re: /\b(crowd|crowds|everyone|everybody|whole (team|company|office|staff|crew)|team photo|team photos|all hands|big group)\b/,
    rule: { min: 5 },
  },
  // Any group — two or more.
  { re: /\b(group|groups|group photo|group photos|group shot|group shots|together|team)\b/, rule: { min: 2 } },
];

export function faceCountRule(query: string): FaceCountRule | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  for (const { re, rule } of RULES) {
    const m = q.match(re);
    if (m) return { ...rule, label: m[0] };
  }
  return null;
}

/** Apply a rule to (image_id, face_count) rows. */
export function applyFaceCountRule<T extends { face_count: number }>(
  rows: T[],
  rule: FaceCountRule
): T[] {
  return rows.filter(
    (r) => r.face_count >= rule.min && (rule.max === undefined || r.face_count <= rule.max)
  );
}
