/** Probe: does R2's ListObjectsV2 report StorageClass and LastModified per key? (2026-10-20) */
import fs from "node:fs";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
});
const prefix = process.argv[2] ?? "events/";
const startAfter = process.argv[3];
r2.send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET_NAME!, Prefix: prefix, StartAfter: startAfter, MaxKeys: 1000 }))
  .then((r) => {
    const rows = r.Contents ?? [];
    const classes: Record<string, number> = {};
    for (const o of rows) classes[String(o.StorageClass)] = (classes[String(o.StorageClass)] ?? 0) + 1;
    console.log({ count: rows.length, truncated: r.IsTruncated, classes });
    for (const o of rows.filter((o) => o.StorageClass === "STANDARD_IA").slice(0, 3)) console.log(o.Key, o.StorageClass, o.LastModified);
    for (const o of rows.slice(0, 3)) console.log(o.Key, o.StorageClass, o.LastModified, o.Size);
  });
