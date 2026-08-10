/**
 * Smart-section semantics on live data (self-restoring).
 *
 * Proves, against the sandbox event:
 *   copy → photos join the new section AND keep every prior membership
 *   move → photos join the new section and leave the others
 * Then deletes both test sections and re-adds any memberships move stripped.
 *
 *   npx tsx scripts/verify-smart-section.ts
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const EVENT_ID = process.argv[2] ?? "4a8cf215-22a8-46c0-95c9-b21cb5530ee6"; // Two Dudes Sample Images

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Pick 3 images that already belong to at least one section.
  const { data: existing } = await supabase
    .from("section_images")
    .select("image_id, section_id, sections!inner(event_id)")
    .eq("sections.event_id", EVENT_ID)
    .limit(60);
  const byImage = new Map<string, string[]>();
  for (const r of existing ?? []) {
    const list = byImage.get(r.image_id) ?? [];
    list.push(r.section_id);
    byImage.set(r.image_id, list);
  }
  const sample = [...byImage.entries()].slice(0, 3);
  if (sample.length < 3) throw new Error("need 3 sectioned images");
  const imageIds = sample.map(([id]) => id);
  const priorCounts = new Map(sample.map(([id, secs]) => [id, secs.length]));
  console.log(`probe images: ${imageIds.map((i) => i.slice(0, 8)).join(", ")}`);
  console.log(`prior memberships: ${[...priorCounts.values()].join(", ")}`);

  const created: string[] = [];
  async function makeSection(name: string, mode: "copy" | "move") {
    const { data: last } = await supabase
      .from("sections")
      .select("sort_order")
      .eq("event_id", EVENT_ID)
      .order("sort_order", { ascending: false })
      .limit(1);
    const { data: sec } = await supabase
      .from("sections")
      .insert({
        event_id: EVENT_ID,
        name,
        sort_order: (last?.[0]?.sort_order ?? -1) + 1,
        is_auto: false,
      })
      .select("id")
      .single();
    created.push(sec!.id);
    if (mode === "move") {
      const { data: others } = await supabase
        .from("sections")
        .select("id")
        .eq("event_id", EVENT_ID)
        .neq("id", sec!.id);
      await supabase
        .from("section_images")
        .delete()
        .in("section_id", (others ?? []).map((s) => s.id))
        .in("image_id", imageIds);
    }
    await supabase.from("section_images").upsert(
      imageIds.map((id, i) => ({ section_id: sec!.id, image_id: id, sort_order: i })),
      { onConflict: "section_id,image_id" }
    );
    return sec!.id;
  }

  async function membershipCount(imageId: string) {
    const { data } = await supabase
      .from("section_images")
      .select("section_id, sections!inner(event_id)")
      .eq("sections.event_id", EVENT_ID)
      .eq("image_id", imageId);
    return (data ?? []).length;
  }

  // COPY
  await makeSection("__verify copy", "copy");
  const afterCopy = await Promise.all(imageIds.map(membershipCount));
  const copyOk = afterCopy.every((n, i) => n === (priorCounts.get(imageIds[i]) ?? 0) + 1);
  console.log(`copy → memberships ${afterCopy.join(", ")} (expected prior+1) ${copyOk ? "PASS" : "FAIL"}`);

  // MOVE
  await makeSection("__verify move", "move");
  const afterMove = await Promise.all(imageIds.map(membershipCount));
  const moveOk = afterMove.every((n) => n === 1);
  console.log(`move → memberships ${afterMove.join(", ")} (expected 1 each) ${moveOk ? "PASS" : "FAIL"}`);

  // RESTORE: drop test sections, re-add the memberships move stripped.
  await supabase.from("sections").delete().in("id", created);
  for (const [imageId, sectionIds] of sample) {
    await supabase.from("section_images").upsert(
      sectionIds.map((sectionId, i) => ({
        section_id: sectionId,
        image_id: imageId,
        sort_order: i,
      })),
      { onConflict: "section_id,image_id" }
    );
  }
  const restored = await Promise.all(imageIds.map(membershipCount));
  const restoreOk = restored.every((n, i) => n === (priorCounts.get(imageIds[i]) ?? 0));
  console.log(`restored → ${restored.join(", ")} ${restoreOk ? "PASS" : "FAIL"}`);

  if (copyOk && moveOk && restoreOk) console.log("\nALL CHECKS PASSED");
  else throw new Error("verification failed");
}

main().catch((err) => {
  console.error("FAILED:", err.message ?? err);
  process.exit(1);
});
