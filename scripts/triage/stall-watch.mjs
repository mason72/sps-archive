// Emits ONLY on a stall or on drain. Silence means healthy.
import fs from "node:fs";
process.chdir(process.env.HOME + "/Projects/SPS/sps-archive");
for (const line of fs.readFileSync(".env.local","utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const { createClient } = await import("@supabase/supabase-js");
const { execFileSync } = await import("node:child_process");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const total = async () => (await sb.from("images").select("id",{count:"exact",head:true})).count;
const running = () => { try { execFileSync("pgrep",["-f","ingest-loop.sh"]); return true; } catch { return false; } };
const verified = () => {
  const q = JSON.parse(fs.readFileSync("scripts/pixieset/data/queue.json","utf8"));
  return Object.values(q.collections).filter(c=>c.state==="verified").length;
};
let last = await total(), flat = 0;
const INTERVAL = 180_000;
for (;;) {
  await new Promise(r=>setTimeout(r, INTERVAL));
  if (!running()) {
    console.log(`LOOP NOT RUNNING — ${verified()} collections still verified, ${await total()} images archive-wide`);
    break;
  }
  const now = await total();
  if (now === last) {
    flat++;
    if (flat >= 2) {  // ~6 minutes with zero rows written
      const { count: ghosts } = await sb.from("images").select("id",{count:"exact",head:true})
        .is("thumb_bytes",null).is("width",null);
      console.log(`STALL: no new rows in ${(flat*INTERVAL/60000)|0} min (total ${now}); half-written rows = ${ghosts}; verified left = ${verified()}`);
      flat = 0;
    }
  } else { flat = 0; }
  last = now;
  if (verified() === 0) { console.log(`DRAINED — 0 collections verified, ${now} images archive-wide`); break; }
}
