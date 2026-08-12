import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const { S3Client, HeadObjectCommand } = await import("@aws-sdk/client-s3");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const R2 = new S3Client({ region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! } });
  const B = process.env.R2_BUCKET_NAME!;
  const rows: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data } = await s.from("images").select("id, original_filename, file_size, r2_key")
      .eq("event_id", "4ac80a42-88ee-4042-ab56-1d7962e72032").range(f, f + 999);
    rows.push(...(data ?? [])); if (!data || data.length < 1000) break;
  }
  const bad: string[] = []; let cur = 0;
  await Promise.all(Array.from({length:24}, async () => { for(;;){ const i=cur++; if(i>=rows.length) return;
    try { const h = await R2.send(new HeadObjectCommand({Bucket:B, Key:rows[i].r2_key}));
      if (h.ContentLength !== rows[i].file_size) bad.push(rows[i].original_filename); } catch {} }}));
  bad.sort();
  fs.writeFileSync("island-reupload-list.txt",
    `Island HQ Headshot Day — ${bad.length} photos to re-upload from the Capture One session\n` +
    `(these were never actually sent; their rows must be deleted first or the\n` +
    ` duplicate guard will silently skip them)\n\n` + bad.join("\n") + "\n");
  console.log(`wrote island-reupload-list.txt — ${bad.length} files`);
})().catch(e => { console.error(e); process.exit(1); });
