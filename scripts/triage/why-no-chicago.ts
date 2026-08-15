/**
 * Ask SPS directly what it says about today's Chicago gig — is it absent from
 * the import list because it is still LIVE, or genuinely missing?
 * Token read from sps_connections and sent by header; never argv.
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: conn } = await s.from("sps_connections").select("token").limit(1).maybeSingle();
  if (!conn?.token) { console.log("no SPS connection"); return; }
  const base = (process.env.SPS_ARCHIVE_BASE_URL || "https://admin2.simplephotoshare.com/api/integrations/archive").replace(/\/+$/, "");
  const res = await fetch(`${base}/events`, { headers: { "X-SPS-Archive-Token": conn.token } });
  console.log("GET /events:", res.status);
  const j = await res.json();
  const events = Array.isArray(j) ? j : (j.events ?? j.data ?? []);
  if (!Array.isArray(events)) { console.log("shape:", JSON.stringify(j).slice(0, 400)); return; }
  console.log(`events returned: ${events.length}`);
  const hits = events.filter((e: { name: string }) => /chicago|jordan|foot locker|kfl/i.test(e.name));
  for (const e of hits) {
    console.log(JSON.stringify({ name: e.name, completedAt: e.completedAt, archiveEnabled: e.archiveEnabled, imageCount: e.imageCount }));
  }
  if (!hits.some((e: { name: string }) => /chicago/i.test(e.name))) {
    console.log("→ NO Chicago event in SPS's completed list at all.");
  }
}
main();
