/**
 * Read-only: the shape of an event's same-name versions, for checking a re-ingest
 * of a collection the pre-2026-10-29 Pixieset ingest collapsed (lesson 197).
 *
 *   npx tsx scripts/triage/version-shape.ts <eventId>
 *
 * Run before and after `pixieset-ingest.ts <id> --apply`. After, expect: images
 * up by the dry run's "to ingest", ORPHANS 0, no thumbnail 0, and no section
 * holding one filename twice (each version sits only in its own set).
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const eventId = process.argv[2];
  if (!eventId) throw new Error("usage: version-shape.ts <eventId>");

  type Img = { id: string; original_filename: string | null; thumbnail_generated: boolean | null; processing_status: string | null };
  const imgs: Img[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("images")
      .select("id,original_filename,thumbnail_generated,processing_status")
      .eq("event_id", eventId)
      .eq("is_cover_upload", false)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    imgs.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  const byId = new Map(imgs.map((i) => [i.id, i]));

  const { data: secs, error: secErr } = await sb.from("sections").select("id,name,sort_order").eq("event_id", eventId).order("sort_order");
  if (secErr) throw secErr;
  const links: { section_id: string; image_id: string }[] = [];
  for (const s of secs ?? []) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb
        .from("section_images")
        .select("section_id,image_id")
        .eq("section_id", s.id)
        .order("image_id", { ascending: true })
        .range(from, from + 999);
      if (error) throw error;
      links.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }
  }

  const linked = new Set(links.map((l) => l.image_id));
  const perName = new Map<string, number>();
  for (const i of imgs) perName.set(i.original_filename ?? i.id, (perName.get(i.original_filename ?? i.id) ?? 0) + 1);
  console.log(
    `images ${imgs.length} · names ${perName.size} · names with versions ${[...perName.values()].filter((n) => n > 1).length} · ` +
      `no thumbnail ${imgs.filter((i) => !i.thumbnail_generated).length} · not complete ${imgs.filter((i) => i.processing_status !== "complete").length} · ` +
      `ORPHANS ${imgs.filter((i) => !linked.has(i.id)).length}`,
  );
  for (const s of secs ?? []) {
    const mine = links.filter((l) => l.section_id === s.id && byId.has(l.image_id));
    const names = new Map<string, number>();
    for (const l of mine) {
      const f = byId.get(l.image_id)!.original_filename ?? l.image_id;
      names.set(f, (names.get(f) ?? 0) + 1);
    }
    const twice = [...names.values()].filter((v) => v > 1).length;
    console.log(`  ${s.name}: ${mine.length} photos${twice ? ` · ${twice} NAME(S) TWICE IN THIS SECTION` : ""}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
