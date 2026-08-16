/**
 * Repair + proof in one: run the EXACT production write path (applyGigIntel,
 * the same call the import route makes) with the payload the import card
 * should have sent for Kelly — rehire first_call on the Chicago gig. If
 * would_rebook lands, the server pipe is proven good and the loss was
 * client-side; either way Kelly's rating is what Mason said it should be.
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const { applyGigIntel } = await import("../../src/lib/event-intel/apply-gig");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const userId = "d5b2e276-d33d-49b3-ba09-59164c622b21";
  const eventId = "7f174a0b-2c13-4981-9285-81fb05050ed6"; // KFL Chicago
  const { data: kelly } = await s.from("crew").select("id").eq("display_name", "Kelly Cunningham").single();

  const result = await applyGigIntel(s, {
    userId,
    eventId,
    crew: [{ crewId: kelly!.id, roles: ["stylist"], confirmedRoles: [], rehire: "first_call", note: null }],
    confirmed: true,
  });
  console.log("applyGigIntel:", JSON.stringify(result));

  const { data: row } = await s
    .from("event_crew")
    .select("roles, confirmed_roles, would_rebook, roles_source")
    .eq("event_id", eventId)
    .eq("crew_id", kelly!.id)
    .single();
  console.log("Kelly's Chicago row now:", JSON.stringify(row));
})();
