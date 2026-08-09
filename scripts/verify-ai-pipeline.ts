/**
 * Smoke test for the rebuilt Modal AI pipeline (sps-archive-ai v2).
 *
 * Read-only: picks a handful of thumbnailed images (sandbox event preferred),
 * presigns thumb-lg GETs, runs them through index_images, and validates the
 * contract — 1152-dim normalized SigLIP-2 embeddings, 512-dim normalized face
 * embeddings, aesthetic/sharpness in [0,1]. Then embeds a few text queries and
 * prints the cosine ranking against the batch so retrieval can be eyeballed.
 * Also asserts both endpoints 401 without the pipeline key.
 *
 * Writes NOTHING to the database or R2. Costs ~pennies of Modal compute.
 *
 *   npx tsx scripts/verify-ai-pipeline.ts
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const INDEX_URL =
  process.env.MODAL_AI_INDEX_URL ??
  "https://mason72--sps-archive-ai-aiindexer-index-images.modal.run";
const EMBED_TEXT_URL =
  process.env.MODAL_AI_EMBED_TEXT_URL ??
  "https://mason72--sps-archive-ai-embed-text.modal.run";

const QUERIES = process.env.AI_VERIFY_QUERIES?.split("|") ?? [
  "a portrait photo of a person",
  "a group of people",
  "a car",
  "a building or venue",
];

function cosine(a: number[], b: number[]) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // both sides are L2-normalized
}

function norm(v: number[]) {
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0));
}

async function main() {
  const key = process.env.VIDEO_PIPELINE_KEY;
  if (!key) throw new Error("VIDEO_PIPELINE_KEY missing from .env.local");

  const { createClient } = await import("@supabase/supabase-js");
  const { getPresignedDownloadUrl, getThumbnailKey } = await import(
    "../src/lib/r2/client"
  );
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Sandbox event preferred; fall back to any thumbnailed images.
  const { data: sandbox } = await supabase
    .from("events")
    .select("id, name")
    .ilike("name", "%sample%")
    .limit(1)
    .maybeSingle();
  let query = supabase
    .from("images")
    .select("id, r2_key, original_filename")
    .eq("thumbnail_generated", true)
    .eq("media_type", "image")
    .limit(6);
  if (sandbox) query = query.eq("event_id", sandbox.id);
  const { data: images, error } = await query;
  if (error || !images?.length) throw new Error(`no test images: ${error?.message}`);
  console.log(
    `Testing ${images.length} images from ${sandbox ? `"${sandbox.name}"` : "the archive"}`
  );

  const payload = {
    pipeline_key: key,
    images: await Promise.all(
      images.map(async (img) => ({
        id: img.id,
        url: await getPresignedDownloadUrl(getThumbnailKey(img.r2_key, "thumb-lg"), 900),
      }))
    ),
  };

  // ── auth gate ──
  for (const url of [INDEX_URL, EMBED_TEXT_URL]) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pipeline_key: "wrong", images: [], texts: ["x"] }),
    });
    if (res.status !== 401) throw new Error(`AUTH HOLE: ${url} → ${res.status}`);
  }
  console.log("✓ both endpoints 401 a bad pipeline_key");

  // ── index_images ──
  const t0 = Date.now();
  const res = await fetch(INDEX_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`index_images ${res.status}: ${await res.text()}`);
  const out = (await res.json()) as {
    model: string;
    results: Record<
      string,
      {
        embedding: number[];
        aestheticScore: number;
        sharpnessScore: number;
        faces: { bbox: object; embedding: number[] | null; quality: number; eyesOpen: boolean | null }[];
      }
    >;
    errors: Record<string, string>;
  };
  console.log(
    `✓ index_images: ${Object.keys(out.results).length} results, ` +
      `${Object.keys(out.errors).length} errors in ${((Date.now() - t0) / 1000).toFixed(1)}s (model ${out.model})`
  );
  for (const [id, msg] of Object.entries(out.errors)) console.log(`  ✗ ${id}: ${msg}`);

  let faceCount = 0;
  for (const [id, r] of Object.entries(out.results)) {
    const name = images.find((i) => i.id === id)?.original_filename ?? id;
    if (r.embedding.length !== 1152) throw new Error(`${name}: embedding dim ${r.embedding.length}`);
    if (Math.abs(norm(r.embedding) - 1) > 0.01) throw new Error(`${name}: embedding not normalized`);
    if (r.aestheticScore < 0 || r.aestheticScore > 1) throw new Error(`${name}: aesthetic ${r.aestheticScore}`);
    if (r.sharpnessScore < 0 || r.sharpnessScore > 1) throw new Error(`${name}: sharpness ${r.sharpnessScore}`);
    for (const f of r.faces) {
      faceCount++;
      if (f.embedding) {
        if (f.embedding.length !== 512) throw new Error(`${name}: face dim ${f.embedding.length}`);
        if (Math.abs(norm(f.embedding) - 1) > 0.01) throw new Error(`${name}: face embedding not normalized`);
      }
    }
    console.log(
      `  ${name}: aesthetic ${r.aestheticScore}, sharpness ${r.sharpnessScore}, ` +
        `${r.faces.length} face(s)${r.faces.map((f) => ` q=${f.quality.toFixed(2)} eyes=${f.eyesOpen}`).join(",")}`
    );
  }
  console.log(`✓ contract valid: 1152-dim normalized, ${faceCount} faces (512-dim normalized)`);

  // ── embed_text + retrieval sanity ──
  const t1 = Date.now();
  const textRes = await fetch(EMBED_TEXT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pipeline_key: key, texts: QUERIES }),
  });
  if (!textRes.ok) throw new Error(`embed_text ${textRes.status}: ${await textRes.text()}`);
  const textOut = (await textRes.json()) as { embeddings: number[][] };
  console.log(`✓ embed_text: ${textOut.embeddings.length} queries in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  if (textOut.embeddings.some((e) => e.length !== 1152)) throw new Error("text embedding dim mismatch");

  console.log("\nRetrieval ranking (cosine, best image per query):");
  for (let q = 0; q < QUERIES.length; q++) {
    const ranked = Object.entries(out.results)
      .map(([id, r]) => ({
        name: images.find((i) => i.id === id)?.original_filename ?? id,
        sim: cosine(textOut.embeddings[q], r.embedding),
      }))
      .sort((a, b) => b.sim - a.sim);
    console.log(
      `  "${QUERIES[q]}" → ${ranked[0].name} (${ranked[0].sim.toFixed(3)}); ` +
        `spread ${(ranked[0].sim - ranked[ranked.length - 1].sim).toFixed(3)}`
    );
  }
  console.log("\nALL CHECKS PASSED");
}

main().catch((err) => {
  console.error("FAILED:", err.message ?? err);
  process.exit(1);
});
