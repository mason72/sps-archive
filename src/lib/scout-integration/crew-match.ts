/**
 * Who of the crew is in a postcard: the decision.
 *
 * The database hands over, per detected face, the closest crews by their best
 * reference face (`scout_image_crew_candidates`, migration 102). A face names a
 * crew member ONLY when it clears the same bar the identity engine uses to
 * confirm on its own (`AUTO_CONFIDENCE` 0.70 and `AUTO_MARGIN` 0.10 over the
 * runner-up, measured; docs/AI.md). Anything weaker names nobody: a wrong tag
 * on a crew photo is worse than a missing one, and Scout shows these as tags
 * the person can remove, never as facts.
 *
 * Guests are never named: the candidates are crew references only, and a face
 * that matches no crew well enough is simply left out. Nothing here writes.
 */
import { AUTO_CONFIDENCE, AUTO_MARGIN, decideAutoConfirm } from "@/lib/people/identity-suggestions";

export interface CrewCandidate {
  face_id: string;
  crew_id: string;
  similarity: number;
}

export interface CrewRosterEntry {
  id: string;
  display_name: string;
  primary_email: string | null;
}

export interface CrewInPhoto {
  email: string | null;
  display_name: string;
  /** Best face similarity for this person in the photo, rounded to 3 places. */
  confidence: number;
}

export function pickCrewMatches(
  candidates: CrewCandidate[],
  roster: Map<string, CrewRosterEntry>,
  { confidence = AUTO_CONFIDENCE, margin = AUTO_MARGIN }: { confidence?: number; margin?: number } = {}
): CrewInPhoto[] {
  const byFace = new Map<string, CrewCandidate[]>();
  for (const c of candidates) {
    if (!Number.isFinite(c.similarity)) continue;
    const list = byFace.get(c.face_id);
    if (list) list.push(c);
    else byFace.set(c.face_id, [c]);
  }

  // Best evidence per crew member across the photo's faces.
  const best = new Map<string, number>();
  for (const list of byFace.values()) {
    list.sort((a, b) => b.similarity - a.similarity);
    const [top, runnerUp] = list;
    // The engine's own rule, not a restatement of it.
    const verdict = decideAutoConfirm(top.similarity, runnerUp?.similarity ?? null, {
      clusterNamed: false,
      confidence,
      margin,
    });
    if (!verdict.auto) continue;
    best.set(top.crew_id, Math.max(best.get(top.crew_id) ?? -1, top.similarity));
  }

  const out: CrewInPhoto[] = [];
  for (const [crewId, sim] of best) {
    const person = roster.get(crewId);
    // A crew id the roster read did not return is not named from the id alone.
    if (!person) continue;
    out.push({
      email: person.primary_email ? person.primary_email.trim().toLowerCase() : null,
      display_name: person.display_name,
      confidence: Math.round(sim * 1000) / 1000,
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}
