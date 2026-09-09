/** Remove the triage objects the throughput and PUT probes left in the bucket. */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local","utf8").split("\n")) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&process.env[m[1]]===undefined) process.env[m[1]]=m[2]; }
async function main(){
  const { deleteFromR2 } = await import("../../src/lib/r2/client");
  const keys = ["triage/r2-timing-0.bin","triage/r2-timing-1.bin","triage/r2-timing-2.bin","triage/put-probe.jpg"];
  for (const k of keys) {
    try { await deleteFromR2(k); console.log("deleted", k); }
    catch (e) { console.log("skip", k, String((e as Error).message).slice(0,60)); }
  }
}
main();
