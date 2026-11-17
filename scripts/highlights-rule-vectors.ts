/**
 * Write src/lib/highlights/rule-vectors.json: the text vector of every
 * Highlights rule phrase (rules.ts), so a propose never waits on the embedding
 * service for phrases that only change in code (it was 28 s cold, 2026-11-16).
 * Re-run after changing any phrase; a test fails until you do.
 *
 *   npx tsx scripts/highlights-rule-vectors.ts
 *
 * One embed call, not metered (no user). The model id must match the image
 * pipeline's (modal/ai_pipeline.py SIGLIP2_MODEL); propose falls back to a live
 * embed for any event whose photos carry a different model.
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
async function main() {
  const { HIGHLIGHT_RULES, RULE_KEYS } = await import("../src/lib/highlights/rules");
  const { embedTexts } = await import("../src/lib/ai-index/embed-text");
  const pipeline = fs.readFileSync("modal/ai_pipeline.py", "utf8").match(/SIGLIP2_MODEL = "([^"]+)"/)?.[1];
  if (!pipeline) throw new Error("could not read SIGLIP2_MODEL from modal/ai_pipeline.py");
  const texts = RULE_KEYS.map((k) => HIGHLIGHT_RULES[k].text);
  const vectors = await embedTexts(texts, { userId: null, purpose: "highlights" });
  if (vectors.length !== texts.length || vectors.some((v) => v.length !== 1152)) {
    throw new Error(`embed_text returned ${vectors.length} vectors of ${vectors[0]?.length}`);
  }
  const out = {
    model: pipeline,
    generatedAt: new Date().toISOString().slice(0, 10),
    phrases: Object.fromEntries(
      RULE_KEYS.map((k, i) => [k, { text: texts[i], vector: vectors[i].map((x) => Math.round(x * 1e6) / 1e6) }])
    ),
  };
  fs.writeFileSync("src/lib/highlights/rule-vectors.json", JSON.stringify(out) + "\n");
  console.log("wrote", RULE_KEYS.length, "vectors for", pipeline);
}
main().catch((e) => { console.error(e); process.exit(1); });
