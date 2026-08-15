/**
 * Did the calendar leak actually reach anybody?
 *
 * `/api/events/suggest-gig` authenticated the caller but never checked WHICH
 * caller, so any signed-in account on /events/new that typed 2+ characters got
 * Two Dudes' gigs. This asks what evidence exists either way — it cannot prove
 * a negative (there is no request log for that route), so it reports the
 * reachable signals and says so.
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

// The route shipped with the create-screen confirm (deploy 899bc36, ~16:09 UTC
// on 2026-08-15). Held deliberately EARLY so the comparison errs toward
// reporting exposure rather than away from it.
const SHIPPED = "2026-08-15T02:00:00Z";

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: users } = await s.auth.admin.listUsers({ perPage: 200 });
  const owners = (process.env.EVENT_INTEL_USER_IDS || "").split(",").map((x) => x.trim());
  const others = (users?.users ?? []).filter((u) => !owners.includes(u.id));

  console.log(`route live since (approx): ${SHIPPED}`);
  console.log(`accounts NOT entitled to Intel: ${others.length}`);
  for (const u of others) {
    console.log(`\n  ${u.email}  id=${u.id}`);
    console.log(`    created:        ${u.created_at}`);
    console.log(`    last sign-in:   ${u.last_sign_in_at ?? "never"}`);
    const signedInSince =
      !!u.last_sign_in_at && u.last_sign_in_at > SHIPPED;
    console.log(
      `    signed in SINCE the route shipped: ${signedInSince ? "YES — assume exposure possible" : "no"}`
    );

    // Reaching the create screen usually leaves a trace: an event.
    for (const t of ["events", "sps_connections"]) {
      const { count, error } = await s
        .from(t)
        .select("id", { count: "exact", head: true })
        .eq("user_id", u.id);
      console.log(`    ${t}: ${error ? `ERROR ${error.message}` : count}`);
    }
  }

  console.log(
    "\nNOTE — this CANNOT prove a negative, and two gaps matter:" +
      "\n  · There is no request log for /api/events/suggest-gig." +
      "\n  · `last_sign_in_at` does not move on a token REFRESH, so a session" +
      "\n    opened before the route shipped could have browsed since without" +
      "\n    changing that timestamp." +
      "\nExposure also required being on /events/new (or, since today, the SPS" +
      "\nimport review screen) with 2+ characters typed — the route returns []" +
      "\nbelow that threshold. Absence of evidence, not evidence of absence."
  );
}

main();
