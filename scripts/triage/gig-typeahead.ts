/**
 * Probe the create-screen gig lookup against the REAL calendar.
 *
 *   npx tsx scripts/triage/gig-typeahead.ts "perkin" 2018-02-12
 *   npx tsx scripts/triage/gig-typeahead.ts "appfolio"
 *
 * Exercises exactly the path `/api/events/suggest-gig` takes — window, fetch,
 * group, rank — minus auth and the roster join. Green unit tests encode my
 * assumptions faithfully, including the wrong ones (lesson 73); this asks the
 * calendar.
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const q = process.argv[2] ?? "";
const date = process.argv[3] ?? null;

async function main() {
  const { fetchGigsInWindow, windowFor, hasCalendarCredential } =
    await import("../../src/lib/event-intel/lookup-gigs");
  const { rankGigs } = await import("../../src/lib/event-intel/match-gig");
  const { parseGig, parseVenue } = await import("../../src/lib/event-intel/parse-calendar");
  const { payerDomains } = await import("../../src/lib/event-intel/apply-gig");

  console.log(`credential: ${hasCalendarCredential() ? "present" : "MISSING"}`);
  const win = windowFor(date, new Date());
  console.log(`query "${q}"  date ${date ?? "(none)"}  window ${win.from} → ${win.to}\n`);

  const t0 = Date.now();
  const gigs = await fetchGigsInWindow(win);
  console.log(`${gigs.length} gigs in window (${Date.now() - t0}ms)\n`);

  const ranked = rankGigs(gigs, {
    name: q,
    day: date,
    windowDays: 10,
    typeahead: true,
    haystack: (g) => {
      const parsed = g.events.map(parseGig);
      return [
        g.client ?? "",
        ...g.events.map((e) => e.summary ?? ""),
        ...parsed.map((p) => p.venue ?? ""),
        ...parsed.map((p) => p.city ?? ""),
      ].filter(Boolean);
    },
  }).slice(0, 6);

  if (!ranked.length) {
    console.log("no candidates — is the query too short, or the window wrong?");
    return;
  }

  for (const r of ranked) {
    const parsed = r.gig.events.map(parseGig);
    const venue = parsed.map((p) => p.venue).find(Boolean);
    const v = venue ? parseVenue(venue) : null;
    const attendees = [...new Set(parsed.flatMap((p) => p.attendees.map((a) => a.email)))];
    console.log(
      `${r.score.toFixed(2)}  ${(r.gig.events[0]?.summary ?? "").slice(0, 60)}\n` +
        `      ${r.gig.start}${r.gig.end !== r.gig.start ? `–${r.gig.end}` : ""}` +
        `  matched[${r.shared.join("+")}]  gap ${r.dayGap ?? "—"}\n` +
        `      venue: ${v?.name ?? v?.street ?? "—"}${v?.city ? ` (${v.city})` : ""}\n` +
        `      attendees: ${attendees.join(", ") || "—"}\n` +
        `      payer: ${payerDomains(parsed.flatMap((p) => p.contactEmails)).join(", ") || "—"}\n`
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
