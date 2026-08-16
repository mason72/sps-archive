/**
 * Scratch: archive-wide, how much would face-based membership add to /people?
 *
 * Today a person's card is "photos whose FILENAME carries this name". The ask
 * is "photos this person is IN", which includes group shots — frames that
 * carry at most one person's name (often nobody's).
 *
 * Reports, over every named face cluster:
 *   - images with 2+ detected faces (group shots) and how many are named
 *   - person↔image pairs known to face clustering but NOT to filenames
 *   - the same, restricted to group shots — the actual prize
 *
 *   npx tsx scripts/triage/group-shot-gain.ts
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { personKeyForImage, normalizeNameKey, NON_PERSON_GALLERIES } = await import(
    "../../src/lib/people/index-people"
  );
  const supabase = createServiceClient();

  const { data: ev } = await supabase
    .from("events")
    .select("user_id")
    .ilike("name", "%Appfolio Headshots%Goleta%")
    .limit(1)
    .maybeSingle();
  if (!ev) throw new Error("owner event not found");

  const { data: events } = await supabase
    .from("events")
    .select("id, name")
    .eq("user_id", ev.user_id);
  const scoped = (events ?? []).filter((e) => !NON_PERSON_GALLERIES.has(e.name));
  const eventIds = scoped.map((e) => e.id);
  const evName = new Map(scoped.map((e) => [e.id, e.name]));

  const page = async <T>(
    build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
  ): Promise<T[]> => {
    const out: T[] = [];
    for (let p = 0; ; p++) {
      const { data, error } = await build(p * 1000, p * 1000 + 999);
      if (error) throw error;
      out.push(...((data ?? []) as T[]));
      if (!data || data.length < 1000) break;
    }
    return out;
  };

  // 1. Named clusters, keyed by identity.
  type P = { id: string; name: string | null; event_id: string };
  const persons = await page<P>((f, t) =>
    supabase
      .from("persons")
      .select("id, name, event_id")
      .in("event_id", eventIds)
      .not("name", "is", null)
      .order("id")
      .range(f, t)
  );
  const personKey = new Map<string, string>();
  for (const p of persons) {
    const k = normalizeNameKey(p.name ?? "");
    if (k) personKey.set(p.id, k);
  }
  console.log(`named clusters: ${persons.length}, distinct identities: ${new Set(personKey.values()).size}`);

  // 2. Filename membership for the whole archive: imageId → identity key.
  type Img = { id: string; event_id: string; parsed_name: string | null; original_filename: string };
  const images = await page<Img>((f, t) =>
    supabase
      .from("images")
      .select("id, event_id, parsed_name, original_filename")
      .in("event_id", eventIds)
      .eq("media_type", "image")
      .eq("processing_status", "complete")
      .order("id")
      .range(f, t)
  );
  const filenameKeyOfImage = new Map<string, string>();
  for (const i of images) {
    const k = personKeyForImage(i.parsed_name, i.original_filename);
    if (k) filenameKeyOfImage.set(i.id, k);
  }
  console.log(`images in scope: ${images.length}, with a name in the filename: ${filenameKeyOfImage.size}`);

  // 3. Every face: image_id + person_id.
  type F = { image_id: string; person_id: string | null };
  const faces = await page<F>((f, t) =>
    supabase.from("faces").select("image_id, person_id").order("id").range(f, t)
  );
  const facesPerImage = new Map<string, number>();
  for (const f of faces) facesPerImage.set(f.image_id, (facesPerImage.get(f.image_id) ?? 0) + 1);

  const inScope = new Set(images.map((i) => i.id));
  const groupShots = [...facesPerImage.entries()].filter(
    ([id, n]) => n >= 2 && inScope.has(id)
  );
  console.log(`\nimages with 2+ detected faces (group shots): ${groupShots.length}`);
  const groupNamed = groupShots.filter(([id]) => filenameKeyOfImage.has(id)).length;
  console.log(`  …of which carry SOME person name in the filename: ${groupNamed}`);
  console.log(`  …carrying no person name at all: ${groupShots.length - groupNamed}`);

  // 4. person↔image pairs from faces, vs what filenames already give.
  const pairs = new Set<string>();
  for (const f of faces) {
    if (!f.person_id || !inScope.has(f.image_id)) continue;
    const k = personKey.get(f.person_id);
    if (k) pairs.add(`${k}|${f.image_id}`);
  }
  let already = 0;
  let novel = 0;
  let novelGroup = 0;
  const novelByEvent = new Map<string, number>();
  const eventOfImage = new Map(images.map((i) => [i.id, i.event_id]));
  for (const pair of pairs) {
    const [k, imageId] = pair.split("|");
    if (filenameKeyOfImage.get(imageId) === k) {
      already++;
      continue;
    }
    novel++;
    if ((facesPerImage.get(imageId) ?? 0) >= 2) {
      novelGroup++;
      const e = evName.get(eventOfImage.get(imageId) ?? "") ?? "?";
      novelByEvent.set(e, (novelByEvent.get(e) ?? 0) + 1);
    }
  }
  console.log(`\nperson↔image pairs known to face clustering: ${pairs.size}`);
  console.log(`  already covered by the filename: ${already}`);
  console.log(`  NEW to the card: ${novel}  (of which group shots: ${novelGroup})`);

  console.log(`\ntop events by NEW group-shot appearances:`);
  for (const [e, n] of [...novelByEvent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${n}\t${e}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
