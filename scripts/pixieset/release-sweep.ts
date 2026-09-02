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
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const STAGING = process.env.PIXIESET_STAGING || path.join(os.homedir(), "pixieset-staging");
const VERIFIED = path.join(STAGING, "verified");
const QUEUE = path.join("scripts", "pixieset", "data", "queue.json");

interface Col { id: string; slug: string; state: string; eventId?: string | null }

/**
 * Reclaim Chrome's duplicate downloads.
 *
 * When a download lands on a name that already exists, Chrome writes
 * `NAME (1).zip` instead of overwriting. The watcher requires the exact shape
 * `{slug}-photo-download-NofM.zip`, so a ` (1)` copy can NEVER be swept into the
 * pipeline — it is dead weight that accumulates silently and forever. On
 * 2026-09-02, six of them for one collection held **19.9 GB**, all byte-identical
 * to originals sitting beside them, while the disk was at zero.
 *
 * Deletes only when the original exists AND the sizes match AND the content
 * matches (full hash under 400 MB, size + first 64 MB above it — these are
 * multi-GB parts and a full read of each would cost more than it saves). Sizes
 * alone would be a count-based guard, and a count-based guard is not a presence
 * guard.
 */
function reclaimDuplicateDownloads(apply: boolean): number {
  const dl = path.join(os.homedir(), "Downloads");
  if (!fs.existsSync(dl)) return 0;
  let freed = 0;
  for (const f of fs.readdirSync(dl).sort()) {
    const m = f.match(/^(.*) \(\d+\)(\.[A-Za-z0-9]+)$/);
    if (!m) continue;
    const orig = path.join(dl, m[1] + m[2]);
    const dup = path.join(dl, f);
    if (!fs.existsSync(orig)) continue;
    const a = fs.statSync(dup).size, b = fs.statSync(orig).size;
    if (a !== b) { console.log(`  skip     ${f} — same name, DIFFERENT size; not a duplicate`); continue; }
    const limit = a < 400_000_000 ? Infinity : (1 << 26);
    if (sha(dup, limit) !== sha(orig, limit)) { console.log(`  skip     ${f} — same size, different content`); continue; }
    if (apply) fs.unlinkSync(dup);
    console.log(`  ${apply ? "reclaimed" : "would reclaim"} ${f} (${(a / 1073741824).toFixed(1)} GB duplicate)`);
    freed += a;
  }
  return freed;
}

function sha(p: string, limit: number): string {
  const h = crypto.createHash("sha256");
  const fd = fs.openSync(p, "r");
  try {
    const buf = Buffer.alloc(1 << 20);
    let read = 0, n = 0;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      h.update(buf.subarray(0, n));
      read += n;
      if (read >= limit) break;
    }
  } finally { fs.closeSync(fd); }
  return h.digest("hex");
}

function main() {
  const dupFreed = reclaimDuplicateDownloads(APPLY);
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
    `\n${APPLY ? "released" : "releasable"}: ${((freed + dupFreed) / 1073741824).toFixed(1)} GB` +
    (dupFreed ? ` (incl. ${(dupFreed / 1073741824).toFixed(1)} GB duplicate downloads)` : "") +
    `  |  kept for review: ${kept} collection(s), ${(kb / 1073741824).toFixed(1)} GB`
  );
  if (kept) {
    console.log("a KEPT collection means the archive holds files the event does not — do NOT delete it by hand.");
    process.exit(1);
  }
}
main();
