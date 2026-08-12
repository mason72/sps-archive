import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: secs } = await s.from("sections").select("id, name, sort_order, locked")
    .eq("event_id", "4ac80a42-88ee-4042-ab56-1d7962e72032").order("sort_order");
  for (const sec of secs ?? []) {
    const { count } = await s.from("section_images").select("image_id", {count:"exact", head:true}).eq("section_id", sec.id);
    console.log(`${sec.id}  ${String(sec.name).padEnd(20)} locked=${sec.locked}  images=${count}`);
  }
})();
