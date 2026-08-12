/**
 * Prove a Pixieset collection actually landed — bytes included.
 *
 *   npx tsx scripts/verify-pixieset-ingest.ts <collectionId>
 *   npx tsx scripts/verify-pixieset-ingest.ts <collectionId> --sample 20
 *   npx tsx scripts/verify-pixieset-ingest.ts <collectionId> --all      # hash every frame
 *
 * Counts agreeing is not proof. The check that matters is the **sha256 round
 * trip**: pull a frame out of the staged ZIP, pull the object back down from R2,
 * and compare digests. That is the only test that can tell "the row says 3.4 MB"
 * apart from "the right 3.4 MB are in the bucket" — and on this project that
 * distinction has form. The SPS lossy-source claim survived for months on
 * inspection alone (see CLAUDE.md), which is why `verify-sps-pull.ts` exists and
 * why this is its counterpart.
 *
 * Reads the ZIP from ~/pixieset-staging/{verified,ingested}. Run it before
 * deleting an archive, never after.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const argv = process.argv.slice(2);
const collectionId = argv.find((a) => !a.startsWith("--") && /^\d+$/.test(a));
const ALL = argv.includes("--all");
const sampleArg = argv.indexOf("--sample");
const SAMPLE = ALL ? Infinity : sampleArg === -1 ? 8 : Number(argv[sampleArg + 1] ?? 8);

const STAGING = path.join(os.homedir(), "pixieset-staging");
const JPEG = /\.(jpe?g)$/i;

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const n = (x: number) => x.toLocaleString("en-US");

function zipsFor(slug: string): string[] {
  const out: string[] = [];
  for (const dir of [path.join(STAGING, "verified"), path.join(STAGING, "ingested")]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(`${slug}-photo-download-`) && f.endsWith(".zip")) out.push(path.join(dir, f));
    }
  }
  return out.sort();
}

async function listEntries(zipPath: string): Promise<string[]> {
  const { stdout } = await run("unzip", ["-Z1", zipPath], { maxBuffer: 256 * 1024 * 1024 });
  return stdout.split("\n").map((l) => l.trim()).filter(Boolean).filter((l) => !l.endsWith("/"));
}

async function readEntry(zipPath: string, entry: string): Promise<Buffer> {
  const { stdout } = await run("unzip", ["-p", zipPath, entry], {
    maxBuffer: 512 * 1024 * 1024,
    encoding: "buffer",
  } as never);
  return stdout as unknown as Buffer;
}

async function main() {
  if (!collectionId) {
    console.error("usage: verify-pixieset-ingest.ts <collectionId> [--sample N | --all]");
    process.exit(1);
  }

  const { createServiceClient } = await import("../src/lib/supabase/server");
  const { getObjectBuffer } = await import("../src/lib/r2/client");

  const queue = JSON.parse(fs.readFileSync(path.join("scripts", "pixieset", "data", "queue.json"), "utf8"));
  const collection = queue.collections[collectionId];
  if (!collection) {
    console.error(`collection ${collectionId} is not in the queue`);
    process.exit(1);
  }

  const supabase = createServiceClient();
  console.log(`${collection.name}  (${collectionId})\n`);

  // ── the event ──
  const { data: event, error: evErr } = await supabase
    .from("events")
    .select("id, name, event_date, slug, settings")
    .contains("settings", { pixiesetCollectionId: collectionId })
    .maybeSingle();
  if (evErr) throw evErr;
  if (!event) {
    console.error("✗ no event carries this collection id — it was never ingested.");
    process.exit(1);
  }
  console.log(`event    ${event.id}`);
  console.log(`         "${event.name}" · ${event.event_date ?? "no date"} · /${event.slug}`);

  // ── sections vs the archive's own sets ──
  const zips = zipsFor(collection.slug);
  if (!zips.length) {
    console.error(`✗ no staged ZIP for ${collection.slug} — cannot round-trip without the source.`);
    process.exit(1);
  }
  const entriesByZip: { zipPath: string; entries: string[] }[] = [];
  for (const z of zips) entriesByZip.push({ zipPath: z, entries: await listEntries(z) });

  const byBase = new Map<string, { zipPath: string; entry: string; sets: Set<string> }>();
  for (const { zipPath, entries } of entriesByZip) {
    for (const entry of entries) {
      if (!JPEG.test(entry)) continue;
      const slash = entry.indexOf("/");
      const set = slash === -1 ? "(root)" : entry.slice(0, slash);
      const base = path.basename(entry);
      const hit = byBase.get(base);
      if (hit) hit.sets.add(set);
      else byBase.set(base, { zipPath, entry, sets: new Set([set]) });
    }
  }

  const { data: sections, error: secErr } = await supabase
    .from("sections")
    .select("id, name")
    .eq("event_id", event.id);
  if (secErr) throw secErr;

  const { data: rows, error: rowErr } = await supabase
    .from("images")
    .select("id, original_filename, r2_key, file_size, processing_status, thumbnail_generated, width, height")
    .eq("event_id", event.id);
  if (rowErr) throw rowErr;

  const problems: string[] = [];

  console.log(`sections ${sections!.length}: ${sections!.map((s) => s.name).join(", ")}`);
  console.log(`archive  ${n(byBase.size)} unique JPEGs across ${new Set([...byBase.values()].flatMap((v) => [...v.sets])).size} set(s)`);
  console.log(`rows     ${n(rows!.length)}`);

  if (rows!.length !== byBase.size) {
    problems.push(`row count ${rows!.length} ≠ archive's ${byBase.size} unique photos`);
  }

  // Every archive filename must have a row, and vice versa. A count match with
  // different members would otherwise read as success.
  const rowNames = new Set(rows!.map((r) => r.original_filename));
  const missing = [...byBase.keys()].filter((b) => !rowNames.has(b));
  const extra = [...rowNames].filter((r) => !byBase.has(r));
  if (missing.length) problems.push(`${missing.length} photo(s) in the archive have no row (e.g. ${missing.slice(0, 3).join(", ")})`);
  if (extra.length) problems.push(`${extra.length} row(s) are not in the archive (e.g. ${extra.slice(0, 3).join(", ")})`);

  const incomplete = rows!.filter((r) => r.processing_status !== "complete");
  if (incomplete.length) problems.push(`${incomplete.length} row(s) not marked complete — these BLOCK the event's AI pipeline`);

  const noThumb = rows!.filter((r) => !r.thumbnail_generated).length;
  const noDims = rows!.filter((r) => !r.width || !r.height).length;
  console.log(`         ${rows!.length - incomplete.length} complete · ${rows!.length - noThumb} thumbed · ${rows!.length - noDims} sized`);

  // ── no orphans ──
  const { count: linkCount, error: linkErr } = await supabase
    .from("section_images")
    .select("image_id", { count: "exact", head: true })
    .in("section_id", sections!.map((s) => s.id));
  if (linkErr) throw linkErr;
  const expectedLinks = [...byBase.values()].reduce((a, v) => a + v.sets.size, 0);
  console.log(`links    ${n(linkCount ?? 0)} (archive implies ${n(expectedLinks)} — a photo in N sets gets N links)`);
  if ((linkCount ?? 0) !== expectedLinks) {
    problems.push(`section links ${linkCount} ≠ expected ${expectedLinks}`);
  }

  // ── the round trip ──
  const byName = new Map(rows!.map((r) => [r.original_filename, r]));
  const candidates = [...byBase.entries()].filter(([b]) => byName.has(b));
  const step = Math.max(1, Math.floor(candidates.length / Math.min(SAMPLE, candidates.length)));
  const picks: typeof candidates = [];
  for (let i = 0; i < candidates.length && picks.length < SAMPLE; i += step) picks.push(candidates[i]);

  console.log(`\nsha256 round trip on ${picks.length} frame(s):`);
  let matched = 0;
  for (const [base, plan] of picks) {
    const row = byName.get(base)!;
    try {
      const source = await readEntry(plan.zipPath, plan.entry);
      const stored = await getObjectBuffer(row.r2_key);
      const a = sha256(source);
      const b = sha256(stored);
      if (a === b) {
        matched++;
        if (picks.length <= 12) console.log(`  ✓ ${base}  ${(source.byteLength / 1048576).toFixed(2)} MB`);
      } else {
        problems.push(`${base}: R2 bytes differ from the archive (${a.slice(0, 12)} vs ${b.slice(0, 12)})`);
        console.log(`  ✗ ${base}  DIGEST MISMATCH`);
      }
      if (source.byteLength !== row.file_size) {
        problems.push(`${base}: file_size says ${row.file_size}, archive holds ${source.byteLength}`);
      }
    } catch (err) {
      problems.push(`${base}: round trip failed — ${err instanceof Error ? err.message : String(err)}`);
      console.log(`  ✗ ${base}  ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`  ${matched}/${picks.length} byte-identical`);

  console.log("");
  if (problems.length) {
    console.log(`✗ ${problems.length} problem(s):`);
    for (const p of problems) console.log(`   ${p}`);
    process.exit(1);
  }
  console.log("✓ verified — every photo has a row, every row has its bytes, and the bytes match the archive.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
