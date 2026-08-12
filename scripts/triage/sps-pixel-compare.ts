/** Same pixels, different container? Or a real re-encode? Decode both and diff. */
import fs from "node:fs";
import crypto from "node:crypto";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const PAIRS: [string, string][] = [
  ["Alfred Arias_26-08-07_Island_159.jpg", "https://pub-7363d57d2cdd49c1b8651be00522eefa.r2.dev/895b8737-3def-48b2-b50c-5aa576924884/c17498d1-2ce8-4604-8cf9-3f29ec76ac65/3bdec4ce-42a3-41bc-ad17-32b893621600/original.jpg"],
  ["Sam Vinson_26-08-07_Island_1150.jpg", "https://pub-7363d57d2cdd49c1b8651be00522eefa.r2.dev/895b8737-3def-48b2-b50c-5aa576924884/c17498d1-2ce8-4604-8cf9-3f29ec76ac65/116dd46f-a902-44d0-b129-22e91c0345e8/original.jpg"],
];
(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const sharp = (await import("sharp")).default;
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const R2 = new S3Client({ region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! } });
  const B = process.env.R2_BUCKET_NAME!;

  for (const [name, url] of PAIRS) {
    const { data } = await s.from("images").select("r2_key")
      .eq("event_id", "4ac80a42-88ee-4042-ab56-1d7962e72032")
      .eq("original_filename", name).maybeSingle();
    const obj = await R2.send(new GetObjectCommand({ Bucket: B, Key: data!.r2_key }));
    const a = Buffer.from(await obj.Body!.transformToByteArray());
    const b = Buffer.from(await (await fetch(url)).arrayBuffer());
    const ma = await sharp(a).metadata();
    const mb = await sharp(b).metadata();
    const ra = await sharp(a).raw().toBuffer();
    const rb = await sharp(b).raw().toBuffer();
    const pixSame = ra.equals(rb);
    let maxDiff = 0, sum = 0;
    if (ra.length === rb.length) {
      for (let i = 0; i < ra.length; i++) {
        const d = Math.abs(ra[i] - rb[i]);
        if (d > maxDiff) maxDiff = d;
        sum += d;
      }
    }
    console.log(`${name}`);
    console.log(`   archive ${ma.width}x${ma.height}  ${a.length}B   SPS ${mb.width}x${mb.height}  ${b.length}B`);
    console.log(`   pixels identical: ${pixSame}`);
    if (!pixSame && ra.length === rb.length)
      console.log(`   max channel delta: ${maxDiff}   mean delta: ${(sum/ra.length).toFixed(3)}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
