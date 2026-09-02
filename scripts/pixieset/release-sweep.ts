/**
 * Release staged Pixieset archives whose photos are provably in Pixeltrunk.
 *
 * WHY THIS EXISTS. On 2026-09-02 the mini's startup disk hit 0 bytes free and
 * took the whole machine down with it: no shell, no Bash tool, no way in except
 * ssh over Tailscale. 106 GB of archives for 19 collections were sitting in
 * `verified/` while the queue said every one of them was `ingested`.
 *
 * The cause is an ordering bug in pixieset-ingest.ts:
 *
 *     if (!failed) {
 *       await markIngested(...)          // <- irreversible, commits FIRST
 *       const release = await verifyLanded(...)   // <- network call, can throw
 *       ... unlink the zips
 *     }
 *
 * If `verifyLanded` throws — and it queries the same database that was timing
 * out under HNSW write load — the collection is already `ingested`, so `--next`
 * skips it forever and nothing ever revisits its archive. Every such crash
 * leaks one collection's bytes, permanently, and silently.
 *
 * This sweep is the backstop: it re-derives the truth from the DATABASE for any
 * collection that still has bytes on disk, and releases only what it can prove.
 * Fixing the ordering stops new leaks; this cleans up the ones already made and
 * any future crash between the two steps.
 *
 *   npx tsx scripts/pixieset/release-sweep.ts            # report only
 *   npx tsx scripts/pixieset/release-sweep.ts --apply    # actually release
 *
 * Exits non-zero if anything was kept, so a caller can tell "nothing to do"
 * apart from "something needs a human".
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const STAGING = process.env.PIXIESET_STAGING || path.join(os.homedir(), "pixieset-staging");
const VERIFIED = path.join(STAGING, "verified");
const QUEUE = path.join("scripts", "pixieset", "data", "queue.json");

interface Col { id: string; slug: string; state: string; eventId?: string | null }

function main() {
  if (!fs.existsSync(VERIFIED)) { console.log("no verified/ directory — nothing staged."); return; }
  const queue = JSON.parse(fs.readFileSync(QUEUE, "utf8")) as { collections: Record<string, Col> };
  const bySlug = new Map<string, Col>();
  for (const c of Object.values(queue.collections)) bySlug.set(c.slug, c);

  const zipsBySlug = new Map<string, string[]>();
  for (const f of fs.readdirSync(VERIFIED)) {
    if (!f.includes("-photo-download-")) continue;
    const slug = f.split("-photo-download-")[0];
    zipsBySlug.set(slug, [...(zipsBySlug.get(slug) ?? []), path.join(VERIFIED, f)]);
  }
  if (!zipsBySlug.size) { console.log("verified/ holds no archives — nothing to release."); return; }

  let freed = 0, kept = 0, kb = 0;
  for (const [slug, zips] of zipsBySlug) {
    const bytes = zips.reduce((n, z) => n + fs.statSync(z).size, 0);
    const gb = (bytes / 1073741824).toFixed(1);
    const col = bySlug.get(slug);

    // `verified` means the ingest has not run yet — those bytes are still needed.
    // Only a collection the queue believes is DONE can be a leak.
    if (!col || col.state !== "ingested" || !col.eventId) {
      console.log(`  skip     ${slug} (${gb} GB) — state=${col?.state ?? "not in queue"}`);
      continue;
    }
    let ok = false, summary = "";
    try {
      summary = execFileSync("npx", ["tsx", "scripts/triage/px-filecheck.ts", col.eventId, ...zips],
        { encoding: "utf8", maxBuffer: 1 << 28 }).trim().split("\n")[0];
      ok = true;
    } catch (err) {
      const e = err as { stdout?: string };
      summary = (e.stdout ?? String(err)).trim().split("\n")[0];
    }
    if (!ok) { console.log(`  KEPT     ${slug} (${gb} GB) — ${summary}`); kept++; kb += bytes; continue; }
    if (APPLY) for (const z of zips) fs.unlinkSync(z);
    console.log(`  ${APPLY ? "released" : "would release"} ${slug} (${gb} GB) — ${summary}`);
    freed += bytes;
  }
  console.log(
    `\n${APPLY ? "released" : "releasable"}: ${(freed / 1073741824).toFixed(1)} GB` +
    `  |  kept for review: ${kept} collection(s), ${(kb / 1073741824).toFixed(1)} GB`
  );
  if (kept) {
    console.log("a KEPT collection means the archive holds files the event does not — do NOT delete it by hand.");
    process.exit(1);
  }
}
main();
