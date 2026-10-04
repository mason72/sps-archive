/**
 * Where would a re-fetched SPS photo land in this gallery? Read-only.
 *
 * The closing sweep and "Retry N photos" file a photo beside its person's
 * other photos when exactly one section holds them, and in "Unsorted"
 * otherwise (src/lib/sps-integration/pull-placement.ts). This answers two
 * questions about a real gallery without importing anything:
 *
 *   1. The census: of the gallery's stacks, how many have one home section,
 *      how many are split across sections, how many sit in a locked one. That
 *      is how often the rule files a photo and how often it falls back.
 *   2. For each filename given: the section the real lookup picks for a photo
 *      of that name, and what the person's OTHER photos say (the named file
 *      left out, so a photo that already landed cannot vouch for itself).
 *
 *   npx tsx scripts/triage/sps-placement-probe.ts <eventId> [filename ...]
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const PAGE = 1000;

async function main() {
  const [eventId, ...filenames] = process.argv.slice(2);
  if (!eventId) {
    console.error("usage: npx tsx scripts/triage/sps-placement-probe.ts <eventId> [filename ...]");
    process.exit(1);
  }

  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { buildStacks } = await import("../../src/lib/gallery/stacks");
  const { chooseHome, findHomes, homesAmong, stackMates } = await import(
    "../../src/lib/sps-integration/pull-placement"
  );
  const supabase = createServiceClient();

  const { data: sectionRows, error: sectionErr } = await supabase
    .from("sections")
    .select("id, name, locked")
    .eq("event_id", eventId)
    .order("sort_order", { ascending: true })
    .limit(PAGE);
  if (sectionErr) throw sectionErr;
  const sections = new Map((sectionRows ?? []).map((s) => [s.id, s]));
  const nameOf = (id: string | null) => (id ? (sections.get(id)?.name ?? id) : "Unsorted (fallback)");

  const rows: { id: string; parsedName: string | null; originalFilename: string }[] = [];
  for (let last: string | null = null; ; ) {
    let q = supabase
      .from("images")
      .select("id, parsed_name, original_filename")
      .eq("event_id", eventId)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (last) q = q.gt("id", last);
    const { data, error } = await q;
    if (error) throw error;
    for (const r of data ?? []) {
      rows.push({ id: r.id, parsedName: r.parsed_name, originalFilename: r.original_filename });
    }
    if ((data ?? []).length < PAGE) break;
    last = data![data!.length - 1].id;
  }

  // Every link into this event's sections, one section at a time.
  const linksByImage = new Map<string, string[]>();
  for (const sectionId of sections.keys()) {
    for (let last: string | null = null; ; ) {
      let q = supabase
        .from("section_images")
        .select("image_id")
        .eq("section_id", sectionId)
        .order("image_id", { ascending: true })
        .limit(PAGE);
      if (last) q = q.gt("image_id", last);
      const { data, error } = await q;
      if (error) throw error;
      for (const l of data ?? []) {
        const list = linksByImage.get(l.image_id);
        if (list) list.push(sectionId);
        else linksByImage.set(l.image_id, [sectionId]);
      }
      if ((data ?? []).length < PAGE) break;
      last = data![data!.length - 1].image_id;
    }
  }

  const stacks = buildStacks(rows);
  const tally = { one: 0, split: 0, locked: 0, none: 0 };
  for (const stack of stacks) {
    const homes = homesAmong(
      stack.images.flatMap((img) => linksByImage.get(img.id) ?? []),
      sections
    );
    if (homes.size === 0) tally.none++;
    else if (homes.size > 1) tally.split++;
    else if (chooseHome(homes, sections)) tally.one++;
    else tally.locked++;
  }

  console.log(`\n${rows.length} photos · ${sections.size} sections · ${stacks.length} stacks`);
  console.log(`  one home (a retried photo is filed there)   ${tally.one}`);
  console.log(`  split across sections (falls to Unsorted)   ${tally.split}`);
  console.log(`  one home, but locked (falls to Unsorted)    ${tally.locked}`);
  console.log(`  no home section (falls to Unsorted)         ${tally.none}`);

  for (const filename of filenames) {
    const incoming = {
      id: `probe:${filename}`,
      originalFilename: filename,
      width: null,
      height: null,
      mimeType: "image/jpeg",
      capturedAt: null,
      boothId: null,
      quality: "archive" as const,
      alreadyPulled: false,
      url: "",
    };
    const picked = (await findHomes(supabase, eventId, [incoming])).get(incoming.id) ?? null;

    // As if the file had not landed: the same grouping the sweep runs, over
    // every row but this one.
    const self = new Set(rows.filter((r) => r.originalFilename === filename).map((r) => r.id));
    const others =
      stackMates(
        rows.filter((r) => !self.has(r.id)),
        [incoming]
      ).get(incoming.id) ?? [];
    const otherHomes = homesAmong(
      others.flatMap((id) => linksByImage.get(id) ?? []),
      sections
    );
    const now = [...self].flatMap((id) => linksByImage.get(id) ?? []).map(nameOf);

    console.log(`\n${filename}`);
    console.log(`  the lookup picks:        ${nameOf(picked)}`);
    console.log(
      `  the person's other ${others.length} photo(s) are in: ${[...otherHomes].map(nameOf).join(", ") || "(none)"}`
    );
    console.log(`  this file sits in:       ${now.join(", ") || "(not in the gallery)"}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
