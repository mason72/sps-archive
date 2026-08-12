import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const { parseFilename } = await import("../../src/lib/upload/parse-filename");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await s.from("images")
    .select("original_filename, parsed_name")
    .eq("event_id", "4ac80a42-88ee-4042-ab56-1d7962e72032")
    .limit(12);
  for (const r of data ?? []) {
    console.log(`file: ${r.original_filename}`);
    console.log(`  parsed_name in DB : "${r.parsed_name}"`);
    console.log(`  parseFilename()   : "${parseFilename(r.original_filename).name}"`);
  }
})();
