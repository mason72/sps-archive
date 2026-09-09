/** How long does a realistic photo-sized PUT to R2 actually take? */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local","utf8").split("\n")) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&process.env[m[1]]===undefined) process.env[m[1]]=m[2]; }
async function main(){
  const { uploadToR2 } = await import("../../src/lib/r2/client");
  const buf = Buffer.alloc(5 * 1024 * 1024, 7);   // 5 MB, a plausible JPEG
  const times: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t = Date.now();
    await uploadToR2(`triage/r2-timing-${i}.bin`, buf, "application/octet-stream");
    times.push(Date.now() - t);
  }
  console.log("5 MB PUT ms:", times.join(", "));
  console.log("throughput:", (5 / (times.reduce((a,b)=>a+b,0)/times.length/1000)).toFixed(1), "MB/s");
}
main().catch((e) => { console.error("FAILED:", String(e?.message ?? e).slice(0,200)); process.exit(1); });
