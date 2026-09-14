/**
 * Before shipping anything that moves /people identity keys: is a human
 * decision stored against either side of a move? Read-only.
 *
 * Input is a JSON array of `{ from, to, n }` (what
 * `scripts/backfill-camel-split-names.ts --keys` writes). Every table that
 * holds an identity decision keyed by name is checked for both keys:
 * exclusions ("Not a person"), aliases (both sides), split links and
 * dismissals, rejected names on clusters, reference centroids, and identity
 * suggestions. Lesson 143 did this by hand; lesson 147 made it a script.
 *
 *   npx tsx scripts/triage/moved-keys-check.ts <pairs.json>
 *
 * A hit is not automatically a blocker: a move ONTO a key with a reference
 * centroid is usually the fix healing (lesson 143). A move AWAY from an
 * exclusion, alias or split link detaches a human's decision and must be
 * handled before the move ships. ⚠️ .env.local points at PRODUCTION.
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { normalizeNameKey } from "@/lib/people/index-people";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Environment may already be populated.
}

type Pair = { from: string; to: string; n: number };

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("usage: moved-keys-check.ts <pairs.json>");
  const pairs = JSON.parse(fs.readFileSync(file, "utf8")) as Pair[];
  const keys = [...new Set(pairs.flatMap((p) => [p.from, p.to]))].filter(Boolean);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const hits = new Map<string, string[]>();
  const note = (k: string, what: string) => hits.set(k, [...(hits.get(k) ?? []), what]);

  const checks: [string, string, string][] = [
    ["excluded_people", "person_key", "EXCLUDED"],
    ["person_aliases", "alias_key", "ALIAS(alias side)"],
    ["person_aliases", "canonical_key", "ALIAS(canonical side)"],
    ["person_split_links", "name_key", "SPLIT LINK"],
    ["person_split_dismissals", "name_key", "SPLIT DISMISSAL"],
    ["person_reference_centroids", "name_key", "reference centroid"],
    ["person_identity_suggestions", "suggested_key", "suggestion"],
  ];
  for (const [table, col, label] of checks) {
    for (let i = 0; i < keys.length; i += 100) {
      const { data, error } = await db.from(table).select(col).in(col, keys.slice(i, i + 100)).limit(1000);
      if (error) throw new Error(`${table}.${col}: ${error.message}`);
      if ((data ?? []).length === 1000) throw new Error(`${table}.${col}: hit the 1,000-row cap, result untrustworthy`);
      for (const r of (data ?? []) as unknown as Record<string, string>[]) note(r[col], label);
    }
  }

  // Rejected names are stored as NAMES on each cluster, so fold them to keys.
  const wanted = new Set(keys);
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("persons")
      .select("id, rejected_names")
      .not("rejected_names", "is", null)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`persons.rejected_names: ${error.message}`);
    for (const r of data ?? []) {
      for (const n of (r.rejected_names as string[] | null) ?? []) {
        const k = normalizeNameKey(n);
        if (wanted.has(k)) note(k, "REJECTED NAME");
      }
    }
    if (!data || data.length < 1000) break;
  }

  const summarize = (k: string) => {
    const h = hits.get(k);
    if (!h) return "—";
    const counts = new Map<string, number>();
    for (const x of h) counts.set(x, (counts.get(x) ?? 0) + 1);
    return [...counts].map(([x, n]) => (n > 1 ? `${x}×${n}` : x)).join(", ");
  };
  let blocking = 0;
  for (const p of [...pairs].sort((a, b) => b.n - a.n)) {
    const fromHits = hits.get(p.from) ?? [];
    const detaches = fromHits.filter((x) => /EXCLUDED|ALIAS|SPLIT|REJECTED/.test(x));
    if (detaches.length) blocking += 1;
    console.log(
      `${detaches.length ? "⚠️ " : "   "}${String(p.n).padStart(4)}  ${p.from} → ${p.to}\n` +
        `          from: ${summarize(p.from)}\n          to:   ${summarize(p.to)}`
    );
  }
  console.log(`\n${pairs.length} pairs · ${blocking} would detach a human decision stored on the old key`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
