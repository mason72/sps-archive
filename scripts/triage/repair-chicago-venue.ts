/**
 * Restore what the Kelly-rating repair clobbered: the Chicago import's venue
 * link and calendar provenance. The venue row itself survived (applyGigIntel
 * only nulled the LINK); the calendar id is known from the earlier probe.
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const eventId = "7f174a0b-2c13-4981-9285-81fb05050ed6";

  const { data: cur } = await s.from("event_intel").select("venue_id, calendar_event_ids").eq("event_id", eventId).single();
  console.log("before:", JSON.stringify(cur));

  const { data: venue } = await s.from("venues").select("id, name").ilike("name", "%North Riverside%").maybeSingle();
  if (!venue) { console.log("venue row not found!"); process.exit(2); }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (!cur?.venue_id) patch.venue_id = venue.id;
  if (!cur?.calendar_event_ids?.length) patch.calendar_event_ids = ["4pcnrb77e97rbl5rd2lcn2htfg"];
  const { error } = await s.from("event_intel").update(patch).eq("event_id", eventId);
  console.log(error ? `ERROR ${error.message}` : `restored → venue "${venue.name}"`);

  const { data: after } = await s.from("event_intel").select("venue_id, calendar_event_ids").eq("event_id", eventId).single();
  console.log("after:", JSON.stringify(after));
})();
