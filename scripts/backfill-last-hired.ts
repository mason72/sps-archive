/**
 * Seed crew.last_hired_on from twelve years of Google Calendar.
 *
 * Mason, 2026-08-15: "Please search google calendar for all of the people —
 * you should be able to find last hired dates for most/all of them."
 *
 * For every roster member (archived included), find the NEWEST calendar entry
 * they were an attendee on, and store its date as the last-hired seed. Same
 * resolution the gig backfill uses: email against primary_email + aliases,
 * because names on invites are garbage and emails are identity.
 *
 * Writes are MAX-ONLY: an existing seed newer than the calendar's answer is
 * kept (Mason may know something the calendar missed), and the read-time
 * derivation still lets a linked EVENT outrank whatever this writes. Studio
 * sittings are skipped — a person's own headshot booking is not a hire.
 *
 * Future-dated entries are ignored: a gig on next week's calendar is a plan,
 * not a hire that happened.
 *
 * Dry-run by default; --apply writes.
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const APPLY = process.argv.includes("--apply");

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { listEvents, CALENDARS, STUDIO_CALENDARS } = await import(
    "../src/lib/event-intel/google-calendar"
  );
  const { formatLastHired } = await import("../src/lib/event-intel/last-hired");

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: crew, error } = await db
    .from("crew")
    .select("id, display_name, primary_email, aliases, is_regular, archived, last_hired_on");
  if (error) { console.error(error.message); process.exit(2); }

  const crewByEmail = new Map<string, (typeof crew)[number]>();
  for (const c of crew ?? []) {
    for (const a of [c.primary_email, ...(c.aliases ?? [])]) {
      const e = String(a ?? "").toLowerCase().trim();
      if (e.includes("@")) crewByEmail.set(e, c);
    }
  }
  console.log(`roster: ${crew?.length} people, ${crewByEmail.size} email forms\n`);

  // Newest attendance per crew id, walking every non-studio calendar.
  const today = new Date().toISOString().slice(0, 10);
  const newest = new Map<string, string>();
  for (const key of Object.keys(CALENDARS) as (keyof typeof CALENDARS)[]) {
    if (STUDIO_CALENDARS.has(key)) continue; // sittings are subjects, not hires
    const evs = await listEvents(key, { timeMin: "2014-01-01T00:00:00Z" });
    let matched = 0;
    for (const ev of evs) {
      const day = (ev.start?.date ?? ev.start?.dateTime ?? "").slice(0, 10);
      if (!day || day > today) continue;
      for (const a of ev.attendees ?? []) {
        const c = crewByEmail.get(String(a.email ?? "").toLowerCase());
        if (!c) continue;
        matched++;
        const cur = newest.get(c.id);
        if (!cur || day > cur) newest.set(c.id, day);
      }
    }
    console.log(`${String(key).padEnd(10)} ${evs.length} entries, ${matched} attendee matches`);
  }

  console.log(`\ncalendar found dates for ${newest.size} of ${crew?.length} people:\n`);
  const nowD = new Date();
  let writes = 0;
  for (const c of (crew ?? []).sort((a, b) => a.display_name.localeCompare(b.display_name))) {
    const found = newest.get(c.id) ?? null;
    const existing = c.last_hired_on as string | null;
    const better = found && (!existing || found > existing) ? found : null;
    const tag = c.archived ? " (archived)" : c.is_regular ? " ★" : "";
    if (better) {
      console.log(
        `  ${c.display_name}${tag}: ${existing ?? "—"} → ${better}  [${formatLastHired(better, nowD)}]`
      );
      if (APPLY) {
        const { error: uErr } = await db
          .from("crew")
          .update({ last_hired_on: better })
          .eq("id", c.id);
        if (uErr) console.log(`    WRITE ERROR: ${uErr.message}`);
        else writes++;
      }
    } else if (!found && !existing) {
      console.log(`  ${c.display_name}${tag}: no calendar attendance found`);
    }
  }
  console.log(APPLY ? `\napplied: ${writes} rows` : "\n(dry run — pass --apply to write)");
}

main();
