/** Read-only: time each stage of a Highlights propose on one event.
 *   npx tsx scripts/triage/highlights-timing.ts <eventId> */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
async function main() {
  const [eventId] = process.argv.slice(2);
  const { createClient } = await import("@supabase/supabase-js");
  const { trainHighlightDirection } = await import("../../src/lib/highlights/direction");
  const { readFaces } = await import("../../src/lib/highlights/propose");
  const { embedTexts } = await import("../../src/lib/ai-index/embed-text");
  const { HIGHLIGHT_RULES, RULE_KEYS } = await import("../../src/lib/highlights/rules");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: ev } = await s.from("events").select("user_id").eq("id", eventId).single();
  const owner = ev!.user_id as string;
  const t = async <R>(label: string, f: () => Promise<R>) => { const a = Date.now(); const r = await f(); console.log(label.padEnd(34), ((Date.now() - a) / 1000).toFixed(1) + "s"); return r; };
  const ids: string[] = await t("read images (paged)", async () => {
    const out: string[] = [];
    for (let p = 0; ; p++) {
      const { data, error } = await s.from("images").select("id").eq("event_id", eventId).order("id").range(p * 1000, p * 1000 + 999);
      if (error) throw error; out.push(...(data ?? []).map((r) => r.id)); if (!data || data.length < 1000) break;
    }
    return out;
  });
  const dir = await t("train direction", () => trainHighlightDirection(s, owner, eventId));
  const scan = async (v: number[]) => { for (let p = 0; ; p++) { const { data, error } = await s.rpc("score_images_by_embedding", { query_embedding: JSON.stringify(v), target_user_id: owner, target_event_id: eventId }).order("id").range(p * 1000, p * 1000 + 999); if (error) throw error; if (!data || data.length < 1000) break; } };
  if (dir) await t("score direction (1 vector, paged)", () => scan(dir.vector));
  const { storedRuleVectors } = await import("../../src/lib/highlights/propose");
  const vecs = storedRuleVectors(RULE_KEYS.map((k) => HIGHLIGHT_RULES[k].text), new Set()) ?? await embedTexts(RULE_KEYS.map((k) => HIGHLIGHT_RULES[k].text), { userId: null, purpose: "highlights" });
  await t("score 9 vectors in ONE call", async () => { const { error } = await s.rpc("score_images_by_vectors", { query_embeddings: dir ? [dir.vector, ...vecs] : vecs, target_user_id: owner, target_event_id: eventId }); if (error) throw error; });
  await t("read faces, all images", () => readFaces(s, ids));
  await t("read faces + embeddings, 420 images", () => readFaces(s, ids.slice(0, 420), "id, image_id, person_id, bbox_x, bbox_y, bbox_w, bbox_h, embedding"));
  console.log("images", ids.length);
}
main().catch((e) => { console.error(e); process.exit(1); });
