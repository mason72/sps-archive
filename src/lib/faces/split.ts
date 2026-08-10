/**
 * Person splitting — propose and shape a two-way split of an over-merged
 * cluster (two similar-looking people fused at clustering time).
 *
 * Seeding (Mason, 2026-08-10): FILENAMES FIRST — when the cluster's files
 * carry two disagreeing person-name groups, that IS the split (the Abhudaya/
 * ABHUDAYAnth case pre-solves itself). When filenames are junk, fall back to
 * a tighter 2-way re-cluster of the face embeddings. Either way the
 * photographer reviews and can flip any photo before confirming.
 *
 * Everything here operates on FACES, not photos: if the two people ever share
 * a frame, that photo belongs to both of them — assignment by image would
 * corrupt one side. (For solo headshots the two are identical.)
 *
 * Durability note: clustering only ever assigns UNASSIGNED faces to the
 * nearest centroid and never merges existing persons, so a confirmed split
 * holds by construction — no anti-link bookkeeping needed.
 */

import { centroidOf, dot } from "./clustering-core";

/** One name extends the other at a word boundary → same name family. */
export function sameNameFamily(a: string, b: string): boolean {
  const la = a.trim().toLowerCase();
  const lb = b.trim().toLowerCase();
  if (la === lb) return true;
  const [shorter, longer] = la.length <= lb.length ? [la, lb] : [lb, la];
  return longer.startsWith(`${shorter} `);
}

export interface SplitFace {
  id: string;
  imageId: string;
  embedding: number[];
  quality: number;
}

export interface SplitProposal {
  basis: "filenames" | "faces";
  /** Exactly two groups; [0] is the larger (keeps the original person id). */
  groups: {
    faceIds: string[];
    /** Filename-consensus name for the group, when one exists. */
    seedName: string | null;
  }[];
}

/** Each filename group needs this many supporting files to define a split. */
export const SPLIT_MIN_SUPPORT = 3;
/** Face-basis fallback: centroids more similar than this won't split. */
export const SPLIT_MAX_CENTROID_SIM = 0.8;
/** Fallback minority must be a real faction, not an outlier face or two. */
export const SPLIT_MIN_MINORITY = 0.1;

/**
 * Detect whether a cluster's filenames disagree strongly enough to imply two
 * people. Returns the top two non-family name groups, or null.
 * (Also reused by the suggestions engine to surface split cards.)
 */
export function filenameSplitGroups(
  imageIds: string[],
  filenameOf: Map<string, string>,
  extractName: (filename: string) => string,
  personLike: (name: string) => boolean
): { name: string; imageIds: string[] }[] | null {
  const byName = new Map<string, { display: string; imageIds: string[] }>();
  for (const imageId of new Set(imageIds)) {
    const filename = filenameOf.get(imageId);
    if (!filename) continue;
    const name = extractName(filename).trim();
    if (!name || !personLike(name)) continue;
    // Collapse name families onto the longest form seen so far.
    let key = name.toLowerCase();
    for (const existing of byName.keys()) {
      if (sameNameFamily(existing, key)) {
        key = existing.length >= key.length ? existing : key;
        break;
      }
    }
    // Re-home any shorter family member under the longer key.
    for (const [k, v] of [...byName]) {
      if (k !== key && sameNameFamily(k, key)) {
        const target = byName.get(key) ?? { display: name, imageIds: [] };
        target.imageIds.push(...v.imageIds);
        if (v.display.length > target.display.length) target.display = v.display;
        byName.set(key, target);
        byName.delete(k);
      }
    }
    const cur = byName.get(key) ?? { display: name, imageIds: [] };
    cur.imageIds.push(imageId);
    if (name.length > cur.display.length) cur.display = name;
    byName.set(key, cur);
  }

  const groups = [...byName.values()]
    .filter((g) => g.imageIds.length >= SPLIT_MIN_SUPPORT)
    .sort((a, b) => b.imageIds.length - a.imageIds.length);
  if (groups.length < 2) return null;
  return groups.slice(0, 2).map((g) => ({ name: g.display, imageIds: g.imageIds }));
}

