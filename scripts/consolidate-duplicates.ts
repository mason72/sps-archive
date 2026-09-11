/**
 * Trim migration copies of shoots that were already delivered (2026-09-11).
 *
 * The Pixieset migration re-imported shoots Mason had already delivered from
 * Pixeltrunk in June/July, so each exists twice: the DELIVERED gallery (client
 * links, views, favorites, crew) and a migration COPY created 2026-08-31 with
 * zero views. Measured: the copies' frames are the same quality (median bytes
 * and width 1.00x), so a copy frame with a twin in the delivered gallery is
 * pure duplication — it doubled /people counts and showed each shoot twice.
 *
 * Mason's call ("Trim the copies"): delivered galleries are never touched.
 * From each copy, remove every frame that has a TWIN in the delivered gallery;
 * keep whatever only the copy has. A twin is the same capture second AND the
 * same byte size, or the same filename AND the same byte size — both require
 * byte-for-byte size equality, and matching is one-to-one.
 *
 *   - copy left empty      → renamed "… · superseded <date> — delete after <date>",
 *                            its links switched OFF (never opened; repointing a
 *                            copy link could expose a delivered gallery under the
 *                            copy's weaker password/PIN settings)
 *   - copy with extras     → renamed "… · not in the delivered gallery", keeps them
 *   - moveExtras pairs     → extras move INTO the kept gallery (DAIS-style: same
 *                            R2 objects, faces dropped, re-indexed there), then the
 *                            copy is empty and retires
 *
 * Order per pair: rows deleted in the database FIRST, then their R2 files — a
 * failure between the two leaves an orphan file (wasted storage), never a row
 * whose file is gone (a broken tile). Face clusters the trim empties are
 * deleted too, so their reference faces stop feeding the naming engine.
 *
 *   npx tsx scripts/consolidate-duplicates.ts            # dry run — writes nothing
 *   npx tsx scripts/consolidate-duplicates.ts --apply
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

interface Pair {
  keep: string;
  copy: string;
  /** Move the copy's extras into the kept gallery instead of leaving them. */
  moveExtras?: boolean;
}

/** keep = the delivered gallery (or, for CEA, the SPS camera-original copy with crew). */
const PAIRS: Pair[] = [
  { keep: "College Board // NASAI 2026", copy: "COLLEGEBOARD // NASAI" },
  { keep: "College Board 2026 All SDP Meeting", copy: "COLLEGE BOARD // 2026 SDP SUMMIT" },
  { keep: "eBay Headshots // Jul 2026", copy: "eBay HEADSHOTS" },
  { keep: "PG&E Headshots // Jul 2026", copy: "PG&E HEADSHOTS" },
  { keep: "Nick Lombardo's Headshots", copy: "NICK LOMBARDO'S HEADSHOTS" },
  { keep: "CEA Show 26", copy: "Construction of Excellence Awards", moveExtras: true },
];

const TODAY = "2026-09-11";
const DELETE_AFTER = "2026-09-18";
const APPLY = process.argv.includes("--apply");

interface Img {
  id: string;
  original_filename: string;
  file_size: number | null;
  taken_at: string | null;
  r2_key: string;
  media_type: string | null;
}

