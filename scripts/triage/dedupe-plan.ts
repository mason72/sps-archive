/**
 * Plan (and only plan) a dedupe of the existing archive.
 *
 * Identity is (event_id, original_filename, file_size) — EXACTLY what the ingest
 * guard in src/app/api/upload/route.ts compares, so this proposes removing only
 * what today's uploader would already have refused. A same-name/DIFFERENT-size
 * row is a genuine re-edit and is never a candidate.
 *
 * Choosing which copy to KEEP is the whole risk, and "newest" is the wrong rule.
 * Rows are referenced by id from four places, and deleting a referenced copy
 * punches a silent hole in something a client is looking at:
 *
 *   - section_images  — membership. Delete this copy and the tile leaves the
 *                       gallery, because a section is a link table.
 *   - shares.image_ids — a SELECTION share names specific image ids. Delete one
 *                       and that client's delivered gallery quietly shrinks.
 *   - favorites        — a guest picked THAT row.
 *   - events.settings  — the cover points at an image id.
 *
 * So the keeper is the most-referenced copy, ties broken by oldest (the one
 * links were most likely made against), and any candidate that still carries a
 * reference is reported as BLOCKED rather than planned for deletion. Nothing
 * here deletes; the output is a manifest to read and approve.
 *
 *   npx tsx scripts/triage/dedupe-plan.ts            # every gallery
 *   npx tsx scripts/triage/dedupe-plan.ts <eventId>  # one gallery
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const OUT = "tasks/dedupe-manifest.json";

type Row = {
  id: string;
  original_filename: string;
  file_size: number | null;
  created_at: string;
};

async function main() {
  const onlyEvent = process.argv[2];
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const eventQuery = s.from("events").select("id, name, settings");
  const { data: events, error: evErr } = onlyEvent
    ? await eventQuery.eq("id", onlyEvent)
    : await eventQuery.limit(200);
  if (evErr) throw evErr;

  // Every image id named by a share's selection, across the whole archive.
  const { data: shares, error: shErr } = await s
    .from("shares")
    .select("id, slug, event_id, share_type, image_ids, is_active");
  if (shErr) throw shErr;
  const sharedIds = new Map<string, string[]>(); // imageId -> share slugs
  for (const sh of (shares ?? []) as Array<{
    slug: string;
    image_ids: string[] | null;
    is_active: boolean;
  }>) {
    for (const id of sh.image_ids ?? []) {
      const list = sharedIds.get(id) ?? [];
      list.push(`${sh.slug}${sh.is_active ? "" : " (inactive)"}`);
      sharedIds.set(id, list);
    }
  }

  const manifest: Array<Record<string, unknown>> = [];
  let totalDelete = 0;
  let totalBlocked = 0;
  let totalGroups = 0;

  for (const ev of (events ?? []) as Array<{
    id: string;
    name: string;
    settings: Record<string, unknown> | null;
  }>) {
    const rows: Row[] = [];
    for (let off = 0; ; off += 1000) {
      const { data } = await s
        .from("images")
        .select("id, original_filename, file_size, created_at")
        .eq("event_id", ev.id)
        .order("id", { ascending: true })
        .range(off, off + 999);
      rows.push(...((data ?? []) as Row[]));
      if (!data || data.length < 1000) break;
    }
    if (rows.length === 0) continue;

    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      if (r.file_size == null) continue; // no size = no identity, never a candidate
      const key = `${r.original_filename}|${r.file_size}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    const dupeGroups = [...groups.entries()].filter(([, rs]) => rs.length > 1);
    if (dupeGroups.length === 0) continue;

    // Reference counts for every row involved, batched.
    const involved = dupeGroups.flatMap(([, rs]) => rs.map((r) => r.id));
    const sectionCount = new Map<string, number>();
    const favCount = new Map<string, number>();
    for (let i = 0; i < involved.length; i += 200) {
      const slice = involved.slice(i, i + 200);
      const [{ data: si }, { data: fav }] = await Promise.all([
        s.from("section_images").select("image_id").in("image_id", slice),
        s.from("favorites").select("image_id").in("image_id", slice),
      ]);
      for (const r of (si ?? []) as Array<{ image_id: string }>)
        sectionCount.set(r.image_id, (sectionCount.get(r.image_id) ?? 0) + 1);
      for (const r of (fav ?? []) as Array<{ image_id: string }>)
        favCount.set(r.image_id, (favCount.get(r.image_id) ?? 0) + 1);
    }

    const coverId = ((ev.settings?.cover as Record<string, unknown> | undefined)
      ?.imageId ?? null) as string | null;

    const refsFor = (id: string) => ({
      sections: sectionCount.get(id) ?? 0,
      favorites: favCount.get(id) ?? 0,
      shares: sharedIds.get(id) ?? [],
      isCover: id === coverId,
    });
    const weight = (id: string) => {
      const r = refsFor(id);
      return r.sections + r.favorites + r.shares.length + (r.isCover ? 100 : 0);
    };

    const del: Array<Record<string, unknown>> = [];
    const blocked: Array<Record<string, unknown>> = [];

    for (const [key, rs] of dupeGroups) {
      totalGroups++;
      // Keeper: most-referenced, ties to the OLDEST (links were made against it).
      const sorted = [...rs].sort((a, b) => {
        const d = weight(b.id) - weight(a.id);
        return d !== 0 ? d : a.created_at.localeCompare(b.created_at);
      });
      const keeper = sorted[0];
      for (const victim of sorted.slice(1)) {
        const r = refsFor(victim.id);
        const entry = {
          key,
          keep: keeper.id,
          remove: victim.id,
          removeCreated: victim.created_at,
          refs: r,
        };
        // Section membership is EXPECTED, not a blocker: a duplicate that shows
        // as a tile is a section member by definition, so blocking on it blocks
        // every candidate (the first run of this script returned 669 blocked and
        // 0 removable, which is how that got caught). Removing the row means
        // removing its links too — that IS the fix, one fewer tile.
        //
        // The dangerous references are the ones that name this row SPECIFICALLY
        // and would silently lose content if it vanished: a selection share's
        // image_ids, a guest's favorite, or the event cover.
        if (r.favorites > 0 || r.shares.length > 0 || r.isCover) {
          blocked.push(entry);
        } else {
          del.push(entry);
        }
      }
    }

    totalDelete += del.length;
    totalBlocked += blocked.length;
    manifest.push({
      eventId: ev.id,
      name: ev.name,
      rows: rows.length,
      duplicateGroups: dupeGroups.length,
      plannedDeletions: del.length,
      blocked: blocked.length,
      deletions: del,
      blockedRows: blocked,
    });

    console.log(
      `${ev.name.slice(0, 34).padEnd(34)} ${String(rows.length).padStart(5)} rows  ` +
        `${String(del.length).padStart(4)} to remove  ${String(blocked.length).padStart(4)} BLOCKED (still referenced)`
    );
  }

  fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2));
  console.log(
    `\n${totalGroups} duplicate group(s): ${totalDelete} safe to remove, ${totalBlocked} blocked by a live reference.`
  );
  console.log(`Manifest written to ${OUT}. NOTHING WAS DELETED.`);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
