/**
 * Text-embedding client — the ONE caller of the Modal embed_text endpoint.
 *
 * Every semantic-search surface (archive search, guest gallery search, scene
 * planning) goes through here so the request contract, timeout handling, and
 * usage metering live in one place instead of three copy-pasted fetches.
 *
 * Attribution: guest-triggered searches bill the EVENT OWNER — the cost
 * belongs to the account whose gallery is being searched.
 */

import { recordUsage, secondsSince } from "@/lib/usage/record";

export interface EmbedAttribution {
  /** Event owner's user id. Null skips metering (ownerless legacy events). */
  userId: string | null;
  eventId?: string | null;
  purpose: "archive_search" | "guest_search" | "scene_plan";
}

export async function embedTexts(
  texts: string[],
  attribution: EmbedAttribution,
  timeoutMs = 45_000
): Promise<number[][]> {
  const url = process.env.MODAL_AI_EMBED_TEXT_URL;
  if (!url) throw new Error("AI search is not configured");

  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pipeline_key: process.env.VIDEO_PIPELINE_KEY,
      texts,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`embed_text ${res.status}`);
  const { embeddings } = (await res.json()) as { embeddings: number[][] };

  // Awaited, not void: a fire-and-forget insert races the lambda freeze and
  // silently drops rows (caught in review). recordUsage never throws.
  if (attribution.userId) {
    await recordUsage({
      userId: attribution.userId,
      eventId: attribution.eventId,
      kind: "ai_embed_text",
      quantity: secondsSince(started),
      unit: "seconds",
      metadata: { texts: texts.length, purpose: attribution.purpose },
    });
  }

  return embeddings;
}