/**
 * Propose a two-way split. Filename basis when the files disagree; otherwise
 * a 2-way constrained re-cluster of the embeddings. Null = won't separate
 * (probably genuinely one person).
 */
export function proposeSplit(
  faces: SplitFace[],
  filenameOf: Map<string, string>,
  extractName: (filename: string) => string,
  personLike: (name: string) => boolean
): SplitProposal | null {
  if (faces.length < 2) return null;

  const nameGroups = filenameSplitGroups(
    faces.map((f) => f.imageId),
    filenameOf,
    extractName,
    personLike
  );

  if (nameGroups) {
    const [a, b] = nameGroups;
    const inA = new Set(a.imageIds);
    const inB = new Set(b.imageIds);
    const groupA: SplitFace[] = [];
    const groupB: SplitFace[] = [];
    const leftovers: SplitFace[] = [];
    for (const f of faces) {
      if (inA.has(f.imageId)) groupA.push(f);
      else if (inB.has(f.imageId)) groupB.push(f);
      else leftovers.push(f);
    }
    // Files with junk/other names join whichever group their face resembles.
    if (groupA.length && groupB.length) {
      const ca = centroidOf(groupA.map((f) => f.embedding));
      const cb = centroidOf(groupB.map((f) => f.embedding));
      for (const f of leftovers) {
        (dot(f.embedding, ca) >= dot(f.embedding, cb) ? groupA : groupB).push(f);
      }
      const ordered =
        groupA.length >= groupB.length
          ? [
              { faces: groupA, seedName: a.name },
              { faces: groupB, seedName: b.name },
            ]
          : [
              { faces: groupB, seedName: b.name },
              { faces: groupA, seedName: a.name },
            ];
      return {
        basis: "filenames",
        groups: ordered.map((g) => ({
          faceIds: g.faces.map((f) => f.id),
          seedName: g.seedName,
        })),
      };
    }
  }

  // Face-basis fallback: seed 2-means with the most dissimilar pair among the
  // sharpest faces, then a few assignment/centroid rounds.
  const seedsPool = [...faces].sort((a, b) => b.quality - a.quality).slice(0, 12);
  let seedA = seedsPool[0];
  let seedB = seedsPool[1] ?? seedsPool[0];
  let worst = 2;
  for (let i = 0; i < seedsPool.length; i++) {
    for (let j = i + 1; j < seedsPool.length; j++) {
      const sim = dot(seedsPool[i].embedding, seedsPool[j].embedding);
      if (sim < worst) {
        worst = sim;
        seedA = seedsPool[i];
        seedB = seedsPool[j];
      }
    }
  }
  let ca = seedA.embedding;
  let cb = seedB.embedding;
  let groupA: SplitFace[] = [];
  let groupB: SplitFace[] = [];
  for (let round = 0; round < 4; round++) {
    groupA = [];
    groupB = [];
    for (const f of faces) {
      (dot(f.embedding, ca) >= dot(f.embedding, cb) ? groupA : groupB).push(f);
    }
    if (!groupA.length || !groupB.length) return null;
    ca = centroidOf(groupA.map((f) => f.embedding));
    cb = centroidOf(groupB.map((f) => f.embedding));
  }
  // Centroids still near-identical → this is one person; don't propose.
  if (dot(ca, cb) > SPLIT_MAX_CENTROID_SIM) return null;
  // A 34-vs-1 "split" is an outlier shot (odd angle, occlusion), not two
  // people — seen live on a photobooth cluster. Require a real faction.
  const minority = Math.min(groupA.length, groupB.length);
  if (minority < Math.max(2, Math.ceil(faces.length * SPLIT_MIN_MINORITY))) return null;

  const ordered = groupA.length >= groupB.length ? [groupA, groupB] : [groupB, groupA];
  return {
    basis: "faces",
    groups: ordered.map((g) => ({ faceIds: g.map((f) => f.id), seedName: null })),
  };
}
