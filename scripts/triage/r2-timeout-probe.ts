/**
 * Does the R2 client's timeout actually fire? Negative test: point the SAME
 * handler options at a blackhole address and expect a rejection in ~10s
 * (connectionTimeout), not a hang. Positive test: one HEAD against the real
 * bucket through src/lib/r2/client.ts to prove the option did not break it.
 *
 *   npx tsx scripts/triage/r2-timeout-probe.ts <existing-r2-key>
 */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local","utf8").split("\n")) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&process.env[m[1]]===undefined) process.env[m[1]]=m[2]; }
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";

async function main() {
  const blackhole = new S3Client({
    region: "auto",
    endpoint: "https://10.255.255.1",
    credentials: { accessKeyId: "x", secretAccessKey: "y" },
    requestHandler: { connectionTimeout: 10_000, requestTimeout: 120_000 },
    maxAttempts: 1,
  });
  let t = Date.now();
  try {
    await blackhole.send(new HeadObjectCommand({ Bucket: "b", Key: "k" }));
    console.log("blackhole: UNEXPECTEDLY RESOLVED");
  } catch (e) {
    console.log(`blackhole: rejected after ${((Date.now() - t) / 1000).toFixed(1)}s — ${(e as Error).name}: ${(e as Error).message.slice(0, 80)}`);
  }

  const key = process.argv[2];
  if (!key) { console.log("no key given; skipping the positive test"); return; }
  const { objectExistsInR2 } = await import("../../src/lib/r2/client");
  t = Date.now();
  const exists = await objectExistsInR2(key);
  console.log(`real bucket HEAD: exists=${exists} in ${Date.now() - t}ms`);
}
main();
