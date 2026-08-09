/**
 * Semantic-search E2E: embed_text (live Modal) → search_images_by_embedding
 * (live RPC, exactly the call the search route makes) → print ranked hits.
 * Read-only. Use for Phase 1 QA and threshold calibration.
 *
 *   npx tsx scripts/verify-semantic-search.ts "people laughing" [eventId]
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const query = process.argv[2];
  const eventId = process.argv[3] ?? null;
  if (!query) throw new Error('usage: verify-semantic-search.ts "<query>" [eventId]');

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Search as the archive owner (single-tenant today; the RPC requires it).
  const { data: anyEvent } = await supabase
    .from("events")
    .select("user_id")
    .limit(1)
    .single();
  if (!anyEvent) throw new Error("no events");

  const t0 = Date.now();
  const res = await fetch(process.env.MODAL_AI_EMBED_TEXT_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pipeline_key: process.env.VIDEO_PIPELINE_KEY, texts: [query] }),
  });
  if (!res.ok) throw new Error(`embed_text ${res.status}`);
  const { embeddings } = (await res.json()) as { embeddings: number[][] };
  const tEmbed = Date.now() - t0;

  const t1 = Date.now();
  const { data, error } = await supabase.rpc("search_images_by_embedding", {
    query_embedding: JSON.stringify(embeddings[0]),
    target_user_id: anyEvent.user_id,
    target_event_id: eventId,
    match_threshold: 0.0,
    match_count: 10,
  });
  if (error) throw error;

  console.log(`"${query}" — embed ${tEmbed}ms, search ${Date.now() - t1}ms`);
  for (const r of data ?? []) {
    console.log(`  ${r.similarity.toFixed(4)}  ${r.original_filename}`);
  }
  if (!data?.length) console.log("  (no results)");
}

main().catch((err) => {
  console.error("FAILED:", err.message ?? err);
  process.exit(1);
});
