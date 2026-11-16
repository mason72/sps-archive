/** Read-only: download thumb-md for a JSON list of image ids into <dir>/NN.jpg.
 *   npx tsx scripts/triage/ids-thumbs.ts <ids.json> <dir> */
import fs from "node:fs";
import path from "node:path";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
async function main() {
  const [idsPath, dir] = process.argv.slice(2);
  const ids = JSON.parse(fs.readFileSync(idsPath, "utf8")) as string[];
  const { createClient } = await import("@supabase/supabase-js");
  const { getObjectBuffer, getThumbnailKey } = await import("../../src/lib/r2/client");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await s.from("images").select("id, r2_key").in("id", ids);
  if (error) throw error;
  const key = new Map((data ?? []).map((r) => [r.id, r.r2_key as string]));
  fs.mkdirSync(dir, { recursive: true });
  await Promise.all(ids.map(async (id, i) => {
    fs.writeFileSync(path.join(dir, `${String(i).padStart(2, "0")}.jpg`), await getObjectBuffer(getThumbnailKey(key.get(id)!), 5_000_000));
  }));
  console.log(ids.length);
}
main().catch((e) => { console.error(e); process.exit(1); });
