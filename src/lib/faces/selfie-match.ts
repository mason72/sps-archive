import { createServiceClient } from "@/lib/supabase/server";
import { recordUsage, secondsSince } from "@/lib/usage/record";

type SupabaseDB = ReturnType<typeof createServiceClient>;

/** A face hit at or above this cosine is evidence; ArcFace same-person ≥ ~0.5. */
const FACE_MATCH_FLOOR = 0.5;
/** A single hit this strong identifies a person on its own. */
const STRONG_MATCH = 0.6;

export interface SelfieMatch {
  /** Image ids, unscoped — the CALLER narrows to what its surface may show. */
  imageIds: string[];
  matchedPerson: boolean;
  /** No usable face in the selfie; imageIds is empty. */
  noFace: boolean;
}

/**
 * "Find my photos", from a selfie — the matching itself, with no opinion
 * about who is asking.
 *
 * Extracted 2026-08-10 when the owner's gallery preview became the same
 * component as the guest gallery: two routes now need identical matching, and
 * a second hand-written copy of the person-vote would drift from this one the
 * first time either was tuned. The routes keep what genuinely differs — the
 * guest route checks the share, its password cookie, the rate limit and the
 * selection scope; the preview route checks ownership.
 *
 * The selfie is embedded IN MEMORY on Modal and never written to R2 or the
 * database. Only image ids come back.
 *
 * Matching goes through CLUSTERING rather than raw similarity: face hits vote
 * for a person, and the winner's COMPLETE photo set returns — so
 * sunglasses-at-the-party still finds the dance-floor shots. Falls back to
 * direct hits when no person wins the vote (which is what happens in an event
 * whose faces are embedded but not yet clustered).
 */
export async function matchSelfie(
  supabase: SupabaseDB,
  {
    userId,
    eventId,
    imageBase64,
  }: { userId: string; eventId: string; imageBase64: string }
): Promise<SelfieMatch> {
  const embedStarted = Date.now();
  const embedRes = await fetch(process.env.MODAL_AI_SELFIE_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pipeline_key: process.env.VIDEO_PIPELINE_KEY,
      image_b64: imageBase64,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!embedRes.ok) throw new Error(`embed_selfie ${embedRes.status}`);
  // Billed to the event owner whoever triggered it. Awaited — a void insert
  // at a step boundary loses the row.
  await recordUsage({
    userId,
    eventId,
    kind: "ai_embed_selfie",
    quantity: secondsSince(embedStarted),
    unit: "seconds",
  });

  const { faces } = (await embedRes.json()) as {
    faces: { embedding: number[] | null; quality: number }[];
  };
  const best = (faces ?? [])
    .filter((f) => f.embedding)
    .sort((a, b) => b.quality - a.quality)[0];
  if (!best) return { imageIds: [], matchedPerson: false, noFace: true };

  const { data: hits, error: rpcErr } = await supabase.rpc(
    "search_faces_by_embedding",
    {
      query_embedding: JSON.stringify(best.embedding),
      target_user_id: userId,
      target_event_id: eventId,
      match_threshold: 0.4,
      match_count: 200,
    }
  );
  if (rpcErr) throw rpcErr;

  const evidence = (hits ?? []).filter(
    (h: { similarity: number }) => h.similarity >= FACE_MATCH_FLOOR
  );

  // Person vote: the cluster with the most supporting hits wins; a single
  // very strong hit is enough on its own.
  const votes = new Map<string, { count: number; top: number }>();
  for (const h of evidence as { person_id: string | null; similarity: number }[]) {
    if (!h.person_id) continue;
    const v = votes.get(h.person_id) ?? { count: 0, top: 0 };
    v.count += 1;
    v.top = Math.max(v.top, h.similarity);
    votes.set(h.person_id, v);
  }
  let winner: string | null = null;
  for (const [personId, v] of votes) {
    if (v.count >= 2 || v.top >= STRONG_MATCH) {
      const cur = winner ? votes.get(winner)! : null;
      if (!cur || v.count > cur.count || (v.count === cur.count && v.top > cur.top)) {
        winner = personId;
      }
    }
  }

  if (!winner) {
    return {
      imageIds: [
        ...new Set(evidence.map((h: { image_id: string }) => h.image_id)),
      ],
      matchedPerson: false,
      noFace: false,
    };
  }

  // The person's COMPLETE set (clustering recall beats raw similarity).
  const ids = new Set<string>();
  for (let page = 0; ; page++) {
    const { data: rows, error } = await supabase
      .from("faces")
      .select("image_id")
      .eq("person_id", winner)
      .order("id", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    for (const r of rows ?? []) ids.add(r.image_id);
    if (!rows || rows.length < 1000) break;
  }
  return { imageIds: [...ids], matchedPerson: true, noFace: false };
}
