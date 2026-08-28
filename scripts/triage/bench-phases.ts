/** Time each phase of one photo's ingest, to find where the 3.3s actually goes. */
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
const run = promisify(execFile);
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const ms = (t: number) => `${Math.round(t)}ms`;
async function main() {
  const zip = fs.readFileSync("/tmp/bigzip.txt", "utf8").trim();
  const entries = fs.readFileSync("/tmp/entries.txt", "utf8").split("\n").filter(Boolean);
  const { uploadToR2, deleteFromR2, buildImageKey } = await import("../../src/lib/r2/client");
  const { generateThumbnailsFromBuffer } = await import("../../src/lib/thumbnails/generate");
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const phases: Record<string, number[]> = { unzip: [], upload: [], thumbs: [], dbRead: [] };
  const N = 5;
  for (let i = 0; i < N; i++) {
    const entry = entries[Math.floor(entries.length * (i + 1) / (N + 1))];
    let t = performance.now();
    const { stdout } = await run("unzip", ["-p", zip, entry], { maxBuffer: 512*1024*1024, encoding: "buffer" } as never);
    const buffer = stdout as unknown as Buffer;
    phases.unzip.push(performance.now() - t);

    const id = randomUUID();
    const key = buildImageKey("bench-" + id, id + ".jpg");
    t = performance.now();
    await uploadToR2(key, buffer, "image/jpeg");
    phases.upload.push(performance.now() - t);

    t = performance.now();
    try { await generateThumbnailsFromBuffer(buffer, "bench-" + id, id + ".jpg"); } catch {}
    phases.thumbs.push(performance.now() - t);

    t = performance.now();
    await sb.from("images").select("id").limit(1);
    phases.dbRead.push(performance.now() - t);

    // clean up everything we just wrote
    try { await deleteFromR2(key); } catch {}
  }
  console.log(`photo size avg: ${Math.round(fs.statSync(zip).size / entries.length / 1024)} KB`);
  for (const [k, v] of Object.entries(phases)) {
    const avg = v.reduce((a,b)=>a+b,0)/v.length;
    console.log(`${k.padEnd(8)} avg ${ms(avg).padStart(7)}   (${v.map(x=>ms(x)).join(", ")})`);
  }
  const total = Object.values(phases).reduce((a,v)=>a+v.reduce((x,y)=>x+y,0)/v.length,0);
  console.log(`\nmeasured per-photo total: ${ms(total)}  → ${(1000/total).toFixed(2)} photos/sec ceiling`);
}
main().catch(e=>{console.error(String(e).slice(0,300));process.exit(1)});
