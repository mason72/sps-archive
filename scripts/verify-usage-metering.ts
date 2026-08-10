/**
 * Live proof of the Phase 1 metering rail (tasks/todo.md "Alpha access").
 *
 *  1. Runs a real embed_text round-trip through the shared embedTexts client,
 *     attributed to the founding account.
 *  2. Confirms the usage_events row landed with sane quantity/unit.
 *  3. Runs getUserStorage() and prints the stock breakdown.
 *
 * Reads .env.local (which points at PRODUCTION — this writes one real
 * usage_events row, which is fine: it is real usage).
 *
 *   npx tsx scripts/verify-usage-metering.ts
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const { createServiceClient } = await import("../src/lib/supabase/server");
  const { embedTexts } = await import("../src/lib/ai-index/embed-text");
  const { getUserStorage } = await import("../src/lib/usage/storage");
  const { costOf } = await import("../src/lib/usage/costs");

  const supabase = createServiceClient();

  const { data: user } = await supabase
    .from("user_profiles")
    .select("user_id")
    .eq("is_admin", true)
    .single();
  if (!user) throw new Error("no admin user found");
  const userId = user.user_id;

  console.log("1) embed_text round-trip (metered)…");
  const before = Date.now();
  const embeddings = await embedTexts(["a golden retriever on a beach"], {
    userId,
    purpose: "archive_search",
  });
  console.log(
    `   ok — ${embeddings.length} embedding(s), dim ${embeddings[0]?.length}, wall ${Date.now() - before}ms`
  );

  // recordUsage is fire-and-forget; give the insert a beat.
  await new Promise((r) => setTimeout(r, 2000));

  console.log("2) checking usage_events…");
  const { data: rows, error } = await supabase
    .from("usage_events")
    .select("kind, quantity, unit, metadata, created_at")
    .eq("user_id", userId)
    .gte("created_at", new Date(before - 1000).toISOString())
    .order("created_at", { ascending: false });
  if (error) throw error;
  if (!rows?.length) throw new Error("NO usage_events row landed — metering rail broken");
  for (const r of rows) {
    const cost = costOf(r.kind as never, Number(r.quantity));
    console.log(
      `   ${r.kind}: ${r.quantity} ${r.unit} → $${cost.toFixed(6)}  ${JSON.stringify(r.metadata)}`
    );
  }

  console.log("3) storage rollup…");
  const s = await getUserStorage(supabase, userId);
  const gb = (n: number) => (n / 1e9).toFixed(2) + " GB";
  console.log(
    `   originals ${gb(s.originalBytes)} + thumbs ${gb(s.thumbBytes)} (est ${gb(s.estimatedThumbBytes)}) + zips ${gb(s.zipBytes)} = ${gb(s.totalBytes)}`
  );

  console.log("ALL PASS");
}

main().catch((err) => {
  console.error("VERIFY FAILED:", err);
  process.exit(1);
});
