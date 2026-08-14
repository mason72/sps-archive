import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

/**
 * Pre-fill crew roles so Mason edits instead of typing 42 links from scratch.
 *
 * EVERY RULE HERE CAME FROM HIM. Nothing is invented:
 *
 *   "There's photographers, digital technicians, stylist, makeup artist."
 *   "Many times the photographers and digital tech will trade-off and switch
 *    places."                                                    → both roles
 *   "Some jobs will have multiple leads, for example if we have more than one
 *    booth."                                      → lead is not unique per event
 *
 * Lead comes from a SENIORITY LADDER he gave outright — Joey > Jerrick >
 * Stretch > Justin > anyone else — which beats the title order the first
 * version read, and answers correctly even on the events whose title order
 * could not be recovered. Title order survives only as the fallback when
 * nobody from the ladder is on the crew.
 *
 * All of it is still a guess: every row written here is marked
 * `roles_source = 'inferred'` and rendered as provisional.
 *
 * SAFETY. A link already marked 'manual' is never touched — a human decision
 * outranks a re-run, and that is the same rule as `event_intel.confirmed_at`.
 * The roster's `can_lead` is a STANDING CAPABILITY and deliberately does not
 * grant `lead` on a gig: being able to lead is not having led.
 */

const ROLE_VOCAB = [
  { name: "lead", sort_order: 0 },
  { name: "photographer", sort_order: 1 },
  { name: "digital tech", sort_order: 2 },
  { name: "assistant", sort_order: 3 },
  { name: "stylist", sort_order: 4 },
  { name: "makeup artist", sort_order: 5 },
];

/**
 * Who leads when several of them are on the same job, most senior first.
 * Mason, 2026-08-13: "Generally leads are Joey > Jerrick > Stretch > Justin >
 * anyone else so if those people are on a job together Joey would always be
 * the lead."
 */
const LEAD_LADDER = ["Joey", "Jerrick", "Stretch", "Justin"];

/** A booth gig, where the pair genuinely trade off. */
const BOOTH = /\b(?:booth|photo\s*booth)\b/i;

