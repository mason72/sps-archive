/**
 * Remove duplicate image rows from ONE event, keeping the oldest copy of each
 * original_filename, and delete the duplicates' R2 objects.
 *
 *   npx tsx scripts/triage/px-dedupe-event.ts <eventId>            # DRY RUN
 *   npx tsx scripts/triage/px-dedupe-event.ts <eventId> --apply
 *
 * Written 2026-08-21 for Twitch Masquerade Ball: the Pixieset ingest's
 * idempotency read was an unpaged PostgREST select capped at 1,000 rows, so 42
 * retry passes re-inserted every photo past the first thousand — 4,961 rows for
 * 1,174 real photos, one frame stored 23 times, each with its OWN R2 object.
 *
 * ── What makes this safe to run, in order ───────────────────────────────────
 *
 * **Keeper is the OLDEST row per filename**, by (created_at, id). Oldest, not
 * healthiest: choosing by thumbnail state would make the keeper depend on a
 * flaky upload, and the row every earlier reference was made against is the
 * first one. A keeper with no thumbnail is repaired afterwards by
 * `repair-stranded-images.ts`, which exists for exactly that.
 *
 * **Every FK into images is checked, not assumed.** Six tables reference it
 * (section_images, faces, favorites, activity_log, crew_faces, events.cover).
 * For this event the duplicates carried ONLY section_images links — measured
 * before writing this — but the script re-counts every table at run time and
 * REFUSES if a duplicate is referenced by anything other than section_images,
 * because a face or a favourite on a duplicate is a reference a human made.
 *
 * **Section links are repointed, then deduped, never dropped.** A duplicate's
 * link moves to the keeper; if the keeper already holds that link the move
 * collides on the (section, image) unique key and is dropped instead. This is
 * the same rule as the upload path: one image, several section links.
 *
 * **Rows go before objects.** Delete the row, THEN the R2 footprint
 * (original + all three thumbnails via `deleteImageAssets`). A crash between
 * the two leaves an orphaned object — invisible garbage — rather than a row
 * pointing at nothing, which is a broken tile. Cheaper failure on purpose.
 *
 * **Scoped to ONE event by id.** A survey found 4,895 duplicate rows across 16
 * events and not all of them are this bug: TDP Website's same-name rows are
 * the same photo PUBLISHED to several scenes, and deleting one strips it off a
 * live page. This script will not take a list. Diagnose each event first.
 */
import fs from "node:fs";

for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

type Row = { id: string; original_filename: string | null; r2_key: string | null; created_at: string; media_type: string | null };

