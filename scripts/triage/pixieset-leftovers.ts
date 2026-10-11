/**
 * Scratch (read-only): which Pixieset collections the migration left behind
 * (ledger state failed/queued) already exist in the archive under the same name?
 *
 *   npx tsx scripts/triage/pixieset-leftovers.ts
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

async function main() {
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const supabase = createServiceClient();
  const q = JSON.parse(fs.readFileSync("scripts/pixieset/data/queue.json", "utf8"));
  const left = Object.values(q.collections as Record<string, any>).filter(
    (c) => c.state === "failed" || c.state === "queued",
  );

  const events: { id: string; name: string }[] = [];
  const PAGE = 500;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("events")
      .select("id,name")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    events.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  const byName = new Map<string, { id: string; name: string }[]>();
  for (const e of events) {
    const k = norm(e.name ?? "");
    byName.set(k, [...(byName.get(k) ?? []), e]);
  }

  let matched = 0, matchedPhotos = 0, unmatchedPhotos = 0;
  const rows: string[] = [];
  for (const c of left) {
    const hits = byName.get(norm(c.name)) ?? [];
    let count = "";
    if (hits.length) {
      const { count: n } = await supabase
        .from("images")
        .select("id", { count: "exact", head: true })
        .eq("event_id", hits[0].id);
      count = `archive has "${hits[0].name}" with ${n ?? "?"} images${hits.length > 1 ? ` (+${hits.length - 1} more same-name)` : ""}`;
      matched++; matchedPhotos += c.photoCount ?? 0;
    } else unmatchedPhotos += c.photoCount ?? 0;
    const why = String(c.error ?? "").includes("password") ? "pw-refused"
      : String(c.error ?? "").includes("deleted") ? "deleted"
      : String(c.error ?? "").includes("Web Size") ? "web-size" : c.state;
    rows.push(`${why.padEnd(10)} ${String(c.year).padEnd(5)} ${String(c.photoCount ?? 0).padStart(6)}  ${c.name.slice(0, 48).padEnd(48)} ${count}`);
  }
  rows.sort();
  console.log(rows.join("\n"));
  console.log(`\nevents in archive: ${events.length}`);
  console.log(`leftovers: ${left.length}, already in archive by name: ${matched} (${matchedPhotos} photos), not in archive: ${left.length - matched} (${unmatchedPhotos} photos)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
