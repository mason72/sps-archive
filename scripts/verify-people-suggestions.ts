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

const EVENT_ID = "b1156bf2-2d17-41b5-b962-08b70f591f4a";

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
    for (let page = 0; ; page++) {
      const { data: rows } = await supabase
        .from("faces")
        .select("image_id, person_id, images!inner(event_id, parsed_name, original_filename)")
        .eq("images.event_id", EVENT_ID)
        .not("person_id", "is", null)
        .order("id")
        .range(page * 1000, page * 1000 + 999);
      for (const r of rows ?? []) {
        const set = memberImages.get(r.person_id!) ?? new Set();
        set.add(r.image_id);
        memberImages.set(r.person_id!, set);
        const img = r.images as unknown as { parsed_name: string | null; original_filename: string };
        imageMeta.set(r.image_id, { parsedName: img.parsed_name, originalFilename: img.original_filename });
      }
      if (!rows || rows.length < 1000) break;
    }
    const suggestions = computeSuggestions(
      (persons ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        imageIds: [...(memberImages.get(p.id) ?? [])],
        faceCount: p.face_count,
      })),
      imageMeta,
      extractPersonName,
      isPersonLike,
      new Set()
    );
    return { suggestions, imageMeta };
  }

  // 1. The real mislabel must surface.
  const before = await snapshot();
  console.log(
    `before: ${before.suggestions.mislabels.length} mislabel(s), ${before.suggestions.merges.length} merge(s)`
  );
  const target = before.suggestions.mislabels.find((s) => /katie/i.test(s.filedAs));
  if (!target) throw new Error("expected the Katie/Jenna mislabel to surface");
  console.log(`  found: "${target.filedAs}" → ${target.personName} (image ${target.imageId.slice(0, 8)})`);

  // 2. Apply fix-label semantics.
  const { data: prev } = await supabase
    .from("images")
    .select("parsed_name, original_filename")
    .eq("id", target.imageId)
    .single();
  await supabase.from("images").update({ parsed_name: target.personName }).eq("id", target.imageId);

  // 3. Card gone + stacks now group the image with the person.
  const after = await snapshot();
  const stillThere = after.suggestions.mislabels.some((s) => s.key === target.key);
  const stackName = stackPersonName({
    parsedName: target.personName,
    originalFilename: prev!.original_filename,
  } as Parameters<typeof stackPersonName>[0]);
  console.log(
    `after fix: card ${stillThere ? "STILL PRESENT (FAIL)" : "cleared"}; ` +
      `stack name is now "${stackName}"`
  );

  // 4. Restore.
  await supabase.from("images").update({ parsed_name: prev!.parsed_name }).eq("id", target.imageId);
  const restored = await snapshot();
  const back = restored.suggestions.mislabels.some((s) => s.key === target.key);
  console.log(`restored: card ${back ? "back (good)" : "missing (RESTORE FAILED)"}`);

  if (!stillThere && back && stackName.toLowerCase().includes("jenna")) {
    console.log("\nALL CHECKS PASSED");
  } else {
    throw new Error("verification failed");
  }
}

main().catch((err) => {
  console.error("FAILED:", err.message ?? err);
  process.exit(1);
});