async function main() {
  const eventId = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!eventId || !/^[0-9a-f-]{36}$/.test(eventId)) {
    console.error("usage: px-dedupe-event.ts <eventId> [--apply]");
    process.exit(2);
  }

  // Import AFTER env is loaded: the R2 client reads credentials at module scope.
  const { createClient } = await import("@supabase/supabase-js");
  const { deleteImageAssets } = await import("../../src/lib/r2/client");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: ev, error: evErr } = await sb.from("events").select("id,name,cover_image_id").eq("id", eventId).single();
  if (evErr || !ev) throw new Error(`event not found: ${evErr?.message}`);
  console.log(`${ev.name}  (${eventId})`);
  console.log(`MODE: ${apply ? "APPLY — writing to PRODUCTION" : "dry run"}\n`);

  // Page with ORDER BY on a unique column — the bug this cleans up was an
  // unpaged read, and an unordered .range() is its sibling (lesson 88).
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("images").select("id,original_filename,r2_key,created_at,media_type")
      .eq("event_id", eventId).order("id", { ascending: true }).range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...(data as Row[]));
    if (data.length < 1000) break;
  }

  const byName = new Map<string, Row[]>();
  for (const r of rows) {
    const k = (r.original_filename ?? "").toLowerCase();
    if (!k) continue;
    byName.set(k, [...(byName.get(k) ?? []), r]);
  }
  const keepers = new Map<string, Row>();
  const dups: { dup: Row; keeper: Row }[] = [];
  for (const [k, list] of byName) {
    list.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    keepers.set(k, list[0]);
    for (const d of list.slice(1)) dups.push({ dup: d, keeper: list[0] });
  }
  console.log(`rows       ${rows.length}`);
  console.log(`unique     ${byName.size}`);
  console.log(`to delete  ${dups.length}\n`);
  if (!dups.length) { console.log("no duplicates — nothing to do."); return; }

  // ── Refuse if any duplicate is referenced by a human-made record ──────────
  const dupIds = dups.map((d) => d.dup.id);
  const count = async (table: string, col: string) => {
    let n = 0;
    for (let i = 0; i < dupIds.length; i += 500) {   // .in() is URL length — page it
      const r = await sb.from(table).select("*", { count: "exact", head: true }).in(col, dupIds.slice(i, i + 500));
      if (r.error) throw new Error(`${table}: ${r.error.message}`);
      n += r.count ?? 0;
    }
    return n;
  };
  const refs = {
    faces: await count("faces", "image_id"),
    favorites: await count("favorites", "image_id"),
    activity_log: await count("activity_log", "image_id"),
    crew_faces: await count("crew_faces", "image_id"),
    section_images: await count("section_images", "image_id"),
  };
  const coverOnDup = ev.cover_image_id && dupIds.includes(ev.cover_image_id);
  console.log("references held by the duplicates:");
  for (const [t, n] of Object.entries(refs)) console.log(`   ${t.padEnd(15)} ${n}`);
  console.log(`   cover           ${coverOnDup ? "YES — ON A DUPLICATE" : "no"}\n`);
  const blockers = Object.entries(refs).filter(([t, n]) => t !== "section_images" && n > 0);
  if (blockers.length || coverOnDup) {
    console.error("REFUSING: duplicates carry references a human made. Resolve those first.");
    process.exit(1);
  }

  if (!apply) {
    console.log("sample of what would go (dup → keeper):");
    for (const { dup, keeper } of dups.slice(0, 5)) {
      console.log(`   ${dup.original_filename}  ${dup.id.slice(0, 8)} (${dup.created_at.slice(0, 16)})  →  ${keeper.id.slice(0, 8)} (${keeper.created_at.slice(0, 16)})`);
    }
    console.log(`\ndry run — no rows deleted, no objects deleted. Re-run with --apply.`);
    return;
  }

  // ── 1. Repoint section links to the keeper; drop the ones that collide ────
  let moved = 0, collided = 0;
  for (const { dup, keeper } of dups) {
    const { data: links, error } = await sb.from("section_images").select("section_id").eq("image_id", dup.id);
    if (error) throw error;
    for (const l of links ?? []) {
      const upd = await sb.from("section_images").update({ image_id: keeper.id })
        .eq("section_id", l.section_id).eq("image_id", dup.id);
      if (!upd.error) { moved++; continue; }
      // Unique (section, image) collision: keeper already linked here. Drop ours.
      const del = await sb.from("section_images").delete().eq("section_id", l.section_id).eq("image_id", dup.id);
      if (del.error) throw new Error(`could not resolve link for ${dup.id}: ${del.error.message}`);
      collided++;
    }
  }
  console.log(`section links: ${moved} moved to keeper, ${collided} dropped as already present`);

  // ── 2. Rows first, then objects ───────────────────────────────────────────
  let rowsDeleted = 0, objectsDeleted = 0, objectsFailed = 0;
  for (let i = 0; i < dups.length; i += 200) {
    const batch = dups.slice(i, i + 200);
    const del = await sb.from("images").delete().in("id", batch.map((d) => d.dup.id));
    if (del.error) throw new Error(`row delete failed at ${i}: ${del.error.message}`);
    rowsDeleted += batch.length;
    for (const { dup } of batch) {
      if (!dup.r2_key) continue;
      try { await deleteImageAssets(dup.r2_key, dup.media_type); objectsDeleted++; }
      catch { objectsFailed++; }
    }
    process.stdout.write(`\r   ${rowsDeleted}/${dups.length} rows · ${objectsDeleted} objects`);
  }
  console.log(`\n\n${rowsDeleted} rows deleted · ${objectsDeleted} R2 footprints deleted · ${objectsFailed} object deletes failed (orphans, not broken tiles)`);

  // ── 3. Prove it ───────────────────────────────────────────────────────────
  const after = await sb.from("images").select("*", { count: "exact", head: true }).eq("event_id", eventId);
  console.log(`event now holds ${after.count} rows (expected ${byName.size})`);
  if (after.count !== byName.size) { console.error("COUNT MISMATCH — investigate before trusting this."); process.exit(1); }
}

main().catch((e) => { console.error(String(e).slice(0, 500)); process.exit(1); });
