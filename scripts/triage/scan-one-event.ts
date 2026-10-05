/**
 * Run the identity scan on ONE gallery, exactly as the Inngest lane does —
 * the per-gallery form of scripts/scan-identity-suggestions.ts, for watching
 * a single run (first live auto-confirm, 2026-10-04). Writes suggestions and,
 * where the engine is sure, applies them (identity-suggestions.ts).
 *
 *   npx tsx scripts/triage/scan-one-event.ts <eventId>
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
async function main() {
  const eventId = process.argv[2];
  if (!eventId) throw new Error("usage: scan-one-event.ts <eventId>");
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { scanEventForIdentitySuggestions } = await import("../../src/lib/people/identity-suggestions");
  const supabase = createServiceClient();
  const { data: ev, error } = await supabase.from("events").select("id, name, user_id").eq("id", eventId).single();
  if (error || !ev) throw new Error(error?.message ?? "event not found");
  console.log(`scanning ${ev.name}`);
  const t0 = Date.now();
  const r = await scanEventForIdentitySuggestions(supabase, ev.user_id, eventId);
  console.log(JSON.stringify(r), `${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const { data: rows } = await supabase
    .from("person_identity_suggestions")
    .select("kind, suggested_name, confidence, status, decided_by, photo_count")
    .eq("event_id", eventId)
    .order("decided_at", { ascending: false, nullsFirst: false })
    .limit(15);
  for (const s of rows ?? []) console.log(`  ${s.status.padEnd(9)} ${(s.decided_by ?? "-").padEnd(5)} ${s.kind.padEnd(5)} ${s.confidence.toFixed(3)} ${String(s.photo_count).padStart(3)}  ${s.suggested_name}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
