/**
 * Prove, filename by filename, that a staged Pixieset ZIP is fully represented in a
 * Pixeltrunk event — before the ZIP is deleted.
 *
 * `verifyLanded()` asks "does the event hold at least N images?", which is the right
 * gate for the ingest but is satisfied trivially when an event holds images from more
 * than one source. This asks the stricter question the delete actually depends on:
 * is EVERY file in this archive present in that event?
 *
 *   npx tsx scripts/triage/px-filecheck.ts <eventId> <zip> [<zip> ...]
 *
 * Exits non-zero if anything is missing, so it can gate a delete.
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const eventId = process.argv[2];
  const zips = process.argv.slice(3);
  if (!eventId || !zips.length) {
    console.error("usage: px-filecheck.ts <eventId> <zip> [<zip> ...]");
    process.exit(2);
  }

  const inZip = new Set<string>();
  for (const z of zips) {
    // NEVER `unzip -Z1` here. Info-ZIP renders any byte it cannot print as `?`,
    // so `NaniNa\u2019ope_….jpg` comes back as `NaniNa???ope_….jpg` and can never match
    // the real UTF-8 name in the database. That is not a missing photo, it is a
    // mangled listing — and because this check gates a DELETE, it failed closed
    // and stranded 39 GB across 4 collections (2026-09-02). `bsdtar -tf` is no
    // better: it octal-escapes the same bytes. Python's zipfile decodes filenames
    // per the ZIP spec (honouring the UTF-8 flag), which is the only listing that
    // round-trips. Same family as the `[R]` glob bug: a `?` in a zip listing
    // stands in for bytes, it is not a character.
    const out = execFileSync(
      "python3",
      ["-c", "import sys,zipfile\nfor n in zipfile.ZipFile(sys.argv[1]).namelist(): sys.stdout.write(n+chr(10))", z],
      { encoding: "utf8", maxBuffer: 1 << 28 }
    );
    for (const l of out.split("\n")) {
      const name = (l.trim().split("/").pop() || "").trim();
      if (/\.(jpe?g|png|heic|webp|tiff?)$/i.test(name)) inZip.add(name.toLowerCase());
    }
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const have = new Set<string>();
  // PostgREST truncates at 1,000 rows, so page explicitly rather than trusting one select.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("images")
      .select("id, original_filename")
      .eq("event_id", eventId)
      // ORDER BY on a unique column is mandatory for any paged read (lesson 88):
      // .range() is OFFSET/LIMIT and Postgres defines no row order without it, so
      // concurrent scans can skip rows. A skipped row here reads as a MISSING
      // photo — in the one check that gates deleting the only other copy.
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    // `filename` is the R2 storage key (a UUID). The name that came off the camera —
    // and the only thing comparable to a ZIP entry — is `original_filename`.
    for (const r of data) if (r.original_filename) have.add(String(r.original_filename).toLowerCase());
    if (data.length < 1000) break;
  }

  const missing = [...inZip].filter((f) => !have.has(f));
  console.log(`zip files: ${inZip.size}  |  event filenames: ${have.size}  |  MISSING: ${missing.length}`);
  if (missing.length) {
    console.log("first missing:", missing.slice(0, 10).join(", "));
    process.exit(1);
  }
  console.log("every file in the archive is present in the event — safe to release.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
