/**
 * Person spotlight E2E on live data (read-only).
 *
 * Proves the promise the UI makes: the photo count on a /people tile is the
 * count the spotlight loads, AND the count an event chip's `?person=` deep
 * link resolves to inside that event. Three surfaces, one identity helper —
 * this script is what catches them drifting apart.
 *
 *   npx tsx scripts/verify-person-spotlight.ts ["Jeff Roark"]
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const NAMES = process.argv.slice(2);

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { buildPeopleIndex, buildPersonDetail, personKeyForImage } = await import(
    "../src/lib/people/index-people"
  );
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ) as never;

  // Scope to whoever owns the most events — the archive lives on the TEAM
  // account, not necessarily the admin one.
  const { data: owned } = await (supabase as never as ReturnType<typeof createClient>)
    .from("events")
    .select("user_id");
  const tally = new Map<string, number>();
  for (const row of (owned ?? []) as { user_id: string | null }[]) {
    if (row.user_id) tally.set(row.user_id, (tally.get(row.user_id) ?? 0) + 1);
  }
  const userId = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!userId) throw new Error("No event owner to scope to");

  const t0 = Date.now();
  const index = await buildPeopleIndex(supabase, userId);
  console.log(`index: ${index.length} people in ${Date.now() - t0}ms`);

  // Default subjects: the busiest person, the only repeat person, and the one
  // Mason clicked. Between them they cover a clustered event and an
  // unclustered one.
  const picks = NAMES.length
    ? NAMES
    : [
        [...index].sort((a, b) => b.imageCount - a.imageCount)[0]?.name,
        index.find((p) => p.eventCount >= 2)?.name,
        "Jeff Roark",
      ].filter((n): n is string => Boolean(n));

  let failures = 0;
  for (const name of [...new Set(picks)]) {
    const tile = index.find((p) => p.name === name);
    const t1 = Date.now();
    const detail = await buildPersonDetail(supabase, userId, name);
    const ms = Date.now() - t1;

    if (!detail) {
      console.log(`✗ ${name}: no detail`);
      failures += 1;
      continue;
    }

    const tileCount = tile?.imageCount ?? null;
    const countsAgree = tileCount === null || tileCount === detail.imageCount;
    console.log(
      `${countsAgree ? "✓" : "✗"} ${name}: tile ${tileCount ?? "—"} / spotlight ${detail.imageCount} ` +
        `across ${detail.events.length} event(s) in ${ms}ms`
    );
    if (!countsAgree) failures += 1;

    // The deep link: re-resolve membership the way the event page does — over
    // that event's own images, by filename — and demand the same number.
    for (const ev of detail.events) {
      const rows: { parsed_name: string | null; original_filename: string }[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await (
          supabase as never as ReturnType<typeof createClient>
        )
          .from("images")
          .select("parsed_name, original_filename")
          .eq("event_id", ev.eventId)
          .eq("media_type", "image")
          .range(offset, offset + 999);
        if (error) throw error;
        if (!data?.length) break;
        rows.push(...(data as typeof rows));
        if (data.length < 1000) break;
      }
      const key = personKeyForImage(null, `${name}_x.jpg`);
      const inEvent = rows.filter(
        (r) => personKeyForImage(r.parsed_name, r.original_filename) === key
      ).length;
      const ok = inEvent === ev.images.length;
      if (!ok) failures += 1;
      console.log(
        `   ${ok ? "✓" : "✗"} ${ev.eventName}: chip ${ev.images.length} / ?person= resolves ${inEvent}`
      );
    }
  }

  console.log(failures === 0 ? "\nALL AGREE" : `\n${failures} MISMATCH(ES)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
