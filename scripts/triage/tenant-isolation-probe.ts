/**
 * Tenant-isolation probe (pilot audit, 2026-11-14). READ-ONLY against
 * production: it reads rows and calls the read paths; it writes nothing.
 *
 *   npx tsx scripts/triage/tenant-isolation-probe.ts
 *
 * For each guard the audit added, two answers:
 *   - OWNER: the account that owns the photos keeps every one, including the
 *     TDP Website/Work galleries' cross-event (same-owner) photos. This is the
 *     regression check: an event-scoped guard would fail it.
 *   - STRANGER: any other account id gets nothing. This is the fix.
 * A guard that passes only one of the two proves nothing.
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label.padEnd(58)} ${detail}`);
}

async function main() {
  const { createServiceClient } = await import("@/lib/supabase/server");
  const { ownedImageIds } = await import("@/lib/auth/ownership");
  const { loadTileRows, fetchMosaicPool } = await import("@/lib/cover/pool");
  const { enrichEvents } = await import("@/lib/events/enrich");
  const { resolveRecap } = await import("@/lib/recap/payload");
  const { WEBSITE_EVENT_SLUG } = await import("@/lib/site/gallery");
  const { WORK_EVENT_SLUG, JOB_KEY_PREFIX } = await import("@/lib/site/jobs");
  const supabase = createServiceClient();

  // The owner is whoever owns the website gallery; the stranger is a real
  // account that owns nothing (falls back to a made-up id).
  const { data: site } = await supabase.from("events").select("id, user_id").eq("slug", WEBSITE_EVENT_SLUG).single();
  const { data: work } = await supabase.from("events").select("id").eq("slug", WORK_EVENT_SLUG).single();
  if (!site || !work) throw new Error("TDP Website / Work gallery not found");
  const owner = site.user_id as string;
  const { data: users } = await supabase.auth.admin.listUsers({ perPage: 200 });
  let stranger = crypto.randomUUID();
  for (const u of users?.users ?? []) {
    if (u.id === owner) continue;
    const { count } = await supabase.from("events").select("id", { count: "exact", head: true }).eq("user_id", u.id);
    if ((count ?? 0) === 0) { stranger = u.id; break; }
  }
  console.log(`owner ${owner.slice(0, 8)}  stranger ${stranger.slice(0, 8)}\n`);

  // 1. The write gate: section links and selection shares.
  const { data: sectionRows } = await supabase.from("sections").select("id").eq("event_id", site.id);
  const { data: links } = await supabase
    .from("section_images").select("image_id")
    .in("section_id", (sectionRows ?? []).map((s) => s.id)).limit(1000);
  const siteIds = [...new Set((links ?? []).map((l) => l.image_id as string))];
  const asOwner = await ownedImageIds(supabase, owner, siteIds);
  const asStranger = await ownedImageIds(supabase, stranger, siteIds);
  check("ownedImageIds: owner keeps the website's cross-event photos", siteIds.length > 0 && asOwner.size === siteIds.length, `${asOwner.size}/${siteIds.length}`);
  check("ownedImageIds: stranger gets none of them", asStranger.size === 0, `${asStranger.size}/${siteIds.length}`);

  // 2. Covers, OG images, recap tiles.
  const ownerTiles = await loadTileRows(supabase, siteIds, owner);
  const strangerTiles = await loadTileRows(supabase, siteIds, stranger);
  const { count: displayable } = await supabase
    .from("images").select("id", { count: "exact", head: true })
    .in("id", siteIds.slice(0, 100)).eq("thumbnail_generated", true).neq("media_type", "video");
  const ownerFirst100 = (await loadTileRows(supabase, siteIds.slice(0, 100), owner)).length;
  check("loadTileRows: owner keeps every displayable tile (first 100)", ownerFirst100 === (displayable ?? -1), `${ownerFirst100} vs ${displayable} displayable`);
  check("loadTileRows: stranger owner gets no tiles", strangerTiles.length === 0 && ownerTiles.length > 0, `${strangerTiles.length} (owner ${ownerTiles.length})`);
  check("loadTileRows: no owner id leaks into tile rows", ownerTiles.every((t) => !("events" in t)), "");
  const pool = await fetchMosaicPool(site.id, undefined);
  check("fetchMosaicPool(TDP Website) still draws a pool", pool.length > 0, `${pool.length} tiles`);

  // 3. Archive card covers: a photo cover is honored only for its owner.
  const { data: ownerEvents } = await supabase
    .from("events").select("id, user_id, settings").eq("user_id", owner)
    .not("settings->cover->>imageId", "is", null).limit(200);
  // A refused cover falls back to the event's OWN first photo (correct), so
  // "has a cover" proves nothing. The question is whether the card shows the
  // NAMED photo, judged only on events where that photo is not also the
  // fallback (else both answers look the same).
  const { getThumbnailKey } = await import("@/lib/r2/client");
  const evs = ownerEvents ?? [];
  // The card's own rule: a stored imageId counts only for a PHOTO cover.
  const { coverImageIdFor } = await import("@/lib/events/enrich");
  const coverIdOf = (e: { id: string; settings: unknown }) => coverImageIdFor(e) ?? "";
  const { data: coverImgs } = await supabase.from("images").select("id, r2_key").in("id", evs.map(coverIdOf).filter(Boolean));
  const keyById = new Map((coverImgs ?? []).map((i) => [i.id as string, i.r2_key as string]));
  const { data: firsts } = await supabase.rpc("first_image_per_event", { p_event_ids: evs.map((e) => e.id) });
  const firstKey = new Map((firsts ?? []).map((f: { event_id: string; r2_key: string }) => [f.event_id, f.r2_key]));
  const judged = evs.filter((e) => keyById.has(coverIdOf(e)) && keyById.get(coverIdOf(e)) !== firstKey.get(e.id));
  const showsNamed = (m: Awaited<ReturnType<typeof enrichEvents>>) =>
    judged.filter((e) => (m.get(e.id)?.coverThumbnailUrl ?? "").includes(getThumbnailKey(keyById.get(coverIdOf(e))!))).length;
  const asItself = showsNamed(await enrichEvents(supabase, evs));
  const forged = showsNamed(await enrichEvents(supabase, evs.map((e) => ({ ...e, user_id: stranger }))));
  check("enrichEvents: the named cover photo shows for its owner", judged.length > 0 && asItself === judged.length, `${asItself} of ${judged.length} judged events`);
  check("enrichEvents: the same cover ids show a stranger nothing", forged === 0, `${forged} of ${judged.length}`);

  // 4. Recap leads for the two live TDP Website selections (TDP Work photos).
  const { data: shares, error: sharesError } = await supabase
    .from("shares").select("id, slug, image_ids, is_active, password_hash")
    .eq("event_id", site.id).eq("share_type", "selection").eq("is_active", true);
  // An empty or failed read would skip every recap check and still say ALL PASS.
  check("recap: live website selections exist to test", !sharesError && (shares?.length ?? 0) > 0, sharesError?.message ?? `${shares?.length ?? 0} shares`);
  for (const sh of shares ?? []) {
    // The share's own id is what the password cookie holds, so a locked share
    // is opened here too: a "locked" answer would otherwise pass untested.
    const r = await resolveRecap(sh.slug as string, sh.id as string, "https://app.pixeltrunk.com", 12, false);
    const leads = r.kind === "ok" ? r.payload.leads.length : -1;
    const expected = Math.min(12, (sh.image_ids as string[] | null)?.length ?? 0);
    check(`recap ${sh.slug}: selection still shows its photos`, r.kind === "ok" && leads > 0, `${r.kind}, ${leads} leads of up to ${expected}`);
  }

  // 5. The public jobs feed: scoped to TDP Work, and nothing lost.
  const { count: allJobs } = await supabase.from("sections").select("id", { count: "exact", head: true }).like("site_scene_key", `${JOB_KEY_PREFIX}%`);
  const { count: workJobs } = await supabase.from("sections").select("id", { count: "exact", head: true }).eq("event_id", work.id).like("site_scene_key", `${JOB_KEY_PREFIX}%`);
  check("site jobs: the Work-scoped query keeps every live job", allJobs === workJobs && (workJobs ?? 0) > 0, `${workJobs} scoped vs ${allJobs} unscoped`);

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
