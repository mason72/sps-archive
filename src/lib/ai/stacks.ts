import { createServiceClient } from "@/lib/supabase/server";

/**
 * Smart Stacks: Groups similar images (same person headshots, burst sequences)
 * and ranks them with the best shot on top.
 *
 * For headshot events:
 *   - Groups by face cluster (person_id)
 *   - Ranks by: aesthetic_score * 0.4 + sharpness_score * 0.3 + eyes_open * 0.3
 *
 * For general events:
 *   - Groups by visual similarity (CLIP embedding distance < threshold)
 *   - Also groups by timestamp proximity (burst detection)
 *   - Ranks by aesthetic_score
 */

interface StackCandidate {
  imageId: string;
  personId: string | null;
  aestheticScore: number;
  sharpnessScore: number;
  isEyesOpen: boolean;
  takenAt: string | null;
  clipEmbedding: number[] | null;
}

/** Calculate the composite quality score for ranking within a stack */
function qualityScore(img: StackCandidate): number {
  const aesthetic = img.aestheticScore || 0;
  const sharpness = img.sharpnessScore || 0;
  const eyesOpen = img.isEyesOpen ? 1.0 : 0.0;
  return aesthetic * 0.4 + sharpness * 0.3 + eyesOpen * 0.3;
}

/**
 * Build face-based stacks for an event.
 * Groups images by detected person and ranks by quality.
 */
export async function buildFaceStacks(eventId: string) {
  const supabase = createServiceClient();

  // Get all images with face detections for this event
  const { data: faces, error: facesError } = await supabase
    .from("faces")
    .select(`
      id,
      image_id,
      person_id,
      confidence,
      images!inner (
        id,
        event_id,
        aesthetic_score,
        sharpness_score,
        is_eyes_open,
        taken_at,
        processing_status
      )
    `)
    .eq("images.event_id", eventId)
    .eq("images.processing_status", "complete")
    .not("person_id", "is", null);

  if (facesError) throw facesError;
  if (!faces || faces.length === 0) return;

  // Group faces by person
  const personGroups = new Map<string, StackCandidate[]>();

  for (const face of faces) {
    const personId = face.person_id!;
    const img = face.images as unknown as StackCandidate;

    if (!personGroups.has(personId)) {
      personGroups.set(personId, []);
    }

    personGroups.get(personId)!.push({
      imageId: face.image_id,
      personId,
      aestheticScore: img.aestheticScore || 0,
      sharpnessScore: img.sharpnessScore || 0,
      isEyesOpen: img.isEyesOpen || false,
      takenAt: img.takenAt,
      clipEmbedding: null,
    });
  }

  // Create stacks for persons with 2+ images
  for (const [personId, images] of personGroups) {
    if (images.length < 2) continue;

    // Deduplicate by imageId (one person might have multiple face detections in same image)
    const uniqueImages = [...new Map(images.map((i) => [i.imageId, i])).values()];
    if (uniqueImages.length < 2) continue;

    // Sort by quality score, best first
    uniqueImages.sort((a, b) => qualityScore(b) - qualityScore(a));

    // Create the stack
    const { data: stack, error: stackError } = await supabase
      .from("stacks")
      .insert({
        event_id: eventId,
        stack_type: "face",
        cover_image_id: uniqueImages[0].imageId,
        image_count: uniqueImages.length,
        person_id: personId,
      })
      .select("id")
      .single();

    if (stackError) throw stackError;

    // Assign images to the stack with ranks
    for (let i = 0; i < uniqueImages.length; i++) {
      await supabase
        .from("images")
        .update({
          stack_id: stack.id,
          stack_rank: i + 1, // 1 = best (cover)
        })
        .eq("id", uniqueImages[i].imageId);
    }
  }
}

/**
 * Build burst-detection stacks.
 * Groups images taken within a short time window (e.g., 2 seconds).
 */
export async function buildBurstStacks(eventId: string) {
  const supabase = createServiceClient();

  const { data: images, error } = await supabase
    .from("images")
    .select("id, taken_at, aesthetic_score, sharpness_score, is_eyes_open")
    .eq("event_id", eventId)
    .eq("processing_status", "complete")
    .is("stack_id", null) // only unassigned images
    .not("taken_at", "is", null)
    .order("taken_at");

  if (error) throw error;
  if (!images || images.length < 2) return;

  const BURST_THRESHOLD_MS = 2000; // 2 seconds between shots = burst
  let currentBurst: typeof images = [images[0]];

  for (let i = 1; i < images.length; i++) {
    const prev = new Date(images[i - 1].taken_at!).getTime();
    const curr = new Date(images[i].taken_at!).getTime();

    if (curr - prev <= BURST_THRESHOLD_MS) {
      currentBurst.push(images[i]);
    } else {
      if (currentBurst.length >= 3) {
        await createBurstStack(supabase, eventId, currentBurst);
      }
      currentBurst = [images[i]];
    }
  }

  // Don't forget the last burst
  if (currentBurst.length >= 3) {
    await createBurstStack(supabase, eventId, currentBurst);
  }
}

async function createBurstStack(
  supabase: ReturnType<typeof createServiceClient>,
  eventId: string,
  images: { id: string; aesthetic_score: number | null; sharpness_score: number | null; is_eyes_open: boolean | null }[]
) {
  // Sort by quality
  const sorted = [...images].sort((a, b) => {
    const scoreA = (a.aesthetic_score || 0) * 0.6 + (a.sharpness_score || 0) * 0.4;
    const scoreB = (b.aesthetic_score || 0) * 0.6 + (b.sharpness_score || 0) * 0.4;
    return scoreB - scoreA;
  });

  const { data: stack, error: stackError } = await supabase
    .from("stacks")
    .insert({
      event_id: eventId,
      stack_type: "burst",
      cover_image_id: sorted[0].id,
      image_count: sorted.length,
    })
    .select("id")
    .single();

  if (stackError) throw stackError;

  for (let i = 0; i < sorted.length; i++) {
    await supabase
      .from("images")
      .update({ stack_id: stack.id, stack_rank: i + 1 })
      .eq("id", sorted[i].id);
  }
}
