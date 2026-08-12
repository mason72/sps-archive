/**
 * Before/after harness for the search change.
 *
 * Captures what the CURRENT search functions return for a set of real queries
 * on real galleries, so the same queries can be replayed after the functions
 * change and the two answers compared. The point is to catch a quality drop
 * BEFORE it reaches a guest — selfie search is the one a client touches
 * directly, and a quiet degradation there is both hard to spot and
 * embarrassing.
 *
 *   npx tsx scripts/triage/search-ab.ts capture   # writes the baseline
 *   npx tsx scripts/triage/search-ab.ts compare   # replays and diffs
 *
 * Baseline lands in tasks/search-ab-baseline.json.
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const OUT = "tasks/search-ab-baseline.json";
const USER = "d5b2e276-d33d-49b3-ba09-59164c622b21";

type Case = { label: string; rpc: string; args: Record<string, unknown> };

async function buildCases(s: {
  from: (t: string) => {
    select: (c: string) => {
      eq: (
        k: string,
        v: unknown
      ) => { limit: (n: number) => Promise<{ data: unknown }> } & {
        not: (
          k: string,
          o: string,
          v: unknown
        ) => { limit: (n: number) => Promise<{ data: unknown }> };
      };
      not: (
        k: string,
        o: string,
        v: unknown
      ) => { limit: (n: number) => Promise<{ data: unknown }> };
    };
  };
}): Promise<Case[]> {
  const cases: Case[] = [];

  // Real photo vectors as queries — the same shape a semantic search sends.
  const { data: imgs } = (await s
    .from("images")
    .select("id, event_id, siglip_embedding")
    .not("siglip_embedding", "is", null)
    .limit(12)) as { data: Array<{ id: string; event_id: string; siglip_embedding: unknown }> };

  for (const img of imgs ?? []) {
    const vec =
      typeof img.siglip_embedding === "string"
        ? JSON.parse(img.siglip_embedding)
        : img.siglip_embedding;
    cases.push({
      label: `archive-wide from ${img.id.slice(0, 8)}`,
      rpc: "search_images_by_embedding",
      args: { query_embedding: vec, target_user_id: USER, match_count: 30 },
    });
    cases.push({
      label: `event-scoped from ${img.id.slice(0, 8)}`,
      rpc: "search_images_by_embedding",
      args: {
        query_embedding: vec,
        target_user_id: USER,
        target_event_id: img.event_id,
        match_count: 30,
      },
    });
    cases.push({
      label: `scored (planner) ${img.id.slice(0, 8)}`,
      rpc: "score_images_by_embedding",
      args: { query_embedding: vec, target_user_id: USER, target_event_id: img.event_id },
    });
  }

  // Selfie search — the guest-facing one, so it gets its own cases.
  const { data: faces } = (await s
    .from("faces")
    .select("id, image_id, embedding")
    .not("embedding", "is", null)
    .limit(8)) as { data: Array<{ id: string; embedding: unknown }> };

  for (const f of faces ?? []) {
    const vec = typeof f.embedding === "string" ? JSON.parse(f.embedding) : f.embedding;
    cases.push({
      label: `selfie from face ${f.id.slice(0, 8)}`,
      rpc: "search_faces_by_embedding",
      args: { query_embedding: vec, target_user_id: USER, match_count: 100 },
    });
  }

  return cases;
}

/** Ordered ids, so BOTH membership and rank can be compared. */
function idsOf(rows: unknown): string[] {
  return ((rows ?? []) as Array<Record<string, string>>).map(
    (r) => r.id ?? r.image_id ?? r.face_id
  );
}

async function main() {
  const mode = process.argv[2] ?? "capture";
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const cases = await buildCases(s as never);
  const results: Record<string, { ids: string[]; ms: number }> = {};

  for (const c of cases) {
    const t0 = Date.now();
    const { data, error } = await s.rpc(c.rpc, c.args as never);
    if (error) throw new Error(`${c.label}: ${error.message}`);
    results[c.label] = { ids: idsOf(data), ms: Date.now() - t0 };
  }

  if (mode === "capture") {
    fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
    const n = Object.values(results).reduce((a, r) => a + r.ids.length, 0);
    const ms = Object.values(results).reduce((a, r) => a + r.ms, 0);
    console.log(`captured ${cases.length} case(s), ${n} result rows, ${ms}ms total → ${OUT}`);
    return;
  }

  const before = JSON.parse(fs.readFileSync(OUT, "utf8")) as typeof results;
  let identical = 0;
  let changed = 0;
  let totalOverlap = 0;
  let worst = { label: "", overlap: 1 };
  let msBefore = 0;
  let msAfter = 0;

  for (const [label, after] of Object.entries(results)) {
    const b = before[label];
    if (!b) {
      console.log(`NEW CASE (no baseline): ${label}`);
      continue;
    }
    msBefore += b.ms;
    msAfter += after.ms;
    const bSet = new Set(b.ids);
    const hits = after.ids.filter((id) => bSet.has(id)).length;
    const overlap = b.ids.length === 0 ? 1 : hits / b.ids.length;
    totalOverlap += overlap;
    if (overlap < worst.overlap) worst = { label, overlap };
    if (b.ids.join() === after.ids.join()) identical++;
    else {
      changed++;
      if (overlap < 0.9)
        console.log(
          `  ${(overlap * 100).toFixed(1)}%  ${label}  (${b.ids.length} → ${after.ids.length} rows)`
        );
    }
  }

  const n = Object.keys(results).length;
  console.log(`\n${n} case(s): ${identical} byte-identical, ${changed} reordered or changed`);
  console.log(`mean overlap ${((totalOverlap / n) * 100).toFixed(2)}%`);
  console.log(`worst: ${(worst.overlap * 100).toFixed(1)}% — ${worst.label}`);
  console.log(`time: ${msBefore}ms before → ${msAfter}ms after`);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
