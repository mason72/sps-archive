import fs from "node:fs";
for (const l of fs.readFileSync(".env.local","utf8").split("\n")) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]]===undefined) process.env[m[1]]=m[2]; }

async function main(){
  const { listEvents, CALENDARS, STUDIO_CALENDARS } = await import("../../src/lib/event-intel/google-calendar");
  const P = await import("../../src/lib/event-intel/parse-calendar");
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  // Recurrence must be judged against the WHOLE history, not the window we care
  // about — a client shot yearly since 2019 is recurring even if this year has
  // one entry.
  const clients: string[] = [];
  const studioIndividual = new Map<string, boolean>();
  for (const key of Object.keys(CALENDARS) as (keyof typeof CALENDARS)[]) {
    const evs = await listEvents(key, { timeMin: "2016-01-01T00:00:00Z" });
    for (const ev of evs) {
      if (STUDIO_CALENDARS.has(key)) {
        const s = P.parseStudioSession(ev);
        if (!s.isBooking || !s.clientName) continue;
        clients.push(s.clientName);
        studioIndividual.set(P.recurringClientKey(s.clientName), s.isIndividual);
      } else {
        const g = P.parseGig(ev);
        if (g.kind !== "gig") continue;
        if (g.client) clients.push(g.client);
      }
    }
    process.stderr.write(`${key}: ${evs.length} entries\n`);
  }
  const recurring = P.buildRecurringClients(clients);
  console.log(`\ncorpus ${clients.length} client mentions → ${recurring.size} recurring clients\n`);

  const { data: events } = await db
    .from("events").select("id,name,sort_date")
    .order("sort_date", { ascending: false }).limit(40);

  console.log("proposals — spelling and date together\n");
  let n = 0;
  for (const e of events ?? []) {
    const key = P.recurringClientKey(e.name);
    const s = P.suggestEventName(e.name, {
      client: e.name,
      date: e.sort_date,
      isIndividual: studioIndividual.get(key) ?? false,
      recurringClient: recurring.has(key),
    });
    const withDate = s.dateHint ? `${s.suggested} ${s.dateHint}` : s.suggested;
    if (withDate === e.name) continue;
    n++;
    console.log(`  ${e.sort_date}  ${e.name}`);
    console.log(`            → ${withDate}`);
    if (s.reasons.length) console.log(`              ${s.reasons.join("; ")}`);
    console.log(`              ${e.id}\n`);
  }
  console.log(`${n} proposals of ${(events ?? []).length} events`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
