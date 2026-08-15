/**
 * Prove a Pixieset collection is fully in Pixeltrunk before its staged ZIPs are released.
 *
 * The staging archives are the ONLY other copy of a pre-2024 collection — Pixieset is
 * the original and it is being cancelled. So "the queue says ingested" is not enough to
 * delete bytes on: the queue records what the ingest INTENDED, and this asks the archive
 * what it actually holds.
 *
 * Reuses `verifyLanded()` from the ingest rather than re-deriving the predicate, so the
 * release rule here cannot drift from the release rule there.
 *
 *   npx tsx scripts/triage/verify-pixieset-landed.ts <slug> [<slug> ...]
 *
 * Exits non-zero if ANY collection fails, so it can gate a delete in a shell `if`.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { verifyLanded } from "../pixieset-ingest";

const QUEUE = path.join(__dirname, "..", "pixieset", "data", "queue.json");

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing ${name} — run with the repo's .env.local loaded`);
  return v;
}

async function main() {
  const slugs = process.argv.slice(2);
  if (!slugs.length) {
    console.error("usage: verify-pixieset-landed.ts <slug> [<slug> ...]");
    process.exit(2);
  }

  const supabase = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  const queue = JSON.parse(fs.readFileSync(QUEUE, "utf8")) as {
    collections: Record<string, { slug: string; state: string; files: number | null; eventId?: string | null }>;
  };

  let failed = 0;
  for (const slug of slugs) {
    const row = Object.values(queue.collections).find((r) => r.slug === slug);
    if (!row) {
      console.log(`✗ ${slug} — not in the queue at all`);
      failed++;
      continue;
    }
    if (row.state !== "ingested" || !row.eventId) {
      console.log(`✗ ${slug} — state=${row.state} eventId=${row.eventId ?? "none"} (never ingested)`);
      failed++;
      continue;
    }
    const expected = row.files ?? 0;
    const res = await verifyLanded(supabase, row.eventId, expected);
    console.log(`${res.ok ? "✓" : "✗"} ${slug} — ${res.detail}`);
    if (!res.ok) failed++;
  }

  if (failed) {
    console.log(`\n${failed} collection(s) NOT safe to release.`);
    process.exit(1);
  }
  console.log("\nall verified in Pixeltrunk — staged archives are safe to release.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
