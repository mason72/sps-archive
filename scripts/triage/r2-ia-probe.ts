/**
 * Probe: move ONE original to R2 Infrequent Access by copying it onto itself,
 * and prove nothing about the photo changed.
 *
 *   npx tsx scripts/triage/r2-ia-probe.ts <r2_key>
 *
 * Checks, in order: sha256 and Content-Type before; CopyObject in place with
 * StorageClass STANDARD_IA (guarded by the ETag just read); HeadObject reports
 * STANDARD_IA; sha256, length and Content-Type after are identical; a presigned
 * GET (the way every reader fetches an original) answers 200 with those bytes.
 * Written 2026-10-20 before building src/lib/r2/tiering.ts.
 */
import fs from "node:fs";
import { createHash } from "node:crypto";
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const key = process.argv[2];
if (!key || !key.includes("/originals/")) {
  console.error("usage: r2-ia-probe.ts <events/<id>/originals/<file>>");
  process.exit(2);
}
const Bucket = process.env.R2_BUCKET_NAME!;
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
  requestHandler: { connectionTimeout: 10_000, requestTimeout: 120_000 },
});

async function digest(): Promise<{ sha: string; len: number; type?: string }> {
  const res = await r2.send(new GetObjectCommand({ Bucket, Key: key }));
  const bytes = Buffer.from(await res.Body!.transformToByteArray());
  return { sha: createHash("sha256").update(bytes).digest("hex"), len: bytes.length, type: res.ContentType };
}

async function main() {
  const head0 = await r2.send(new HeadObjectCommand({ Bucket, Key: key }));
  console.log("before:", head0.StorageClass ?? "(none reported)", head0.ContentType, head0.ContentLength);
  const before = await digest();

  await r2.send(
    new CopyObjectCommand({
      Bucket,
      Key: key,
      CopySource: encodeURI(`${Bucket}/${key}`),
      CopySourceIfMatch: head0.ETag,
      MetadataDirective: "COPY",
      StorageClass: "STANDARD_IA",
    })
  );

  const head1 = await r2.send(new HeadObjectCommand({ Bucket, Key: key }));
  console.log("after: ", head1.StorageClass ?? "(none reported)", head1.ContentType, head1.ContentLength);
  const after = await digest();

  const url = await getSignedUrl(r2, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: 60 });
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const viaUrl = createHash("sha256").update(Buffer.from(await res.arrayBuffer())).digest("hex");

  const checks = {
    storageClassIsIA: head1.StorageClass === "STANDARD_IA",
    sameSha: before.sha === after.sha,
    sameLength: before.len === after.len,
    sameType: before.type === after.type,
    presignedGet200: res.status === 200,
    presignedSameSha: viaUrl === before.sha,
  };
  console.log(checks);
  process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
