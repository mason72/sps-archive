/**
 * Does uploadToR2 parallelise? Isolation test with synthetic 2 MB buffers —
 * same size as a real frame, so the network behaviour is representative.
 *
 * Written 2026-08-29 because a 4-worker pool produced ZERO throughput gain
 * (0.5 photos/s before and after), on a 238 Mbps link running at ~8 Mbps.
 * Neither bandwidth nor CPU explains that, so something serialises.
 */
import fs from "node:fs";
import { randomUUID, randomBytes } from "node:crypto";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
async function main() {
  const { uploadToR2, deleteFromR2, buildImageKey } = await import("../../src/lib/r2/client");
  const SIZE = 2 * 1024 * 1024;
  const bufs = Array.from({ length: 8 }, () => randomBytes(SIZE));
  const keys: string[] = [];
  const up = async (b: Buffer) => { const k = buildImageKey("bench", randomUUID() + ".jpg"); keys.push(k); await uploadToR2(k, b, "image/jpeg"); };

  // warm the connection so TLS handshake isn't counted against the first run
  await up(randomBytes(64 * 1024));

  let t = performance.now();
  for (const b of bufs.slice(0, 4)) await up(b);
  const seq = performance.now() - t;

  t = performance.now();
  await Promise.all(bufs.slice(4, 8).map(up));
  const par = performance.now() - t;

  console.log(`4x2MB SEQUENTIAL : ${Math.round(seq)}ms (${Math.round(seq/4)}ms each)`);
  console.log(`4x2MB CONCURRENT : ${Math.round(par)}ms (${Math.round(par/4)}ms each)`);
  console.log(`speedup ${(seq/par).toFixed(2)}x → ${par < seq * 0.65 ? "PARALLELISM WORKS" : "SERIALISED somewhere"}`);
  console.log(`effective throughput concurrent: ${((4*SIZE/1048576)/(par/1000)).toFixed(1)} MB/s`);
  for (const k of keys) { try { await deleteFromR2(k); } catch {} }
}
main().catch(e=>{console.error(String(e).slice(0,300));process.exit(1)});
