/**
 * Read-only check of the two-part gallery payload on real events
 * (src/lib/gallery/first-screen.ts). For each event it replays the payload's
 * reads, picks the first part, and asserts what the guest sees first cannot
 * change when the rest lands: the landing section is whole, and the cover
 * draws the same pool from the first part as from everything. Prints the
 * first part's size against the whole gallery. Exits 1 on any mismatch.
 *   npx tsx scripts/triage/first-screen-parity.ts <eventId> [...]
 *   npx tsx scripts/triage/first-screen-parity.ts --largest 40
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
// Loaded in main(), after .env.local: a static import is hoisted above the
// loop above, and the R2 client reads its bucket name when its module loads.
const load = async () => ({
  ...(await import("@/lib/supabase/server")),
  ...(await import("@/lib/sections/gallery-members")),
  ...(await import("@/lib/supabase/paged")),
  ...(await import("@/types/event-settings")),
  ...(await import("@/lib/cover/payload")),
  ...(await import("@/lib/cover/mosaic")),
  ...(await import("@/lib/gallery/image-rows")),
  ...(await import("@/lib/gallery/first-screen")),
});
let M: Awaited<ReturnType<typeof load>>;
let sb: ReturnType<typeof M.createServiceClient>;

async function one(eventId: string): Promise<boolean> {
  const { data: ev } = await sb.from("events").select("name, settings").eq("id", eventId).single();
  const settings = (ev?.settings ?? {}) as Record<string, unknown>;
  const gridSort = ((settings.grid ?? {}) as Record<string, unknown>).sortBy as string | undefined;
  const cover = M.normalizeCoverSettings(settings.cover);

  // The payload's photos: the route's reads and the route's two exclusions.
  let rows = await M.readGalleryImageRows(sb, { eventId, gridSort });
  const coverImageId = cover.enabled && cover.type === "image" ? cover.imageId : undefined;
  rows = rows.filter((r) => r.id !== coverImageId && !r.is_cover_upload);
  const images = rows.map((r) => ({
    id: r.id as string,
    parsedName: r.parsed_name as string | null,
    originalFilename: r.original_filename as string,
    mediaType: (r.media_type ?? "image") as string,
  }));

  const { data: secRows, error } = await sb
    .from("sections")
    .select("id")
    .eq("event_id", eventId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  const links = await M.loadSectionLinks(sb, (secRows ?? []).map((s) => s.id));
  const present = new Set(images.map((i) => i.id));
  const byId = new Map<string, string[]>();
  for (const l of links) {
    if (!present.has(l.image_id)) continue;
    byId.set(l.section_id, [...(byId.get(l.section_id) ?? []), l.image_id]);
  }
  const sections = (secRows ?? [])
    .map((s) => ({ id: s.id as string, imageIds: byId.get(s.id) ?? [] }))
    .filter((s) => s.imageIds.length > 0);

  const gallerySettings = await M.coverGalleryFields(cover, eventId);
  const payload = {
    images,
    sections: sections.length ? sections : undefined,
    settings: gallerySettings,
  };
  const ids = M.firstScreenImageIds(payload);
  const name = String(ev?.name ?? eventId).slice(0, 36).padEnd(36);
  if (!ids) {
    console.log(`  ${name} ${String(images.length).padStart(6)} photos  one part`);
    return true;
  }
  const head = images.filter((i) => ids.has(i.id));
  const landingWhole = sections[0].imageIds.every((id) => ids.has(id));
  const pool = (imgs: typeof images) =>
    (M.galleryCoverPool({ settings: gallerySettings, images: imgs, sections })?.pool ?? [])
      .map((i) => i.id)
      .join(",");
  const coverSame = !gallerySettings.coverEnabled || pool(head) === pool(images);
  const ok = landingWhole && coverSame;
  console.log(
    `${ok ? "  " : "✗ "}${name} ${String(images.length).padStart(6)} photos  first part ${String(head.length).padStart(5)} (${Math.round((100 * head.length) / images.length)}%)  cover ${gallerySettings.coverEnabled ? gallerySettings.coverType : "off"}${landingWhole ? "" : "  LANDING CUT"}${coverSame ? "" : "  COVER DIFFERS"}`
  );
  return ok;
}

async function largest(n: number): Promise<string[]> {
  const events = await M.readAllRows<{ id: string }>(() => sb.from("events").select("id"));
  const counts: { id: string; n: number }[] = [];
  for (let i = 0; i < events.length; i += 8) {
    const batch = events.slice(i, i + 8);
    const res = await Promise.all(
      batch.map((e) =>
        sb
          .from("images")
          .select("id", { count: "exact", head: true })
          .eq("event_id", e.id)
          .eq("thumbnail_generated", true)
      )
    );
    res.forEach((r, k) => {
      if (r.error) throw r.error;
      counts.push({ id: batch[k].id, n: r.count ?? 0 });
    });
  }
  return counts.sort((a, b) => b.n - a.n).slice(0, n).map((c) => c.id);
}

async function main() {
  M = await load();
  sb = M.createServiceClient();
  const args = process.argv.slice(2);
  const ids = args[0] === "--largest" ? await largest(Number(args[1] ?? 40)) : args;
  if (!ids.length) {
    console.error("usage: first-screen-parity.ts <eventId> [...] | --largest N");
    process.exit(2);
  }
  let bad = 0;
  for (const id of ids) if (!(await one(id))) bad++;
  console.log(bad ? `\n${bad} of ${ids.length} events would redraw when the rest lands` : `\nall ${ids.length} events hold`);
  process.exit(bad ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
