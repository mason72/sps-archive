/**
 * Archive-wide focal sweep — pure arithmetic, zero Modal calls.
 *
 * Every image already has faces rows (the AI indexer wrote them), so filling
 * focal points is just computeAutoFocal over stored boxes. This exists to
 * apply the NEW group-anchor rule (union-box center / mean eye level,
 * 2026-08-10) to the backlog of group shots that previously got nothing.
 * Fill-nulls-only, as always — manual picks and existing anchors untouched.
 *
 *   npx tsx scripts/backfill-group-focals.ts
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { ensureAutoFocal } = await import("../src/lib/faces/ensure-focal");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ) as unknown as Parameters<typeof ensureAutoFocal>[0];

  const { data: events } = await supabase.from("events").select("id, name");
  let total = 0;
  for (const ev of events ?? []) {
    let written = 0;
    for (let page = 0; ; page++) {
      const { data: rows } = await supabase
        .from("images")
        .select("id, r2_key")
        .eq("event_id", ev.id)
        .eq("media_type", "image")
        .is("focal_x", null)
        .order("id", { ascending: true })
        .range(0, 499); // focal_x fills as we go, so page 0 shrinks each pass
      if (!rows?.length) break;
      // scanCap 0: stored faces only — never call Modal from this sweep.
      const n = await ensureAutoFocal(supabase, rows, { scanCap: 0 });
      written += n;
      if (n === 0) break; // remainder has no confident faces — done here
      if (page > 100) break; // safety
    }
    if (written > 0) console.log(`"${ev.name}": +${written} focal points`);
    total += written;
  }
  console.log(`\ndone: ${total} focal points written`);
}

main().catch((err) => {
  console.error("FAILED:", err.message ?? err);
  process.exit(1);
});
