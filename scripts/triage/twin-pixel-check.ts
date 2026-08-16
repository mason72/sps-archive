import fs from "node:fs";
import crypto from "node:crypto";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
async function main() {
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { getPresignedDownloadUrl } = await import("../../src/lib/r2/client");
  const sharp = (await import("sharp")).default;
  const supabase = createServiceClient();
  const ids = ["b8cf474f-b0bb-42da-be86-fa917e63fb84", "1d5275dd-dcde-42b5-b937-d5be1326ddbb"];
  const { data: rows } = await supabase.from("images").select("id, r2_key, original_filename, taken_at, created_at").in("id", ids);
  for (const r of rows ?? []) {
    const url = await getPresignedDownloadUrl(r.r2_key, 600);
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    const img = sharp(buf);
    const meta = await img.metadata();
    const pixels = await img.raw().toBuffer();
    const pixelHash = crypto.createHash("sha256").update(pixels).digest("hex").slice(0, 16);
    console.log(`${r.original_filename}`);
    console.log(`  taken_at=${r.taken_at}  uploaded=${r.created_at}`);
    console.log(`  pixelHash=${pixelHash}  exif_bytes=${meta.exif?.length ?? 0}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
