import fs from "node:fs";
for (const l of fs.readFileSync(".env.local","utf8").split("\n")) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]]===undefined) process.env[m[1]]=m[2]; }

/**
 * What the name suggester would propose for every existing gallery.
 *
 * No calendar call: the naming convention is derived from the name itself, and
 * the spelling rescue only fires when a matched calendar entry supplies a
 * client. This is the backfill view — the confirm card at upload time has the
 * matched entry and can do better.
 */
async function main(){
  const P = await import("../../src/lib/event-intel/parse-calendar");
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  const { data: events, error } = await db
    .from("events").select("id,name,sort_date")
    .order("sort_date", { ascending: false }).limit(200);
  if (error) throw new Error(error.message);

  let n = 0;
  for (const e of events ?? []) {
    const s = P.suggestEventName(e.name, { client: e.name, date: e.sort_date });
    const proposed = s.dateHint ? `${s.suggested} ${s.dateHint}` : s.suggested;
    if (proposed === e.name) continue;
    n++;
    console.log(`  ${e.sort_date}  ${e.name}`);
    console.log(`            → ${proposed}`);
    if (s.reasons.length) console.log(`              ${s.reasons.join("; ")}`);
    console.log(`              ${e.id}\n`);
  }
  console.log(`${n} proposals of ${(events ?? []).length} events`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
