/** Probe: list R2 "folders" (CommonPrefixes) under a prefix. (2026-10-20) */
import fs from "node:fs";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

async function main() {
  const prefix = process.argv[2] ?? "";
  let token: string | undefined;
  let n = 0;
  const sample: string[] = [];
  do {
    const r = await r2.send(
      new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET_NAME!,
        Prefix: prefix,
        Delimiter: "/",
        ContinuationToken: token,
      })
    );
    for (const p of r.CommonPrefixes ?? []) {
      n++;
      if (sample.length < 12) sample.push(p.Prefix!);
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  console.log({ prefix, folders: n, sample });
}

main();
