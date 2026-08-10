/**
 * Face clustering v2 — pure math, no I/O (tasks/todo.md "AI revival" Phase 2).
 *
 * Replaces the shelved DBSCAN implementation, whose delete-all-persons-first
 * approach becomes data loss the moment a person has a user-given name.
 *
 * Model: incremental-first. Faces are assigned to EXISTING persons when close
 * enough to their centroid (names and person ids are stable across re-runs);
 * only the leftovers form new clusters. A full recluster is just running this
 * against an event with no persons.
 *
 * Embeddings are L2-normalized 512-dim ArcFace vectors, so cosine similarity
 * is a plain dot product. Same-person pairs typically land ≥0.5; different
 * people ≈0.1-0.3. Thresholds validated against filename-derived ground truth
 * (scripts/verify-face-clustering.ts) before shipping.
 */

export interface FaceVec {
  id: string;
  imageId: string;
  embedding: number[];
  quality: number;
  personId: string | null;
}

export interface PersonCentroid {
  id: string;
  name: string | null;
  centroid: number[];
  faceCount: number;
}

export interface ClusterPlan {
  /** faceId → existing personId */
  assignments: Map<string, string>;
  /** Each inner array is a new person's member faces (ordered quality-desc). */
  newClusters: FaceVec[][];
  /** Faces that matched nothing and formed no cluster (kept unassigned). */
  unassigned: FaceVec[];
}

export interface ClusterOptions {
  /** Min cosine similarity to join an existing person's centroid. */
  assignThreshold?: number;
  /** Min cosine similarity to join a forming cluster's centroid. */
  clusterThreshold?: number;
  /** New persons need at least this many faces (stray faces stay unassigned). */
  minClusterSize?: number;
  /** Faces below this quality don't SEED clusters (tiny/blurred background
   *  faces may still join one). */
  minSeedQuality?: number;
}

export function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Mean of vectors, re-normalized to unit length. */
export function centroidOf(vectors: number[][]): number[] {
  const dim = vectors[0].length;
  const mean = new Array<number>(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i++) mean[i] += v[i];
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    mean[i] /= vectors.length;
    norm += mean[i] * mean[i];
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) mean[i] /= norm;
  return mean;
}

/**
 * Plan clustering for an event's faces.
 *
 * Already-assigned faces are left alone (their person_id is the source of
 * truth); pass them anyway so existing centroids can be computed by the
 * caller. Unassigned faces are processed quality-desc so clusters form
 * around the sharpest, most frontal shots.
 */
export function planClustering(
  faces: FaceVec[],
  persons: PersonCentroid[],
  {
    assignThreshold = 0.55,
    clusterThreshold = 0.55,
    minClusterSize = 2,
    minSeedQuality = 0.15,
  }: ClusterOptions = {}
): ClusterPlan {
  const assignments = new Map<string, string>();
  const candidates = faces
    .filter((f) => !f.personId)
    .sort((a, b) => b.quality - a.quality);

  // Pass 1 — join existing persons (stable ids, stable names).
  const leftovers: FaceVec[] = [];
  for (const face of candidates) {
    let best: { id: string; sim: number } | null = null;
    for (const p of persons) {
      const sim = dot(face.embedding, p.centroid);
      if (sim >= assignThreshold && (!best || sim > best.sim)) {
        best = { id: p.id, sim };
      }
    }
    if (best) assignments.set(face.id, best.id);
    else leftovers.push(face);
  }

  // Pass 2 — greedy centroid clustering of the leftovers (quality-desc order:
  // clusters seed on the best face and accrete; centroid updates as they go).
  interface Forming {
    members: FaceVec[];
    centroid: number[];
  }
  const forming: Forming[] = [];
  const strays: FaceVec[] = [];
  for (const face of leftovers) {
    let best: { cluster: Forming; sim: number } | null = null;
    for (const c of forming) {
      const sim = dot(face.embedding, c.centroid);
      if (sim >= clusterThreshold && (!best || sim > best.sim)) {
        best = { cluster: c, sim };
      }
    }
    if (best) {
      best.cluster.members.push(face);
      best.cluster.centroid = centroidOf(best.cluster.members.map((m) => m.embedding));
    } else if (face.quality >= minSeedQuality) {
      forming.push({ members: [face], centroid: face.embedding });
    } else {
      strays.push(face);
    }
  }

  const newClusters: FaceVec[][] = [];
  const unassigned: FaceVec[] = [...strays];
  for (const c of forming) {
    if (c.members.length >= minClusterSize) newClusters.push(c.members);
    else unassigned.push(...c.members);
  }

  return { assignments, newClusters, unassigned };
}