(async () => {
  const { createServiceClient } = await import("../src/lib/supabase/server");
  const { deleteImageAssets, objectExistsInR2 } = await import("../src/lib/r2/client");
  const db = createServiceClient();

  async function loadImages(eventId: string): Promise<Img[]> {
    const out: Img[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db
        .from("images")
        .select("id, original_filename, file_size, taken_at, r2_key, media_type")
        .eq("event_id", eventId)
        .order("id")
        .range(offset, offset + 999);
      if (error) throw error;
      out.push(...((data ?? []) as Img[]));
      if (!data || data.length < 1000) break;
    }
    return out;
  }

  async function eventByName(name: string) {
    const { data, error } = await db.from("events").select("id, name, user_id").eq("name", name);
    if (error) throw error;
    if (!data || data.length !== 1) throw new Error(`expected exactly one event named "${name}", found ${data?.length ?? 0}`);
    return data[0];
  }

  const log: Record<string, unknown>[] = [];
  let snapshotUser: string | null = null;

  for (const pair of PAIRS) {
    const keep = await eventByName(pair.keep);
    const copy = await eventByName(pair.copy);
    if (keep.user_id !== copy.user_id) throw new Error(`${pair.copy}: different owners — refusing`);
    snapshotUser = keep.user_id;

    const [keepImgs, copyImgs] = await Promise.all([loadImages(keep.id), loadImages(copy.id)]);

    // A copy row must own its file under the copy's prefix — the unique index
    // on r2_key already forbids sharing a key with a kept row; this proves the
    // delete can only ever touch the copy's objects.
    const foreign = copyImgs.filter((c) => !c.r2_key.startsWith(`events/${copy.id}/`));
    if (foreign.length) throw new Error(`${pair.copy}: ${foreign.length} rows outside events/${copy.id}/ — refusing`);

    // One-to-one twins: capture second + exact bytes, else filename + exact bytes.
    const byTime = new Map<string, Img[]>();
    const byName = new Map<string, Img[]>();
    for (const k of keepImgs) {
      if (k.file_size == null) continue;
      if (k.taken_at) byTime.set(`${k.taken_at}|${k.file_size}`, [...(byTime.get(`${k.taken_at}|${k.file_size}`) ?? []), k]);
      const nk = `${k.original_filename.toLowerCase()}|${k.file_size}`;
      byName.set(nk, [...(byName.get(nk) ?? []), k]);
    }
    const claimed = new Set<string>();
    const twins: { copy: Img; keep: Img; by: "time+bytes" | "name+bytes" }[] = [];
    const extras: Img[] = [];
    for (const c of copyImgs) {
      if (c.file_size == null) {
        extras.push(c);
        continue;
      }
      const t = c.taken_at ? (byTime.get(`${c.taken_at}|${c.file_size}`) ?? []).find((k) => !claimed.has(k.id)) : undefined;
      const n = t ? undefined : (byName.get(`${c.original_filename.toLowerCase()}|${c.file_size}`) ?? []).find((k) => !claimed.has(k.id));
      const hit = t ?? n;
      if (hit) {
        claimed.add(hit.id);
        twins.push({ copy: c, keep: hit, by: t ? "time+bytes" : "name+bytes" });
      } else extras.push(c);
    }

    const { data: shares, error: shErr } = await db
      .from("shares")
      .select("id, slug, is_active, view_count, password_hash")
      .eq("event_id", copy.id);
    if (shErr) throw shErr;
    const { count: emails, error: emErr } = await db
      .from("email_sends")
      .select("id", { count: "exact", head: true })
      .eq("event_id", copy.id);
    if (emErr) throw emErr;

    const empties = pair.moveExtras || extras.length === 0;
    const newName = empties
      ? `${pair.copy} · superseded ${TODAY} — delete after ${DELETE_AFTER}`
      : `${pair.copy} · not in the delivered gallery`;
    const summary = {
      pair: `${pair.copy}  →  ${pair.keep}`,
      keepImages: keepImgs.length,
      copyImages: copyImgs.length,
      twinsRemoved: twins.length,
      byTime: twins.filter((t) => t.by === "time+bytes").length,
      byName: twins.filter((t) => t.by === "name+bytes").length,
      extras: extras.length,
      extrasAction: extras.length === 0 ? "-" : pair.moveExtras ? "move into kept gallery" : "stay in copy",
      copyShares: (shares ?? []).map((s) => `${s.slug}${s.is_active ? "" : "(off)"} views=${s.view_count ?? 0}${s.password_hash ? " pw" : ""}`),
      emailsSentForCopy: emails ?? 0,
      rename: newName,
      sharesOff: empties,
    };
    console.log(JSON.stringify(summary, null, 2));
    if (!APPLY) continue;

    if ((emails ?? 0) > 0 && empties) {
      throw new Error(`${pair.copy}: an email went out for this copy — switching its link off needs Mason's say-so`);
    }

    // 1. Twins: database rows first, then their files.
    const twinRows = twins.map((t) => t.copy);
    for (let i = 0; i < twinRows.length; i += 200) {
      const slice = twinRows.slice(i, i + 200);
      const { error } = await db.from("images").delete().in("id", slice.map((r) => r.id)).eq("event_id", copy.id);
      if (error) throw error;
      await Promise.all(slice.map((r) => deleteImageAssets(r.r2_key, r.media_type)));
    }

    // 2. Extras into the kept gallery (moveExtras pairs).
    if (pair.moveExtras && extras.length) {
      const ids = extras.map((e) => e.id);
      let r = await db.from("faces").delete().in("image_id", ids);
      if (r.error) throw r.error;
      r = await db.from("section_images").delete().in("image_id", ids);
      if (r.error) throw r.error;
      r = await db.from("images").update({ event_id: keep.id, ai_indexed_at: null }).in("id", ids).eq("event_id", copy.id);
      if (r.error) throw r.error;
      const { data: sec, error: secErr } = await db
        .from("sections")
        .select("id")
        .eq("event_id", keep.id)
        .order("sort_order")
        .limit(1)
        .single();
      if (secErr) throw secErr;
      const { error: linkErr } = await db
        .from("section_images")
        .upsert(ids.map((image_id, i) => ({ section_id: sec.id, image_id, sort_order: 100000 + i })), { onConflict: "section_id,image_id" });
      if (linkErr) throw linkErr;
    }

    // 3. Face clusters the trim emptied — their faces went with the rows.
    const { data: persons, error: pErr } = await db.from("persons").select("id").eq("event_id", copy.id).order("id");
    if (pErr) throw pErr;
    const personIds = (persons ?? []).map((p) => p.id);
    const withFaces = new Set<string>();
    for (let i = 0; i < personIds.length; i += 200) {
      const { data, error } = await db.from("faces").select("person_id").in("person_id", personIds.slice(i, i + 200));
      if (error) throw error;
      for (const f of data ?? []) if (f.person_id) withFaces.add(f.person_id);
    }
    const emptyPersons = personIds.filter((id) => !withFaces.has(id));
    for (let i = 0; i < emptyPersons.length; i += 200) {
      const { error } = await db.from("persons").delete().in("id", emptyPersons.slice(i, i + 200));
      if (error) throw error;
    }

    // 4. Name and links.
    {
      const { error } = await db.from("events").update({ name: newName }).eq("id", copy.id);
      if (error) throw error;
    }
    if (empties) {
      const { error } = await db.from("shares").update({ is_active: false }).eq("event_id", copy.id);
      if (error) throw error;
    }

    // 5. Verify: counts, and one deleted file gone while its delivered twin stays.
    const { count: keepAfter } = await db.from("images").select("id", { count: "exact", head: true }).eq("event_id", keep.id);
    const { count: copyAfter } = await db.from("images").select("id", { count: "exact", head: true }).eq("event_id", copy.id);
    const probe = twins[0];
    const deletedGone = probe ? !(await objectExistsInR2(probe.copy.r2_key)) : null;
    const twinStays = probe ? await objectExistsInR2(probe.keep.r2_key) : null;
    const expectedKeep = keepImgs.length + (pair.moveExtras ? extras.length : 0);
    const expectedCopy = pair.moveExtras ? 0 : extras.length;
    const ok = keepAfter === expectedKeep && copyAfter === expectedCopy && deletedGone !== false && twinStays !== false;
    const result = { pair: pair.copy, keepAfter, expectedKeep, copyAfter, expectedCopy, emptyPersonsDeleted: emptyPersons.length, deletedFileGone: deletedGone, deliveredTwinStays: twinStays, ok };
    console.log("APPLIED", JSON.stringify(result));
    log.push({ ...summary, ...result, twinIds: twins.map((t) => [t.copy.id, t.keep.id]) });
    if (!ok) throw new Error(`${pair.copy}: verification failed — stopping before the next pair`);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply.");
    return;
  }
  const record = `consolidate-duplicates-${Date.now()}.json`;
  fs.writeFileSync(record, JSON.stringify(log, null, 2));
  console.log(`record: ${record}`);

  // /people counts should drop now, not at the next stale check.
  if (snapshotUser) {
    const { rebuildPeopleIndexSnapshot } = await import("../src/lib/people/index-cache");
    console.log("people index:", JSON.stringify(await rebuildPeopleIndexSnapshot(db, snapshotUser)));
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
