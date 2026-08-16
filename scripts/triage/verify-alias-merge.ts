/**
 * Proof for person_aliases (migration 064): with a real alias row in place,
 * the index folds two tiles into one, the detail card agrees with the tile,
 * and the combined count equals the sum of the parts. The row is inserted,
 * verified, and REMOVED — production leaves this script exactly as it entered
 * (the durable merge is Mason's click in the UI, not a script's).
 *
 *   npx tsx scripts/triage/verify-alias-merge.ts
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const ALIAS = "Sami Hadouaj";
const CANONICAL = "Sami Hadouaj Mundra";

async function main() {
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { buildPeopleIndex, buildPersonDetail, normalizeNameKey } = await import(
    "../../src/lib/people/index-people"
  );
  const supabase = createServiceClient();

  const { data: ev } = await supabase
    .from("events")
    .select("user_id")
    .ilike("name", "%Goleta%")
    .limit(1)
    .maybeSingle();
  const userId = ev!.user_id;
  const aliasKey = normalizeNameKey(ALIAS);
  const canonicalKey = normalizeNameKey(CANONICAL);

  const countOf = (index: Awaited<ReturnType<typeof buildPeopleIndex>>, key: string) =>
    index.find((p) => p.key === key)?.imageCount ?? null;

  // Before: two tiles. The honest expectation for the merged count is the
  // UNION of their photo ids, not the sum — face-cluster membership already
  // put most of one identity's photos on the other's card (a cluster named
  // "Sami Hadouaj" whose photos are the Mundra spelling's files), and the
  // first run of this script failed by asserting a+b.
  const before = await buildPeopleIndex(supabase, userId);
  const a = countOf(before, aliasKey);
  const b = countOf(before, canonicalKey);
  console.log(`before: "${ALIAS}"=${a}  "${CANONICAL}"=${b}`);
  if (a === null || b === null) throw new Error("Expected both tiles before the merge");
  const idsOf = async (name: string) => {
    const d = await buildPersonDetail(supabase, userId, name);
    return new Set((d?.events ?? []).flatMap((e) => e.images.map((i) => i.id)));
  };
  const union = new Set([...(await idsOf(ALIAS)), ...(await idsOf(CANONICAL))]);
  console.log(`union of both cards' photo ids: ${union.size}`);

  // Insert the alias, verify, and remove — try/finally so a failed assertion
  // can never leave the temporary row behind.
  const { error: insErr } = await supabase.from("person_aliases").insert({
    user_id: userId,
    alias_key: aliasKey,
    canonical_key: canonicalKey,
    alias_name: ALIAS,
    canonical_name: CANONICAL,
  });
  if (insErr) throw insErr;
  try {
    const after = await buildPeopleIndex(supabase, userId);
    const merged = countOf(after, canonicalKey);
    const ghost = countOf(after, aliasKey);
    console.log(`after:  "${CANONICAL}"=${merged}  "${ALIAS}" tile=${ghost === null ? "gone" : ghost}`);

    const detail = await buildPersonDetail(supabase, userId, CANONICAL);
    const viaAlias = await buildPersonDetail(supabase, userId, ALIAS);
    console.log(`card via canonical: ${detail?.imageCount}, via alias spelling: ${viaAlias?.imageCount}`);
    console.log(`card aliases shown: ${JSON.stringify(detail?.aliases)}`);

    const pass =
      ghost === null &&
      merged === union.size &&
      detail?.imageCount === merged &&
      viaAlias?.imageCount === merged &&
      (detail?.aliases ?? []).some((s) => normalizeNameKey(s) === aliasKey);
    console.log(
      pass
        ? `\n✅ PASS — one tile of ${merged} (= the ${union.size}-photo union), card agrees from either spelling, alias visible`
        : "\n❌ FAIL"
    );
    if (!pass) process.exitCode = 1;
  } finally {
    const { error: delErr } = await supabase
      .from("person_aliases")
      .delete()
      .eq("user_id", userId)
      .eq("alias_key", aliasKey);
    if (delErr) {
      console.error("⚠️ FAILED TO REMOVE THE TEMPORARY ALIAS ROW — remove by hand:", delErr);
      process.exitCode = 1;
    } else {
      console.log("temporary alias row removed — production unchanged");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
