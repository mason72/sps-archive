import { createServiceClient } from "@/lib/supabase/server";

/**
 * Face Clustering via DBSCAN
 *
 * Groups face embeddings (512-dim ArcFace vectors) into person clusters
 * using density-based spatial clustering. This is the missing step that
 * populates `faces.person_id` so `buildFaceStacks()` can work.
 *
 * Algorithm: DBSCAN (no need to specify cluster count, handles noise)
 * Distance: Cosine distance on ArcFace embeddings
 * Parameters: epsilon=0.5 (cosine distance threshold), minPoints=2
 */

interface FaceRecord {
  id: string;
  image_id: string;
  embedding: number[];
  quality: number;
  is_eyes_open: boolean;
  bbox_w: number;
  bbox_h: number;
}

// ─── DBSCAN Core ───────────────────────────────────────────────

const NOISE = 0;
const UNVISITED = -1;

/**
 * Pure DBSCAN implementation.
 *
 * @param distMatrix - Precomputed pairwise distance matrix
 * @param epsilon - Maximum distance to consider two points neighbors
 * @param minPoints - Minimum cluster size
 * @returns Array of cluster labels (0 = noise, 1+ = cluster ID)
 */
function dbscan(
  distMatrix: Float64Array[],
  epsilon: number,
  minPoints: number
): number[] {
  const n = distMatrix.length;
  const labels = new Array<number>(n).fill(UNVISITED);
  let clusterId = 0;

  for (let i = 0; i < n; i++) {
    if (labels[i] !== UNVISITED) continue;

    const neighbors = regionQuery(distMatrix, i, epsilon);

    if (neighbors.length < minPoints) {
      labels[i] = NOISE;
      continue;
    }

    clusterId++;
    labels[i] = clusterId;

    const seed = [...neighbors];
    const visited = new Set<number>([i]);

    while (seed.length > 0) {
      const q = seed.pop()!;
      if (visited.has(q)) continue;
      visited.add(q);

      if (labels[q] === NOISE) {
        labels[q] = clusterId; // Noise → border point
      }
      if (labels[q] !== UNVISITED) continue;

      labels[q] = clusterId;

      const qNeighbors = regionQuery(distMatrix, q, epsilon);
      if (qNeighbors.length >= minPoints) {
        seed.push(...qNeighbors);
      }
    }
  }

  return labels;
}

/** Find all points within epsilon distance of point i */
function regionQuery(
  distMatrix: Float64Array[],
  i: number,
  epsilon: number
): number[] {
  const neighbors: number[] = [];
  const row = distMatrix[i];
  for (let j = 0; j < row.length; j++) {
    if (j !== i && row[j] <= epsilon) {
      neighbors.push(j);
    }
  }
  return neighbors;
}

// ─── Distance Computation ──────────────────────────────────────

/** Cosine distance = 1 - cosine_similarity */
function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1;
  return 1 - dot / denom;
}

/** Build pairwise cosine distance matrix (symmetric) */
function buildDistanceMatrix(embeddings: number[][]): Float64Array[] {
  const n = embeddings.length;
  const matrix: Float64Array[] = [];
  for (let i = 0; i < n; i++) {
    matrix[i] = new Float64Array(n);
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = cosineDistance(embeddings[i], embeddings[j]);
      matrix[i][j] = d;
      matrix[j][i] = d;
    }
  }

  return matrix;
}

// ─── Main Entry Point ──────────────────────────────────────────

/**
 * Cluster faces for an event and create person records.
 *
 * Idempotent: clears existing person assignments before re-clustering.
 */
export async function clusterFaces(eventId: string): Promise<{
  personCount: number;
  noiseCount: number;
}> {
  const supabase = createServiceClient();

  // ─── Step 1: Clear previous clustering results ───
  // Remove existing persons for this event (cascade clears faces.person_id via FK SET NULL)
  const { data: existingPersons } = await supabase
    .from("persons")
    .select("id")
    .eq("event_id", eventId);

  if (existingPersons && existingPersons.length > 0) {
    await supabase
      .from("persons")
      .delete()
      .eq("event_id", eventId);
  }

  // ─── Step 2: Fetch all face embeddings for this event ───
  const { data: faces, error } = await supabase
    .from("faces")
    .select(`
      id,
      image_id,
      embedding,
      quality,
      is_eyes_open,
      bbox_w,
      bbox_h,
      images!inner (event_id)
    `)
    .eq("images.event_id", eventId);

  if (error) throw error;
  if (!faces || faces.length < 2) {
    return { personCount: 0, noiseCount: faces?.length || 0 };
  }

  // Parse embeddings from pgvector format
  const faceRecords: FaceRecord[] = faces.map((f) => ({
    id: f.id,
    image_id: f.image_id,
    embedding: parseEmbedding(f.embedding),
    quality: f.quality || 0,
    is_eyes_open: f.is_eyes_open ?? true,
    bbox_w: f.bbox_w,
    bbox_h: f.bbox_h,
  }));

  // ─── Step 3: Run DBSCAN ───
  const embeddings = faceRecords.map((f) => f.embedding);
  const distMatrix = buildDistanceMatrix(embeddings);
  const labels = dbscan(distMatrix, 0.5, 2);

  // ─── Step 4: Create person records + assign face.person_id ───
  const clusters = new Map<number, number[]>(); // clusterId → face indices
  let noiseCount = 0;

  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === NOISE) {
      noiseCount++;
      continue;
    }
    if (!clusters.has(labels[i])) {
      clusters.set(labels[i], []);
    }
    clusters.get(labels[i])!.push(i);
  }

  // Get the event's user_id for person records
  const { data: event } = await supabase
    .from("events")
    .select("user_id")
    .eq("id", eventId)
    .single();

  if (!event) throw new Error(`Event ${eventId} not found`);

  let personCount = 0;

  for (const [, faceIndices] of clusters) {
    // Find the best face for this person (representative)
    const bestIdx = faceIndices.reduce((best, idx) => {
      const bestFace = faceRecords[best];
      const currentFace = faceRecords[idx];
      const bestScore = faceQualityScore(bestFace);
      const currentScore = faceQualityScore(currentFace);
      return currentScore > bestScore ? idx : best;
    });

    // Create person record
    const { data: person, error: personError } = await supabase
      .from("persons")
      .insert({
        event_id: eventId,
        representative_face_id: faceRecords[bestIdx].id,
        face_count: faceIndices.length,
      })
      .select("id")
      .single();

    if (personError) throw personError;

    // Assign all faces in this cluster to the person
    const faceIds = faceIndices.map((idx) => faceRecords[idx].id);
    const { error: updateError } = await supabase
      .from("faces")
      .update({ person_id: person.id, confidence: 0.9 })
      .in("id", faceIds);

    if (updateError) throw updateError;

    personCount++;
  }

  return { personCount, noiseCount };
}

/** Parse embedding from pgvector string format "[0.1,0.2,...]" or array */
function parseEmbedding(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    // pgvector returns "[0.1,0.2,...]" format
    return JSON.parse(raw);
  }
  return [];
}

/** Quality score for selecting the best representative face */
function faceQualityScore(face: FaceRecord): number {
  const quality = face.quality || 0;
  const eyesBonus = face.is_eyes_open ? 0.3 : 0;
  const sizeBonus = Math.min(face.bbox_w * face.bbox_h * 4, 0.2); // larger faces get slight bonus
  return quality * 0.5 + eyesBonus + sizeBonus;
}
