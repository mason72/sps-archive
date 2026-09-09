/** Round-trip latency to Supabase, on the same client the ingest uses. */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local","utf8").split("\n")) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&process.env[m[1]]===undefined) process.env[m[1]]=m[2]; }
async function main(){
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const time = async (label: string, fn: () => PromiseLike<unknown>) => {
    const t = Date.now(); let err = "";
    try { const r = await fn() as { error?: { message: string } }; if (r?.error) err = r.error.message.slice(0,60); }
    catch (e) { err = String((e as Error).message).slice(0,60); }
    console.log(`${String(Date.now()-t).padStart(7)} ms  ${label}${err ? "  ERROR: "+err : ""}`);
  };
  await time("trivial select (events limit 1)", () => db.from("events").select("id").limit(1));
  await time("images select by event (limit 1)", () => db.from("images").select("id").limit(1));
  await time("faces count (the HNSW table)", () => db.from("faces").select("id", { count: "exact", head: true }));
  await time("trivial select again", () => db.from("events").select("id").limit(1));
}
main();
