/**
 * Every distinct crew location string, with how metroKeys() reads it.
 *
 * The question this answers: which of these are PLACES ON A MAP (a radius
 * search can use them) and which are only matching vocabulary ("east coast",
 * "tx")? A permissive key is fine for grouping and useless for distance.
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { metroKeys } = await import("../../src/lib/event-intel/geo");
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await s
    .from("crew")
    .select("id, display_name, city, region, is_regular, archived");
  if (error) {
    console.error("QUERY ERROR:", error.message);
    process.exit(2);
  }

  const rows = (data ?? []).filter((c) => !c.archived);
  console.log(`active crew: ${rows.length}`);

  const byCity = new Map<string, { n: number; names: string[]; keys: string[] }>();
  let blank = 0;
  for (const c of rows) {
    const raw = (c.city ?? "").trim();
    if (!raw) {
      blank++;
      continue;
    }
    const e = byCity.get(raw) ?? { n: 0, names: [], keys: metroKeys(raw) };
    e.n++;
    if (e.names.length < 4) e.names.push(c.display_name as string);
    byCity.set(raw, e);
  }

  console.log(`blank city: ${blank}`);
  console.log(`distinct city strings: ${byCity.size}\n`);

  const sorted = [...byCity.entries()].sort((a, b) => b[1].n - a[1].n);
  for (const [raw, e] of sorted) {
    console.log(
      `${String(e.n).padStart(3)}  ${raw.padEnd(28)} → [${e.keys.join(", ")}]   ${e.names.join(", ")}`
    );
  }

  // Venue cities matter too: a radius search is asked FROM somewhere, and that
  // somewhere is usually a gig's venue.
  const { data: venues, error: vErr } = await s.from("venues").select("city");
  if (vErr) {
    console.error("VENUE ERROR:", vErr.message);
    return;
  }
  const vKeys = new Map<string, number>();
  for (const v of venues ?? []) {
    for (const k of metroKeys(v.city)) vKeys.set(k, (vKeys.get(k) ?? 0) + 1);
  }
  console.log(`\nvenue metro keys (${vKeys.size}):`);
  for (const [k, n] of [...vKeys.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(n).padStart(3)}  ${k}`);
  }
}

main();
