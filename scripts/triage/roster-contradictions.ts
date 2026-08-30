/**
 * Roster contradictions: the live answer, plus proof the checks still fire.
 *
 *   npx tsx scripts/triage/roster-contradictions.ts
 *
 * Two halves, and the second is the point.
 *
 * The live pass will usually print NOTHING, because the roster is usually
 * consistent — it printed nothing the day it was written, minutes after Joey
 * Nagoshiner was put back where he belonged. A guard whose healthy output is an
 * empty list is exactly the kind that rots unnoticed: the day it breaks, it
 * looks identical to the day everything is fine. (`~/.claude/rules/workflow.md`
 * — an empty result is a broken probe until proven otherwise.)
 *
 * So the FIXTURE pass replays Joey's real pre-fix state — non-regular, 13 gigs,
 * rated last_resort — and asserts each check fires on data built to trip it.
 * If the fixture half is silent, the checks are broken and the live "all clear"
 * above it means nothing.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import {
  findRosterContradictions,
  type ContradictionInput,
} from "../../src/lib/event-intel/roster-contradictions";

/* eslint-disable @typescript-eslint/no-explicit-any */

function env(): { url: string; key: string } {
  const raw = fs.readFileSync(".env.local", "utf8");
  const get = (k: string) =>
    raw.split("\n").find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? "";
  return { url: get("NEXT_PUBLIC_SUPABASE_URL"), key: get("SUPABASE_SERVICE_ROLE_KEY") };
}

/** The three shapes the checks look for, each built to trip exactly one. */
const FIXTURE: ContradictionInput[] = [
  // Joey, as he actually was on 2026-08-28.
  { id: "f1", display_name: "Joey (fixture)", is_regular: false, archived: false,
    rehire: "last_resort", eventCount: 13, latestEvent: "2026-08-15" },
  // The busiest real regular at the time, so the bar is a true 6.
  { id: "f2", display_name: "Sergio (fixture)", is_regular: true, archived: false,
    rehire: null, eventCount: 6, latestEvent: "2026-08-26" },
  // A starred person whose old rating is now dormant and invisible.
  { id: "f3", display_name: "Dormant (fixture)", is_regular: true, archived: false,
    rehire: "never", eventCount: 2, latestEvent: "2026-07-01" },
  // Archived, but worked last month.
  { id: "f4", display_name: "Alumni (fixture)", is_regular: false, archived: true,
    rehire: null, eventCount: 1, latestEvent: "2026-08-01" },
  // Ordinary non-regular — must NOT be flagged.
  { id: "f5", display_name: "Quiet (fixture)", is_regular: false, archived: false,
    rehire: "solid", eventCount: 1, latestEvent: "2026-06-01" },
];

async function main() {
  const { url, key } = env();
  const db = createClient(url, key) as any;

  const { data: crew } = await db
    .from("crew").select("id, display_name, is_regular, archived, rehire");
  const { data: links } = await db
    .from("event_crew").select("crew_id, events!inner(event_date, created_at)");

  const byCrew = new Map<string, string[]>();
  for (const l of links ?? []) {
    const d = l.events?.event_date ?? l.events?.created_at ?? null;
    if (!d) continue;
    byCrew.set(l.crew_id, [...(byCrew.get(l.crew_id) ?? []), d]);
  }

  const live = findRosterContradictions(
    (crew ?? []).map((c: any) => ({
      id: c.id,
      display_name: c.display_name,
      is_regular: !!c.is_regular,
      archived: !!c.archived,
      rehire: c.rehire ?? null,
      eventCount: (byCrew.get(c.id) ?? []).length,
      latestEvent: [...(byCrew.get(c.id) ?? [])].sort().pop() ?? null,
    }))
  );

  console.log(`\nLIVE — ${crew?.length ?? 0} people on the roster\n`);
  if (live.length === 0) console.log("  no contradictions\n");
  else for (const c of live) console.log(`  ${c.name} ${c.message}`);

  // ── The half that keeps the half above meaningful ──
  const fixture = findRosterContradictions(FIXTURE, new Date("2026-08-29"));
  console.log(`FIXTURE — replaying Joey's pre-fix state\n`);
  for (const c of fixture) console.log(`  ${c.name} ${c.message}`);

  const names = fixture.map((c) => c.name);
  const expected = ["Joey (fixture)", "Dormant (fixture)", "Alumni (fixture)"];
  const missing = expected.filter((n) => !names.includes(n));
  const wrongly = names.includes("Quiet (fixture)");

  if (missing.length || wrongly) {
    console.log(
      `\nFAIL — the checks are broken, so the LIVE result above proves nothing.` +
        (missing.length ? `\n  never fired for: ${missing.join(", ")}` : "") +
        (wrongly ? `\n  flagged an ordinary non-regular` : "") + "\n"
    );
    process.exit(1);
  }
  console.log(`\nPASS — all three checks fire, and the ordinary row is left alone.\n`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
