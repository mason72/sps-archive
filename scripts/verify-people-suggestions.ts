/**
 * People-suggestions E2E on live data (self-restoring).
 *
 * On Appfolio Goleta: compute suggestions exactly as the /people route does
 * (expect the real Jenna/Katie mislabel), apply the fix-label semantics
 * (parsed_name := person name), recompute (expect the card gone + the image
 * now stacks with the person), then RESTORE parsed_name.
 *
 *   npx tsx scripts/verify-people-suggestions.ts
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

// Default: Appfolio Goleta (the original Jenna/Katie case — note Mason
// fixed it in prod 2026-08-10, so the destructive roundtrip is conditional).
const EVENT_ID = process.argv[2] ?? "b1156bf2-2d17-41b5-b962-08b70f591f4a";

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { computeSuggestions } = await import("../src/lib/faces/suggestions");
  const { extractPersonName, stackPersonName } = await import("../src/lib/gallery/stacks");
  const { isPersonLike } = await import("../src/lib/sections/auto-plan");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  async function snapshot() {
    const { data: persons } = await supabase
      .from("persons")
      .select("id, name, face_count")
      .eq("event_id", EVENT_ID);
    const memberImages = new Map<string, Set<string>>();
    const imageMeta = new Map<string, { parsedName: string | null; originalFilename: string }>();
    const faceCountByImage = new Map<string, number>();
    for (let page = 0; ; page++) {
      const { data: rows } = await supabase
        .from("faces")
        .select("image_id, person_id, images!inner(event_id, parsed_name, original_filename)")
        .eq("images.event_id", EVENT_ID)
        .order("id")
        .range(page * 1000, page * 1000 + 999);
      for (const r of rows ?? []) {
        faceCountByImage.set(r.image_id, (faceCountByImage.get(r.image_id) ?? 0) + 1);
        const img = r.images as unknown as { parsed_name: string | null; original_filename: string };
        imageMeta.set(r.image_id, { parsedName: img.parsed_name, originalFilename: img.original_filename });
        if (!r.person_id) continue;
        const set = memberImages.get(r.person_id) ?? new Set();
        set.add(r.image_id);
        memberImages.set(r.person_id, set);
      }
      if (!rows || rows.length < 1000) break;
    }
    return computeSuggestions(
      (persons ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        imageIds: [...(memberImages.get(p.id) ?? [])],
        faceCount: p.face_count,
      })),
      imageMeta,
      faceCountByImage,
      extractPersonName,
      isPersonLike,
      new Set()
    );
  }

  // 1. The real mislabel must surface (grouped shape).
  const before = await snapshot();
  console.log(
    `before: ${before.mislabels.length} mislabel(s), ${before.merges.length} merge(s), ${before.refinements.length} refinement(s)`
  );
  for (const s of before.mislabels) {
    console.log(`  mislabel: ${s.imageIds.length}× "${s.filedAs}" → ${s.personName}`);
  }
  for (const s of before.refinements) {
    console.log(`  refine: ${s.currentName} → "${s.fullName}" (${s.supportingCount} files)`);
  }
  const target = before.mislabels[0];
  if (!target) {
    console.log("no mislabels to roundtrip (already resolved?) — snapshot only, OK");
    return;
  }
  console.log(
    `  found: ${target.imageIds.length} photo(s) "${target.filedAs}" → ${target.personName}`
  );

  // 2. Apply fix-label semantics to the whole group.
  const imageId = target.imageIds[0];
  const { data: prev } = await supabase
    .from("images")
    .select("parsed_name, original_filename")
    .eq("id", imageId)
    .single();
  await supabase
    .from("images")
    .update({ parsed_name: target.personName })
    .in("id", target.imageIds);

  // 3. Card gone + stacks now group the image with the person.
  const after = await snapshot();
  const stillThere = after.mislabels.some((s) => s.key === target.key);
  const stackName = stackPersonName({
    parsedName: target.personName,
    originalFilename: prev!.original_filename,
  } as Parameters<typeof stackPersonName>[0]);
  console.log(
    `after fix: card ${stillThere ? "STILL PRESENT (FAIL)" : "cleared"}; ` +
      `stack name is now "${stackName}"`
  );

  // 4. Restore.
  await supabase
    .from("images")
    .update({ parsed_name: prev!.parsed_name })
    .in("id", target.imageIds);
  const restored = await snapshot();
  const back = restored.mislabels.some((s) => s.key === target.key);
  console.log(`restored: card ${back ? "back (good)" : "missing (RESTORE FAILED)"}`);

  const expectedStack = target.personName.split(" ")[0].toLowerCase();
  if (!stillThere && back && stackName.toLowerCase().includes(expectedStack)) {
    console.log("\nALL CHECKS PASSED");
  } else {
    throw new Error("verification failed");
  }
}

main().catch((err) => {
  console.error("FAILED:", err.message ?? err);
  process.exit(1);
});
