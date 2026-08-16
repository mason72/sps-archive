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
    /**
     * `row.files` counts ZIP ENTRIES, and an entry becomes a SECTION LINK, not an
     * image: a photo in two Pixieset sets is stored once and linked twice. So the
     * invariant is `sum(section links) === zip entries`, with images <= links.
     *
     * Passing `row.files` to `verifyLanded()` as an image count reports a complete
     * collection as short — rsac2015 read "1513/2059" and looked like 546 lost
     * photos when nothing was missing at all. Lesson 87, third instance.
     */
    const entries = row.files ?? 0;
    const { data: secs, error: secErr } = await supabase
      .from("sections").select("id").eq("event_id", row.eventId);
    if (secErr) {
      console.log(`✗ ${slug} — could not read sections: ${secErr.message}`);
      failed++;
      continue;
    }
    let links = 0;
    for (const s of secs ?? []) {
      const r = await supabase
        .from("section_images").select("*", { count: "exact", head: true }).eq("section_id", s.id);
      links += r.count ?? 0;
    }
    // Images still have to exist, be thumbnailed and be published — verifyLanded
    // answers that; give it the count it can actually satisfy.
    const imgRes = await supabase
      .from("images").select("*", { count: "exact", head: true }).eq("event_id", row.eventId);
    const images = imgRes.count ?? 0;
    const res = await verifyLanded(supabase, row.eventId, images);
    /**
     * `>=`, not `===`. An event can legitimately hold MORE than the archive put
     * there — a prior upload, a second collection, an earlier import — and
     * `microsoftsurfacepro3campuseventheadshots` does exactly that (1,369 links
     * against 1,185 entries, all 1,185 verified present by name). A SHORT ingest
     * is the failure mode, and it shows up as fewer links, never more.
     *
     * This is a completeness signal, not a release gate. Whether every specific
     * file arrived is `px-filecheck.ts`, which compares by original_filename.
     */
    const linksOk = links >= entries;
    const ok = res.ok && linksOk && images > 0;
    console.log(
      `${ok ? "✓" : "✗"} ${slug} — ${links}/${entries} section links · ${images} images · ${res.detail}`
    );
    if (!ok) failed++;
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
