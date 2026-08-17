import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const id = process.argv[2];
  const { data, error } = await sb
    .from("images")
    .select("id,original_filename,thumbnail_generated,processing_status")
    .eq("event_id", id)
    .eq("thumbnail_generated", false);
  if (error) throw error;
  console.log("images without thumbnails:", data?.length ?? 0);
  for (const r of data ?? []) console.log("  ", r.original_filename, "| status:", r.processing_status);
}
main().catch((e) => { console.error(e); process.exit(1); });
