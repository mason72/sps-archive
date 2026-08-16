/**
 * Archive-wide naming-engine backfill: scan every event's anonymous face
 * clusters against the reference library and write suggestions.
 *
 * PRE-REQ, once: the FULL reference seed cannot fit PostgREST's 8s statement
 * budget, so it runs through the Management API (done 2026-08-16, 1,447 rows):
 *
 *   npx tsx scripts/db-sql.ts --query "select refresh_person_reference_centroids('<userId>'::uuid, null)"
 *
 * After that, per-event scoped refreshes (inside the scan) keep the library
 * current forever — clustering and confirms only ever change one event.
 *
 *   npx tsx scripts/scan-identity-suggestions.ts          # dry: report only
 *   npx tsx scripts/scan-identity-suggestions.ts --apply  # write suggestions
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const apply = process.argv.includes("--apply");
  const { createServiceClient } = await import("../src/lib/supabase/server");
  const { scanEventForIdentitySuggestions, SUGGESTION_CONFIDENCE_FLOOR } = await import(
    "../src/lib/people/identity-suggestions"
  );
  const supabase = createServiceClient();

  console.log(`confidence floor: ${SUGGESTION_CONFIDENCE_FLOOR}${apply ? "" : "  (DRY RUN — nothing written)"}`);

  // Events that actually hold anonymous clusters — no reason to touch the
  // rest. PAGED: the first version used one .range(0, 9999) call, PostgREST
  // silently capped it at 1,000 rows, and the report showed 7 events summing
  // to exactly 1,000 — WACA (the biggest group-shot gallery in the archive)
  // simply missing. A truncated read is indistinguishable from a real
  // absence; the tell is a round number.
  const byEvent = new Map<string, { userId: string; name: string; clusters: number }>();
  for (let page = 0; ; page++) {
    const { data: candidates, error } = await supabase
      .from("persons")
      .select("id, event_id, events!inner(user_id, name)")
      .is("name", null)
      .gte("face_count", 2)
      .order("id")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    for (const row of candidates ?? []) {
      const ev = row.events as unknown as { user_id: string; name: string };
      const cur = byEvent.get(row.event_id) ?? { userId: ev.user_id, name: ev.name, clusters: 0 };
      cur.clusters += 1;
      byEvent.set(row.event_id, cur);
    }
    if (!candidates || candidates.length < 1000) break;
  }
  console.log(`events with anonymous clusters: ${byEvent.size}\n`);

  if (!apply) {
    for (const [id, e] of [...byEvent.entries()].sort((a, b) => b[1].clusters - a[1].clusters).slice(0, 20)) {
      console.log(`  ${String(e.clusters).padStart(4)}  ${e.name}  (${id.slice(0, 8)})`);
    }
    console.log(`\nDry run. Re-run with --apply to scan and write suggestions.`);
    return;
  }

  let totalSuggested = 0;
  let done = 0;
  for (const [eventId, e] of byEvent) {
    const result = await scanEventForIdentitySuggestions(supabase, e.userId, eventId);
    totalSuggested += result.suggested;
    done += 1;
    if (result.suggested > 0 || done % 10 === 0) {
      console.log(
        `[${done}/${byEvent.size}] ${e.name}: ${result.anonymousClusters} anonymous, ${result.suggested} suggested`
      );
    }
  }

  const { count: pending } = await supabase
    .from("person_identity_suggestions")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  console.log(`\nscan complete: ${totalSuggested} suggestions written this run, ${pending} pending total`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
