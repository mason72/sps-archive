/**
 * Would deduping the TDP Website gallery change the LIVE SITE?
 *
 * Membership in that gallery IS publication, and scenes consume their section
 * in three different ways (src/lib/site/scenes.ts):
 *   - ordered — image N fills page position N, and `positions` says how many
 *               the page actually uses. Removing a row SHIFTS everything after
 *               it, so a removal inside the used range changes the page.
 *   - slot    — the FIRST image by section order (rotating ones sample a `lead`
 *               pool). Removing anything above the lead can change what shows.
 *   - pool    — a sampled rotating grid; membership is a bag, order barely
 *               matters, and a duplicate is just a doubled chance of the same
 *               photo appearing twice.
 *
 * So "is it safe" is per-scene, not per-gallery. Read-only.
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { SITE_SCENES } = await import("../../src/lib/site/scenes");
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const manifest = JSON.parse(
    fs.readFileSync("tasks/dedupe-manifest.json", "utf8")
  ) as Array<{ name: string; eventId: string; deletions: Array<{ keep: string; remove: string; key: string }> }>;
  const tdp = manifest.find((e) => e.name === "TDP Website");
  if (!tdp) {
    console.log("TDP Website has no planned deletions.");
    return;
  }

  const sceneByKey = new Map(SITE_SCENES.map((sc) => [sc.key, sc]));

  const { data: sections } = await s
    .from("sections")
    .select("id, name, site_scene_key")
    .eq("event_id", tdp.eventId);
  const sectionById = new Map(
    (sections ?? []).map((x: { id: string; name: string; site_scene_key: string | null }) => [x.id, x])
  );

  const ids = [...new Set(tdp.deletions.flatMap((d) => [d.keep, d.remove]))];
  const memberships = new Map<string, Array<{ sectionId: string; sortOrder: number }>>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await s
      .from("section_images")
      .select("image_id, section_id, sort_order")
      .in("image_id", ids.slice(i, i + 200));
    for (const r of (data ?? []) as Array<{ image_id: string; section_id: string; sort_order: number }>) {
      memberships.set(r.image_id, [
        ...(memberships.get(r.image_id) ?? []),
        { sectionId: r.section_id, sortOrder: r.sort_order },
      ]);
    }
  }

  // Section sizes, so an ordered scene's used range can be judged.
  const sectionSize = new Map<string, number>();
  for (const sec of sections ?? []) {
    const { count } = await s
      .from("section_images")
      .select("image_id", { count: "exact", head: true })
      .eq("section_id", (sec as { id: string }).id);
    sectionSize.set((sec as { id: string }).id, count ?? 0);
  }

  type Verdict = "SAFE" | "CHANGES PAGE" | "REVIEW";
  const rows: Array<{ verdict: Verdict; scene: string; kind: string; detail: string }> = [];

  for (const d of tdp.deletions) {
    const rm = memberships.get(d.remove) ?? [];
    const kp = memberships.get(d.keep) ?? [];

    for (const m of rm) {
      const sec = sectionById.get(m.sectionId) as
        | { name: string; site_scene_key: string | null }
        | undefined;
      const scene = sec?.site_scene_key ? sceneByKey.get(sec.site_scene_key) : undefined;
      const kind = scene?.kind ?? "(not a site scene)";
      const label = scene?.label ?? sec?.name ?? m.sectionId;

      // Does the copy we keep live in the SAME section? If not, removing this
      // row takes a photo OUT of this scene rather than de-duplicating it.
      const keeperHere = kp.some((k) => k.sectionId === m.sectionId);
      if (!keeperHere) {
        rows.push({
          verdict: "CHANGES PAGE",
          scene: label,
          kind,
          detail: `keeper is NOT in this section — removal drops this photo from the scene`,
        });
        continue;
      }

      if (kind === "ordered") {
        const used = scene?.positions ?? 0;
        const size = sectionSize.get(m.sectionId) ?? 0;
        const inUsedRange = m.sortOrder < used;
        rows.push({
          verdict: inUsedRange ? "CHANGES PAGE" : "SAFE",
          scene: label,
          kind,
          detail: `sort_order ${m.sortOrder}, page uses ${used} of ${size}${
            inUsedRange ? " — inside the used range, later images shift up" : " — beyond the used range"
          }`,
        });
      } else if (kind === "slot") {
        const lead = (scene as { lead?: number } | undefined)?.lead ?? 1;
        rows.push({
          verdict: m.sortOrder < lead ? "REVIEW" : "SAFE",
          scene: label,
          kind: `slot(lead ${lead})`,
          detail: `sort_order ${m.sortOrder}${m.sortOrder < lead ? " — inside the rotating lead" : " — outside the lead"}`,
        });
      } else {
        rows.push({
          verdict: "SAFE",
          scene: label,
          kind,
          detail: `pool member (sampled); duplicate only doubled its odds`,
        });
      }
    }
  }

  const byVerdict = new Map<Verdict, number>();
  for (const r of rows) byVerdict.set(r.verdict, (byVerdict.get(r.verdict) ?? 0) + 1);

  const bySceneVerdict = new Map<string, { v: Verdict; kind: string; n: number; detail: string }>();
  for (const r of rows) {
    const k = `${r.verdict}|${r.scene}`;
    const cur = bySceneVerdict.get(k);
    bySceneVerdict.set(k, { v: r.verdict, kind: r.kind, n: (cur?.n ?? 0) + 1, detail: r.detail });
  }
  for (const [k, v] of [...bySceneVerdict.entries()].sort()) {
    console.log(`${v.v.padEnd(13)} ${k.split("|")[1].slice(0, 38).padEnd(38)} ${v.kind.padEnd(16)} ×${v.n}  ${v.detail}`);
  }
  console.log("\n" + [...byVerdict.entries()].map(([v, n]) => `${v}: ${n}`).join("   "));
  console.log(`${tdp.deletions.length} planned removals in TDP Website.`);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