async function main() {
  const apply = process.argv.includes("--apply");
  const { listEvents, CALENDARS, STUDIO_CALENDARS } = await import("../src/lib/event-intel/google-calendar");
  const P = await import("../src/lib/event-intel/parse-calendar");
  const { createServiceClient } = await import("../src/lib/supabase/server");
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const db = createServiceClient() as any;

  const { data: anyEvent } = await db.from("events").select("user_id").limit(1).single();
  const userId = anyEvent.user_id;

  // ── 1. Seed the vocabulary ───────────────────────────────────────────────
  for (const r of ROLE_VOCAB) {
    const { data: existing } = await db
      .from("crew_roles").select("id").eq("user_id", userId).ilike("name", r.name).maybeSingle();
    if (existing) continue;
    if (apply) await db.from("crew_roles").insert({ ...r, user_id: userId });
    console.log(`  role vocabulary + ${r.name}`);
  }

  // ── 2. Title order, from the calendar entries the intel rows point at ─────
  const { data: intel } = (await db
    .from("event_intel").select("event_id,calendar_event_ids").eq("user_id", userId)) as {
      data: { event_id: string; calendar_event_ids: string[] | null }[] | null;
    };
  const wanted = new Set<string>();
  for (const i of intel ?? []) for (const id of i.calendar_event_ids ?? []) wanted.add(id);

  /** calendarEventId → crew names in the order the title lists them. */
  const orderByCalId = new Map<string, string[]>();
  /** calendarEventId → is this a studio sitting (no crew convention at all)? */
  const studioIds = new Set<string>();

  for (const key of Object.keys(CALENDARS) as (keyof typeof CALENDARS)[]) {
    const evs = await listEvents(key, { timeMin: "2014-01-01T00:00:00Z" });
    for (const ev of evs) {
      if (!ev.id || !wanted.has(ev.id)) continue;
      if (STUDIO_CALENDARS.has(key)) { studioIds.add(ev.id); continue; }
      const g = P.parseGig(ev);
      if (g.titleCrew.length) orderByCalId.set(ev.id, g.titleCrew);
    }
  }
  console.log(`\n  title order recovered for ${orderByCalId.size} of ${wanted.size} calendar entries`);

  // ── 3. Resolve title names to crew rows ──────────────────────────────────
  const { data: crew } = await db.from("crew").select("id,display_name,full_name").eq("user_id", userId);
  const firstName = (s: string) => s.trim().split(/\s+/)[0].toLowerCase();
  const byFirst = new Map<string, string[]>();
  for (const c of crew ?? []) {
    for (const n of [c.display_name, c.full_name].filter(Boolean) as string[]) {
      const k = firstName(n);
      byFirst.set(k, [...(byFirst.get(k) ?? []), c.id]);
    }
  }
  /** Ambiguous first names resolve to nobody — a wrong lead is worse than none. */
  const resolve = (titleName: string): string | null => {
    const hits = [...new Set(byFirst.get(firstName(titleName)) ?? [])];
    return hits.length === 1 ? hits[0] : null;
  };

  /**
   * The lead ladder, most senior first (Mason, 2026-08-13). Resolved once
   * against the crew registry so a rename does not silently break it — and
   * loudly, because a ladder that quietly matches nobody would hand every lead
   * back to title order without saying so.
   */
  const ladderId = new Map<string, string>();
  for (const want of LEAD_LADDER) {
    const hit = (crew ?? []).find(
      (c: any) =>
        firstName(c.display_name) === want.toLowerCase() ||
        String(c.display_name).toLowerCase() === want.toLowerCase()
    );
    if (hit) ladderId.set(want, hit.id);
    else console.log(`  ⚠ lead ladder: no crew row matches "${want}"`);
  }

  // ── 4. Assign ────────────────────────────────────────────────────────────
  const { data: links } = await db
    .from("event_crew").select("event_id,crew_id,roles,roles_source").eq("user_id", userId);
  const { data: events } = await db.from("events").select("id,name").eq("user_id", userId);
  const eventName = new Map<string, string>((events ?? []).map((e: any) => [e.id, e.name as string]));
  const intelByEvent = new Map((intel ?? []).map((i) => [i.event_id, i]));

  const byEvent = new Map<string, any[]>();
  for (const l of links ?? []) byEvent.set(l.event_id, [...(byEvent.get(l.event_id) ?? []), l]);

  let written = 0, skippedManual = 0, noSignal = 0;
  for (const [eventId, rows] of byEvent) {
    const name = eventName.get(eventId) ?? "";
    const calIds: string[] = intelByEvent.get(eventId)?.calendar_event_ids ?? [];
    const isStudio = calIds.some((id) => studioIds.has(id));
    const order = calIds.map((id) => orderByCalId.get(id)).find(Boolean) ?? null;

    /**
     * LEAD IS A SENIORITY LADDER, not a title position.
     *
     * Mason, 2026-08-13: "Generally leads are Joey > Jerrick > Stretch > Justin
     * > anyone else, so if those people are on a job together Joey would always
     * be the lead."
     *
     * That beats reading the title order, which was only ever a convention —
     * and the ladder answers correctly even for the events where no title order
     * could be recovered. Title order stays as the fallback for a crew with
     * nobody from the ladder on it.
     */
    const ladderHit = LEAD_LADDER.map((n) => ladderId.get(n))
      .find((id) => id && rows.some((r) => r.crew_id === id));

    const leadIds = new Set<string>();
    // A lead implies people to lead. A solo sitting has none, and marking the
    // one person there as "lead" is noise Mason would have to clear.
    if (rows.length < 2) {
      // no lead
    } else if (ladderHit) {
      leadIds.add(ladderHit);
    } else if (order) {
      const first = resolve(order[0]);
      if (first) leadIds.add(first);
    }

    const isBooth = BOOTH.test(name);
    for (const row of rows) {
      if (row.roles_source === "manual" && (row.roles ?? []).length) { skippedManual++; continue; }

      const roles: string[] = [];
      if (leadIds.has(row.crew_id)) roles.push("lead");

      if (isStudio) {
        // A studio sitting is one photographer and a client. No convention to read.
        roles.push("photographer");
      } else if (isBooth && rows.length >= 2) {
        // His words: on a booth the pair trade off and switch places, so both
        // genuinely hold both roles rather than one holding each.
        roles.push("photographer", "digital tech");
      } else if (rows.length === 1) {
        roles.push("photographer");
      } else if (order) {
        const idx = order.map(resolve).indexOf(row.crew_id);
        if (idx === 0) {
          roles.push("photographer");
        } else if (idx > 0) {
          roles.push("digital tech");
        } else {
          // NOT IN THE TITLE AT ALL — an attendee Joey did not name. `indexOf`
          // returns -1 here and `idx <= 0` quietly folded it in with "first
          // named", which are opposite situations. There is no signal, so this
          // is the bare default and the weakest guess on the board; it is
          // exactly the kind of thing `roles_source = 'inferred'` exists for.
          roles.push("photographer");
        }
      } else {
        noSignal++;
        continue;
      }

      const unique = [...new Set(roles)];
      console.log(`  ${name.slice(0, 34).padEnd(36)} ${unique.join(", ")}`);
      if (apply) {
        const { error } = await db
          .from("event_crew")
          .update({ roles: unique, roles_source: "inferred" })
          .eq("event_id", eventId).eq("crew_id", row.crew_id);
        if (error) console.error(`     ✗ ${error.message}`);
      }
      written++;
    }
  }

  console.log(`\n  ${written} links assigned · ${skippedManual} left alone (already manual) · ${noSignal} had no signal at all`);
  if (!apply) console.log("  dry run — re-run with --apply");
}

main().catch((e) => { console.error(e.message); process.exit(1); });
