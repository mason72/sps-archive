import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const rows: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data } = await s.from("images")
      .select("id, original_filename, width, height, thumbnail_generated, dominant_color, focal_x, focal_y")
      .eq("event_id", "4ac80a42-88ee-4042-ab56-1d7962e72032").range(f, f + 999);
    rows.push(...(data ?? [])); if (!data || data.length < 1000) break;
  }
  const noDims = rows.filter(r => !r.width || !r.height);
  const noThumb = rows.filter(r => !r.thumbnail_generated);
  const noColor = rows.filter(r => !r.dominant_color);
  const noFocal = rows.filter(r => r.focal_x == null || r.focal_y == null);
  console.log(`rows:                 ${rows.length}`);
  console.log(`missing width/height: ${noDims.length}`);
  console.log(`no thumbnail:         ${noThumb.length}`);
  console.log(`no dominant_color:    ${noColor.length}`);
  console.log(`no focal point:       ${noFocal.length}`);
  for (const r of noDims.slice(0, 10)) console.log(`   dims: ${r.original_filename}`);
})();
