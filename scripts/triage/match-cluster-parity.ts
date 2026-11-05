/**
 * Does match_person_cluster still give the answers an exact search would?
 * READ-ONLY.
 *
 * Since migration 099 the function shortlists reference faces by a 1-bit
 * fingerprint (`centroid_bits`) and re-ranks only the shortlist on the real
 * vectors. This compares it against the exact full-precision search it
 * replaced, written inline below, on a sample of clusters: mostly ones that
 * once earned a guest suggestion (where decisions happen), plus random unnamed
 * clusters.
 *
 * The bar is EQUIVALENCE on hits that can change a decision: every hit with
 * similarity >= 0.45 (excluding the cluster itself) must be the same person,
 * with the same similarity, in the same order. Suggestions need >= 0.55 and
 * auto-confirm needs >= 0.70 with a 0.10 margin, so nothing below 0.45 can
 * change either. Below that, the order of near-strangers may differ; that is
 * reported but not a failure. Exits 1 on any mismatch.
 *
 *   npx tsx scripts/triage/match-cluster-parity.ts            # 300 + 100 clusters
 *   npx tsx scripts/triage/match-cluster-parity.ts 50         # 50 + 100
 *
 * Cost: the exact search is the slow one (~0.7 s per cluster), so 400
 * clusters take ~5 minutes, in batches of 20 per request. Uses the Management
 * API like scripts/db-sql.ts; the token stays in this process, never argv.
 */
import { execFileSync } from "node:child_process";

const PROJECT_ID = process.env.SUPABASE_PROJECT_ID || "hfusdrtrizabzzcdhnyy";
const API = `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`;
const DECISION_FLOOR = 0.45;
const BATCH = 20;
// Production asks for 3. Most sampled clusters have since been confirmed, so
// they are references themselves and their own row takes a slot; asking for 4
// on both sides keeps three real hits under comparison after self is removed.
const LIMIT = 4;

const token =
  process.env.SUPABASE_ACCESS_TOKEN ||
  execFileSync("security", ["find-generic-password", "-s", "supabase-access-token", "-w"], {
    encoding: "utf8",
  }).trim();

async function query<T>(sql: string): Promise<T[]> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(API, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    });
    const text = await res.text();
    if (res.ok) return JSON.parse(text) as T[];
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      continue;
    }
    throw new Error(`Management API ${res.status}: ${text.slice(0, 300)}`);
  }
  throw new Error("Management API: gave up after 4 attempts");
}

type Row = { pid: string; mid: string; sim: number };

const EXACT = `lateral (
  select r.person_id as mid, (1 - (r.centroid <=> cc.c))::real as sim
  from person_reference_centroids r,
       (select avg(f.embedding)::vector(512) c from faces f
        where f.person_id = p.id and f.embedding is not null
        having count(f.id) >= 1) cc
  where r.user_id = (select e.user_id from persons pp join events e on e.id = pp.event_id where pp.id = p.id)
  order by r.centroid <=> cc.c
  limit ${LIMIT}) m`;
const LIVE = `lateral (select matched_person_id as mid, similarity as sim from match_person_cluster(p.id, ${LIMIT})) m`;

function byCluster(rows: Row[]): Map<string, Row[]> {
  const out = new Map<string, Row[]>();
  for (const r of rows) {
    const list = out.get(r.pid) ?? [];
    list.push(r);
    out.set(r.pid, list);
  }
  for (const list of out.values()) list.sort((a, b) => b.sim - a.sim);
  return out;
}

const decisive = (hits: Row[], self: string) =>
  hits
    .filter((h) => h.mid !== self && h.sim >= DECISION_FLOOR)
    .map((h) => `${h.mid}:${h.sim.toFixed(4)}`)
    .join(",");

async function main() {
  const n = Number(process.argv[2] ?? 300);
  if (!Number.isInteger(n) || n <= 0) throw new Error("sample size must be a positive whole number");

  const suggested = await query<{ id: string }>(
    `select person_id id from (select distinct person_id from person_identity_suggestions where kind = 'guest') s order by random() limit ${n}`
  );
  const random = await query<{ id: string }>(
    `select id from persons where name is null and face_count >= 2 order by random() limit 100`
  );
  const ids = [...new Set([...suggested, ...random].map((r) => r.id))];

  const exact = new Map<string, Row[]>();
  const live = new Map<string, Row[]>();
  let exactMs = 0;
  let liveMs = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const arr = `array[${ids.slice(i, i + BATCH).map((x) => `'${x}'::uuid`).join(",")}]`;
    let t = Date.now();
    for (const [k, v] of byCluster(await query<Row>(`select p.id pid, m.mid, m.sim from unnest(${arr}) p(id), ${EXACT}`)))
      exact.set(k, v);
    exactMs += Date.now() - t;
    t = Date.now();
    for (const [k, v] of byCluster(await query<Row>(`select p.id pid, m.mid, m.sim from unnest(${arr}) p(id), ${LIVE}`)))
      live.set(k, v);
    liveMs += Date.now() - t;
    process.stdout.write(`${Math.min(i + BATCH, ids.length)}/${ids.length} `);
  }
  console.log();

  let relevant = 0;
  let top1Same = 0;
  const mismatches: { cluster: string; exact: string; live: string }[] = [];
  for (const id of ids) {
    const a = exact.get(id) ?? [];
    const b = live.get(id) ?? [];
    if ((a[0]?.mid ?? null) === (b[0]?.mid ?? null)) top1Same++;
    const da = decisive(a, id);
    const db = decisive(b, id);
    if (!da && !db) continue;
    relevant++;
    if (da !== db) mismatches.push({ cluster: id, exact: da, live: db });
  }

  console.log(`clusters sampled:            ${ids.length}`);
  console.log(`with a hit >= ${DECISION_FLOOR}:          ${relevant}`);
  console.log(`decision-relevant identical: ${relevant - mismatches.length} of ${relevant}`);
  console.log(`top-1 identical (any sim):   ${top1Same} of ${ids.length}  (differences below ${DECISION_FLOOR} are expected)`);
  console.log(`wall time, exact vs live:    ${exactMs} ms vs ${liveMs} ms`);
  for (const m of mismatches) console.log("MISMATCH", JSON.stringify(m));
  if (mismatches.length > 0) process.exit(1);
  // Nothing compared is not a pass: a bad sample or an owner lookup broken on
  // both sides would otherwise print "0 of 0" and exit clean.
  if (relevant === 0) {
    console.log("FAIL: no cluster had a hit >= the decision floor, so nothing was compared");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
