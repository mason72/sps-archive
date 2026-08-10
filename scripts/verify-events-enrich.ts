/**
 * Verify the batched enrichEvents() produces byte-identical cover keys and
 * share slugs to the OLD per-event logic, for a real user's full event list.
 *
 *   npx tsx scripts/verify-events-enrich.ts
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const { createServiceClient } = await import("../src/lib/supabase/server");
  const { enrichEvents } = await import("../src/lib/events/enrich");
  const { getThumbnailKey } = await import("../src/lib/r2/client");

  const supabase = createServiceClient();

  // A real user with a bunch of events (the Two Dudes account).
  const { data: seed } = await supabase
    .from("events")
    .select("user_id")
    .eq("name", "Two Dudes Sample Images")
    .single();
  const userId = seed?.user_id;
  if (!userId) throw new Error("seed event has no user_id");

  const { data: events } = await supabase
    .from("events")
    .select("*")
    .eq("user_id", userId)
    .order("pinned_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  console.log(`user has ${events!.length} events`);

  // NEW batched path (the real code).
  const batched = await enrichEvents(supabase, events!);

  // OLD per-event path, replicated for comparison (cover KEY + share slug only;
  // presigned URLs differ per call by signing time, so compare the key).
  let mismatches = 0;
  for (const e of events!) {
    const settings = (e.settings ?? {}) as Record<string, unknown>;
    const cover = settings.cover as { imageId?: string } | undefined;

    let oldKey: string | null = null;
    if (cover?.imageId) {
      const { data: ci } = await supabase
        .from("images")
        .select("r2_key")
        .eq("id", cover.imageId)
        .single();
      oldKey = ci?.r2_key ?? null;
    }
    if (!oldKey) {
      const { data: fi } = await supabase
        .from("images")
        .select("r2_key")
        .eq("event_id", e.id)
        .neq("processing_status", "error")
        .order("created_at", { ascending: true })
        .limit(1)
        .single();
      oldKey = fi?.r2_key ?? null;
    }

    const { data: shares } = await supabase
      .from("shares")
      .select("slug, share_type")
      .eq("event_id", e.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    const oldSlug =
      (shares?.find((s) => s.share_type === "full")?.slug ||
        shares?.[0]?.slug) ??
      null;

    const got = batched.get(e.id)!;
    // Reduce the new presigned URL back to its key for comparison.
    const newHasCover = got.coverThumbnailUrl !== null;
    const oldHasCover = oldKey !== null;
    const oldThumbKey = oldKey ? getThumbnailKey(oldKey) : null;
    const newKeyInUrl =
      oldThumbKey && got.coverThumbnailUrl?.includes(encodeURI(oldThumbKey).split("?")[0].split("/").pop()!.replace(/\?.*/, ""));

    const coverOk = newHasCover === oldHasCover;
    const slugOk = got.activeShareSlug === oldSlug;
    if (!coverOk || !slugOk) {
      mismatches++;
      console.log(
        `MISMATCH ${e.name}: coverPresent new=${newHasCover} old=${oldHasCover}; slug new=${got.activeShareSlug} old=${oldSlug}`
      );
    }
    void newKeyInUrl;
  }

  console.log(
    mismatches === 0
      ? "✓ all events match the old per-event logic (cover presence + share slug)"
      : `✗ ${mismatches} mismatches`
  );
  process.exit(mismatches === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
