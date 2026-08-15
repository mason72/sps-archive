/**
 * Size the radius-filter and rating work against the REAL roster.
 *
 *   npx tsx scripts/triage/crew-geo-sizing.ts
 *
 * Three questions, none of which should be answered by guessing:
 *  1. How many rebook judgements exist today? (Decides whether changing the
 *     vocabulary is free or a migration.)
 *  2. How many crew cities resolve through metroKeys(), and what are the
 *     stragglers? (That set IS the work for a miles-from filter.)
 *  3. How many DISTINCT metros do venues and crew span? (That is how many
 *     lat/lng pairs a hand-kept centroid table would need.)
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { metroKeys } = await import("../../src/lib/event-intel/geo");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  const [{ data: crew, error: cErr }, { data: links, error: lErr }, { data: venues, error: vErr },
         { data: intel, error: iErr }] = await Promise.all([
    db.from("crew").select("id, display_name, city, region, is_regular, archived, travels, kind"),
    db.from("event_crew").select("crew_id, would_rebook, note, roles, confirmed_roles"),
    db.from("venues").select("id, name, city, region"),
    db.from("event_intel").select("event_id, calendar_event_ids, confirmed_at"),
  ]);
  for (const e of [cErr, lErr, vErr, iErr]) if (e) throw e;

  // ── 1. rebook judgements today ──
  const rebook: Record<string, number> = {};
  let notes = 0;
  for (const l of links ?? []) {
    rebook[l.would_rebook ?? "(none)"] = (rebook[l.would_rebook ?? "(none)"] ?? 0) + 1;
    if (l.note) notes++;
  }
  console.log("── rebook judgements on event_crew ──");
  console.log(rebook, `· ${notes} notes · ${links?.length ?? 0} links total\n`);

  // ── 1b. already-mapped calendar entries ──
  const mapped = new Set<string>();
  let intelRows = 0;
  for (const r of intel ?? []) {
    intelRows++;
    for (const id of r.calendar_event_ids ?? []) mapped.add(String(id));
  }
  console.log("── already-mapped calendar entries ──");
  console.log(`${intelRows} event_intel rows · ${mapped.size} distinct calendar ids already used\n`);

  // ── 2. crew city resolution ──
  const active = (crew ?? []).filter((c: { archived: boolean }) => !c.archived);
  const unresolved: string[] = [];
  const crewMetros = new Set<string>();
  let noCity = 0;
  for (const c of active) {
    const raw = [c.city, c.region].filter(Boolean).join(", ");
    if (!raw) { noCity++; continue; }
    const keys = metroKeys(raw);
    if (!keys.length) unresolved.push(`${c.display_name}: "${raw}"`);
    else for (const k of keys) crewMetros.add(k);
  }
  console.log("── crew location resolution (active only) ──");
  console.log(`${active.length} active · ${noCity} with no city at all · ${unresolved.length} unresolved`);
  console.log(`${crewMetros.size} distinct crew metros`);
  if (unresolved.length) console.log("unresolved:\n  " + unresolved.slice(0, 30).join("\n  "));
  console.log();

  // ── 3. venue metros ──
  const venueMetros = new Set<string>();
  const venueUnresolved: string[] = [];
  for (const v of venues ?? []) {
    const raw = [v.city, v.region].filter(Boolean).join(", ");
    if (!raw) continue;
    const keys = metroKeys(raw);
    if (!keys.length) venueUnresolved.push(`${v.name}: "${raw}"`);
    else for (const k of keys) venueMetros.add(k);
  }
  console.log("── venue metros ──");
  console.log(`${venues?.length ?? 0} venues · ${venueMetros.size} distinct metros · ${venueUnresolved.length} unresolved`);
  if (venueUnresolved.length) console.log("  " + venueUnresolved.slice(0, 20).join("\n  "));

  const union = new Set([...crewMetros, ...venueMetros]);
  console.log(`\n── centroid table would need ${union.size} lat/lng pairs ──`);
  console.log([...union].sort().join(", "));

  // ── travellers, since a radius that ignores this surfaces people who won't go ──
  const travel: Record<string, number> = {};
  for (const c of active) travel[String(c.travels ?? "(unset)")] = (travel[String(c.travels ?? "(unset)")] ?? 0) + 1;
  console.log("\n── travels ──");
  console.log(travel);
}

main().catch((e) => { console.error(e); process.exit(1); });
