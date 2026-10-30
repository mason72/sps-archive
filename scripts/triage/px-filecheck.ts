/**
 * Prove, filename by filename, that a staged Pixieset ZIP is fully represented in a
 * Pixeltrunk event — before the ZIP is deleted.
 *
 * `verifyLanded()` asks "does the event hold at least N images?", which is the right
 * gate for the ingest but is satisfied trivially when an event holds images from more
 * than one source. This asks the stricter question the delete actually depends on:
 * is EVERY file in this archive present in that event?
 *
 *   npx tsx scripts/triage/px-filecheck.ts [--allow-absent <json>] <eventId> <zip> [<zip> ...]
 *
 * `--allow-absent` names "filename|size" entries the event need not hold: the
 * ingest passes the frames its twin check left in the event that already had
 * them. The release sweep passes nothing.
 *
 * Exits non-zero if anything is missing, so it can gate a delete.
 *
 * A file is (name, size), not the name alone (2026-10-29). Pixieset gives a photo's
 * BW and Color renditions, and two cameras' `IMG_1234`, the same name in different
 * sets; by name alone a rendition ZIP read as "fully present" while every version
 * but one was missing, and this check would have released the only other copy.
 * Rows record the entry's uncompressed size in `file_size`. A row with no size
 * still vouches for its name, but only where the archive holds one size of it.
 *
 * One exception, proved by reading rather than allowed by list: a file whose image
 * data is identical to a version that HAS its row differs only in metadata, and the
 * ingest folded the two into one photo (plan-entries.ts `mergeSameImage`).
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { JPEG, jpegImageHash } from "../pixieset/plan-entries";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

/**
 * One comparison key for both sides: Unicode-normalized, then lowercased.
 *
 * `ö` can be ONE code point (U+00F6, NFC) or TWO (`o` + combining U+0308, NFD).
 * They render identically and compare unequal. Pixieset's ZIPs carry either form,
 * sometimes both in one archive, while the database holds NFC — so a raw compare
 * reported 8 frames of `kinexionslasvegas` MISSING that were sitting in the event,
 * and this check gates a delete, so it failed closed and pinned 11.6 GB. Part of
 * the 2026-09-11 deadlock: 45 GB pinned here, the downloader waiting for disk that
 * only this release could free.
 *
 * Normalizing is not loosening. Two strings that NFC-normalize equal are the
 * same name by definition; nothing that is genuinely absent can match.
 */
const key = (name: string) => name.normalize("NFC").toLowerCase();

async function main() {
  const args = process.argv.slice(2);
  const allowAt = args.indexOf("--allow-absent");
  const allowed = new Set<string>();
  if (allowAt !== -1) {
    for (const k of JSON.parse(fs.readFileSync(args[allowAt + 1], "utf8")) as string[]) {
      const cut = k.lastIndexOf("|");
      allowed.add(`${key(k.slice(0, cut))}|${k.slice(cut + 1)}`);
    }
    args.splice(allowAt, 2);
  }
  const eventId = args[0];
  const zips = args.slice(1);
  if (!eventId || !zips.length) {
    console.error("usage: px-filecheck.ts <eventId> <zip> [<zip> ...]");
    process.exit(2);
  }

  /** name key → the distinct sizes the archive holds under it. */
  const inZip = new Map<string, Set<number>>();
  /** "name key|size" → where to read that file, for the identical-image proof. */
  const locate = new Map<string, { zip: string; entry: string }>();
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
      ["-c", "import sys,json,zipfile\nfor i in zipfile.ZipFile(sys.argv[1]).infolist(): sys.stdout.write(json.dumps([i.filename,i.file_size])+chr(10))", z],
      { encoding: "utf8", maxBuffer: 1 << 28 }
    );
    for (const l of out.split("\n")) {
      if (!l.trim()) continue;
      const [full, size] = JSON.parse(l) as [string, number];
      const name = (full.trim().split("/").pop() || "").trim();
      // The ingest imports JPEGs only (plan-entries.ts JPEG); anything else in
      // the archive was never going to have a row, so it cannot pin the ZIP.
      if (!JPEG.test(name)) continue;
      const k = key(name);
      inZip.set(k, (inZip.get(k) ?? new Set()).add(size));
      if (!locate.has(`${k}|${size}`)) locate.set(`${k}|${size}`, { zip: z, entry: full });
    }
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const have = new Set<string>();
  const sizeless = new Set<string>();
  // PostgREST truncates at 1,000 rows, so page explicitly rather than trusting one select.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("images")
      .select("id, original_filename, file_size")
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
    for (const r of data) {
      if (!r.original_filename) continue;
      const k = key(String(r.original_filename));
      if (r.file_size == null) sizeless.add(k);
      else have.add(`${k}|${r.file_size}`);
    }
    if (data.length < 1000) break;
  }

  const readEntry = (at: { zip: string; entry: string }) =>
    execFileSync("python3", ["-I", "-c", "import sys,zipfile\nsys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))", at.zip, at.entry], { maxBuffer: 1 << 30 });

  const missing: string[] = [];
  let files = 0;
  let folded = 0;
  for (const [name, sizes] of inZip) {
    for (const size of sizes) {
      files++;
      if (have.has(`${name}|${size}`) || allowed.has(`${name}|${size}`)) continue;
      if (sizes.size === 1 && sizeless.has(name)) continue;
      const stored = [...sizes].filter((other) => other !== size && have.has(`${name}|${other}`));
      if (stored.length) {
        const mine = jpegImageHash(readEntry(locate.get(`${name}|${size}`)!));
        if (stored.some((other) => jpegImageHash(readEntry(locate.get(`${name}|${other}`)!)) === mine)) {
          folded++;
          continue;
        }
      }
      missing.push(sizes.size > 1 ? `${name} (${size} bytes)` : name);
    }
  }
  console.log(`zip files: ${files}  |  event files: ${have.size + sizeless.size}  |  MISSING: ${missing.length}${folded ? `  |  same image as a stored version: ${folded}` : ""}`);
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
