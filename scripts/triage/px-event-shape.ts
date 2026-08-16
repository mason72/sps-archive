import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const id = process.argv[2];
  const img = await sb.from("images").select("*", { count: "exact", head: true }).eq("event_id", id);
  console.log("images in event:", img.count);
  const { data: secs } = await sb.from("sections").select("id,name").eq("event_id", id);
  let links = 0;
  for (const s of secs ?? []) {
    const r = await sb.from("section_images").select("*", { count: "exact", head: true }).eq("section_id", s.id);
    console.log(`  section "${s.name}": ${r.count} links`);
    links += r.count ?? 0;
  }
  console.log("total section links:", links);
  console.log(links > (img.count ?? 0) ? "→ links EXCEED images: photos are shared across sections (dedupe)" : "→ links match images: no sharing");
}
main().catch((e) => { console.error(e); process.exit(1); });
