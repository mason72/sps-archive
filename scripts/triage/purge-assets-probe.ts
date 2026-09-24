/**
 * Live check of src/lib/events/purge-assets.ts against the real bucket and DB.
 * Deletes ONLY throwaway objects it uploads itself, under a non-UUID folder
 * (`events/purge-probe-<rand>/`) that no event can own. The "another event
 * still references this key" check is exercised READ-ONLY on a real row's
 * key, so a bug in it cannot delete a real photo.
 *
 *   npx tsx scripts/triage/purge-assets-probe.ts
 */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local","utf8").split("\n")) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&process.env[m[1]]===undefined) process.env[m[1]]=m[2]; }

(async () => {
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { uploadToR2, objectExistsInR2, getThumbnailKey } = await import("../../src/lib/r2/client");
  const { keysStillReferenced, purgeEventAssets } = await import("../../src/lib/events/purge-assets");
  const db = createServiceClient();

  const dir = `events/purge-probe-${Math.random().toString(36).slice(2, 10)}/originals`;
  const fakes = [`${dir}/a.jpg`, `${dir}/b.jpg`];
  const footprint = (k: string) => [k, getThumbnailKey(k, "thumb-sm"), getThumbnailKey(k, "thumb-md"), getThumbnailKey(k, "thumb-lg")];
  const all = fakes.flatMap(footprint);
  for (const k of all) await uploadToR2(k, Buffer.from("probe"), "image/jpeg");
  const before = (await Promise.all(all.map(objectExistsInR2))).filter(Boolean).length;
  console.log(`uploaded ${before}/${all.length} throwaway objects under ${dir}`);

  const { data: real, error } = await db.from("images").select("r2_key").order("id").limit(1).single();
  if (error || !real) throw error ?? new Error("no real row");
  const refs = await keysStillReferenced(db, [real.r2_key, ...fakes]);
  const refOk = refs.size === 1 && refs.has(real.r2_key);
  console.log(`reference check: ${refOk ? "PASS" : "FAIL"} (real key kept, throwaways not) -> ${[...refs].join(", ")}`);

  const res = await purgeEventAssets(db, new Map(fakes.map((k) => [k, null])));
  const after = (await Promise.all(all.map(objectExistsInR2))).filter(Boolean).length;
  const purgeOk = res.deleted === 2 && res.kept === 0 && res.failedKeys.length === 0 && after === 0;
  console.log(`purge: ${purgeOk ? "PASS" : "FAIL"} deleted=${res.deleted} kept=${res.kept} failed=${res.failedKeys.length}, objects left=${after}`);
  const realStill = await objectExistsInR2(real.r2_key);
  console.log(`real file untouched: ${realStill ? "PASS" : "FAIL"}`);
  process.exit(refOk && purgeOk && realStill && before === all.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
