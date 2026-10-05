/**
 * Margin calibration for auto-confirm (2026-10-04). READ-ONLY.
 *
 * For every suggestion a human already decided, re-run the engine's match RPC
 * and record how close the nearest OTHER identity comes. That distribution is
 * what an auto-confirm margin guard has to clear: a true match whose runner-up
 * is within the margin stays in the human queue.
 *
 * Caveat: today's references INCLUDE the confirmed cluster itself, so the
 * own-identity score is inflated versus scan time. The impostor score is the
 * honest number here.
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

type Row = { id: string; person_id: string; kind: string; status: string; confidence: number; suggested_key: string; crew_id: string | null };
type Hit = { matched_person_id: string; name_key: string; similarity: number };
type CrewHit = { crew_id: string; similarity: number };

function pct(xs: number[], p: number) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
const f = (n: number) => (Number.isFinite(n) ? n.toFixed(3) : "—");

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!;
  const db = createClient(url, key, { auth: { persistSession: false } });

  const rows: Row[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await db
      .from("person_identity_suggestions")
      .select("id, person_id, kind, status, confidence, suggested_key, crew_id")
      .in("status", ["confirmed", "rejected"])
      .order("id")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  console.log(`decided rows: ${rows.length}`);

  type Out = { row: Row; own: number | null; impostor: number | null; impostorKey: string | null };
  const out: Out[] = [];
  let i = 0;
  const t0 = Date.now();
  const worker = async () => {
    for (;;) {
      const row = rows[i++];
      if (!row) return;
      if (row.kind === "crew") {
        const { data, error } = await db.rpc("match_person_cluster_to_crew", { p_person_id: row.person_id, p_limit: 5 });
        if (error) { console.error("crew rpc", row.id, error.message); continue; }
        const hits = (data ?? []) as CrewHit[];
        const own = hits.find((h) => h.crew_id === row.crew_id)?.similarity ?? null;
        const imp = hits.find((h) => h.crew_id !== row.crew_id);
        out.push({ row, own, impostor: imp?.similarity ?? null, impostorKey: imp?.crew_id ?? null });
      } else {
        const { data, error } = await db.rpc("match_person_cluster", { p_person_id: row.person_id, p_limit: 5 });
        if (error) { console.error("guest rpc", row.id, error.message); continue; }
        const hits = ((data ?? []) as Hit[]).filter((h) => h.matched_person_id !== row.person_id);
        const own = hits.find((h) => h.name_key === row.suggested_key)?.similarity ?? null;
        const imp = hits.find((h) => h.name_key !== row.suggested_key);
        out.push({ row, own, impostor: imp?.similarity ?? null, impostorKey: imp?.name_key ?? null });
      }
      if (out.length % 100 === 0) console.log(`  ${out.length}/${rows.length} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);

  for (const kind of ["guest", "crew"]) {
    const conf = out.filter((o) => o.row.kind === kind && o.row.status === "confirmed");
    const imps = conf.map((o) => o.impostor).filter((x): x is number => x != null);
    const margins = conf.filter((o) => o.own != null && o.impostor != null).map((o) => o.own! - o.impostor!);
    console.log(`== ${kind} confirmed: ${conf.length} (with an impostor hit: ${imps.length})`);
    console.log(`   nearest OTHER identity: p50 ${f(pct(imps, .5))} p90 ${f(pct(imps, .9))} p99 ${f(pct(imps, .99))} max ${f(Math.max(...imps))}`);
    console.log(`   impostor >= 0.60: ${imps.filter((x) => x >= 0.6).length}  >= 0.65: ${imps.filter((x) => x >= 0.65).length}  >= 0.70: ${imps.filter((x) => x >= 0.7).length}`);
    console.log(`   own − impostor margin: p01 ${f(pct(margins, .01))} p05 ${f(pct(margins, .05))} p10 ${f(pct(margins, .1))} p50 ${f(pct(margins, .5))}`);
    for (const m of [0.05, 0.1, 0.15, 0.2]) {
      const held = conf.filter((o) => o.row.confidence >= 0.7 && o.impostor != null && o.row.confidence - o.impostor! < m).length;
      const eligible = conf.filter((o) => o.row.confidence >= 0.7).length;
      console.log(`   margin ${m}: of ${eligible} at >=0.70 scan-time confidence, ${held} would be held for a human`);
    }
    const worst = conf.filter((o) => o.impostor != null).sort((a, b) => b.impostor! - a.impostor!).slice(0, 5);
    for (const w of worst) console.log(`   worst: conf ${f(w.row.confidence)} own-now ${f(w.own ?? NaN)} impostor ${f(w.impostor!)} (${w.impostorKey}) suggestion ${w.row.id}`);
  }
  const rej = out.filter((o) => o.row.status === "rejected");
  console.log(`== rejected: ${rej.length}`);
  for (const r of rej) console.log(`   conf-then ${f(r.row.confidence)} own-now ${f(r.own ?? NaN)} nearest-other ${f(r.impostor ?? NaN)} (${r.impostorKey})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
