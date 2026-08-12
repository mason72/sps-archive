/**
 * Is SPS's copy byte-identical to the archive's, or a different export?
 * Downloads both and sha256-compares. Inference is what made the "SPS is
 * lossy" claim wrong for months — this measures.
 */
import fs from "node:fs";
import crypto from "node:crypto";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const PAIRS: [string, string][] = [
  ["Aamon Rizvi_26-08-07_Island_1189.jpg", "https://pub-7363d57d2cdd49c1b8651be00522eefa.r2.dev/895b8737-3def-48b2-b50c-5aa576924884/c17498d1-2ce8-4604-8cf9-3f29ec76ac65/6034e574-f944-4130-8b93-0e4140281746/original.jpg"],
  ["Alfred Arias_26-08-07_Island_159.jpg", "https://pub-7363d57d2cdd49c1b8651be00522eefa.r2.dev/895b8737-3def-48b2-b50c-5aa576924884/c17498d1-2ce8-4604-8cf9-3f29ec76ac65/3bdec4ce-42a3-41bc-ad17-32b893621600/original.jpg"],
  ["Luis cruz_26-08-07_Island_695.jpg", "https://pub-7363d57d2cdd49c1b8651be00522eefa.r2.dev/895b8737-3def-48b2-b50c-5aa576924884/c17498d1-2ce8-4604-8cf9-3f29ec76ac65/24c870fe-143d-4611-9982-92b67ab3100a/original.jpg"],
  ["Sam Vinson_26-08-07_Island_1150.jpg", "https://pub-7363d57d2cdd49c1b8651be00522eefa.r2.dev/895b8737-3def-48b2-b50c-5aa576924884/c17498d1-2ce8-4604-8cf9-3f29ec76ac65/116dd46f-a902-44d0-b129-22e91c0345e8/original.jpg"],
  ["Zaid Haq_26-08-07_Island_458.jpg", "https://pub-7363d57d2cdd49c1b8651be00522eefa.r2.dev/895b8737-3def-48b2-b50c-5aa576924884/c17498d1-2ce8-4604-8cf9-3f29ec76ac65/c08593a7-1989-4120-b1ba-2ce39b7877e3/original.jpg"],
];
(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const R2 = new S3Client({ region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! } });
  const B = process.env.R2_BUCKET_NAME!;
  const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex").slice(0, 16);

  for (const [name, url] of PAIRS) {
    const { data } = await s.from("images").select("r2_key, file_size")
      .eq("event_id", "4ac80a42-88ee-4042-ab56-1d7962e72032")
      .eq("original_filename", name).maybeSingle();
    if (!data) { console.log(`${name}: not in archive`); continue; }
    const obj = await R2.send(new GetObjectCommand({ Bucket: B, Key: data.r2_key }));
    const archiveBuf = Buffer.from(await obj.Body!.transformToByteArray());
    const res = await fetch(url);
    const spsBuf = Buffer.from(await res.arrayBuffer());
    const same = archiveBuf.equals(spsBuf);
    console.log(`${name}`);
    console.log(`   archive: ${archiveBuf.length} bytes  sha ${sha(archiveBuf)}`);
    console.log(`   SPS    : ${spsBuf.length} bytes  sha ${sha(spsBuf)}`);
    console.log(`   ${same ? "IDENTICAL" : `DIFFERENT  (SPS is ${(spsBuf.length/archiveBuf.length).toFixed(2)}x the archive)`}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
