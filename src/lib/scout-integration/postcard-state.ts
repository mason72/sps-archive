/**
 * The pure decisions behind a postcard's lifecycle: whether a POST ingests or
 * returns what is already there, what a lost race means, and what status a
 * photo row reads as. Kept free of I/O so each has a test.
 */
import { AI_INDEX_MAX_ATTEMPTS } from "@/lib/ai-index/failures";

export interface PostcardLink {
  postcard_id: string;
  image_id: string;
  event_id: string;
  section_id: string | null;
  gig_id: string;
  author_email: string | null;
  created_at: string;
  published_target: string | null;
  published_at: string | null;
}

/**
 * Idempotent on Scout's postcard id: a link that exists IS the answer, whatever
 * else the retry carries (a fresh signed URL, a renamed gig). The postcard's
 * photo is never re-fetched or re-filed by a repeat POST.
 */
export function ingestDecision(
  existing: PostcardLink | null
): { action: "return-existing"; link: PostcardLink } | { action: "ingest" } {
  return existing ? { action: "return-existing", link: existing } : { action: "ingest" };
}

/**
 * The claim is the link insert, made after the image row exists. Postgres
 * answers a second claim on the same postcard with a unique violation (23505):
 * that POST lost a race, must delete the photo it just made, and return the
 * winner's link. Any other error is a real failure.
 */
export function claimOutcome(err: { code?: string | null } | null): "won" | "lost" | "error" {
  if (!err) return "won";
  return err.code === "23505" ? "lost" : "error";
}

export type PostcardStatus = "processing" | "ready" | "failed";

export interface PostcardImageRow {
  processing_status: string;
  ai_indexed_at: string | null;
  ai_index_attempts: number | null;
}

/**
 * - ready: archived AND AI-indexed (faces and aesthetic score exist).
 * - failed: the upload failed, or the AI lane gave up on it (the same
 *   `AI_INDEX_MAX_ATTEMPTS` rule as `event_readiness.gave_up`). The original is
 *   still archived in the second case; there is just nothing AI to report.
 * - processing: anything else, including a lane switched off by
 *   AI_INDEXING_ENABLED, which stays "processing" until it is switched on.
 */
export function postcardStatus(row: PostcardImageRow): PostcardStatus {
  if (row.processing_status === "failed") return "failed";
  if (row.processing_status !== "complete") return "processing";
  if (row.ai_indexed_at) return "ready";
  if ((row.ai_index_attempts ?? 0) >= AI_INDEX_MAX_ATTEMPTS) return "failed";
  return "processing";
}

/** The stored filename for a postcard: no person or gig name, so /people never reads one from it. */
export function postcardFilename(postcardId: string): string {
  return `scout-postcard-${postcardId}.jpg`;
}
