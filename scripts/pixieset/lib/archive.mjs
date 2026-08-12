/**
 * Archive verification for downloaded Pixieset ZIPs.
 *
 * "The file is on disk" is not evidence. Three things can go wrong quietly and
 * each is checked here:
 *
 *  1. **A truncated or corrupt ZIP.** `unzip -t` runs CRC over every entry, so a
 *     half-downloaded archive fails loudly instead of extracting 80% of a
 *     gallery. This is the check that makes "downloaded" mean something.
 *
 *  2. **A missing part.** Pixieset splits big galleries as `-NofM`. Part 2 of 3
 *     never arriving looks exactly like success — two valid ZIPs, no error. The
 *     part set must be provably complete before a collection is verified.
 *
 *  3. **A plausible-looking photo count.** `photoCount` DOUBLE-COUNTS (a photo in
 *     two sets is two records sharing one filename), so it is an upper bound. We
 *     assert `files <= photoCount` and flag an implausibly low ratio for review
 *     rather than asserting an equality that would fail on healthy galleries.
 *
 * Sets become top-level folders in the archive (`All_Photos/…`), which is what
 * maps onto Pixeltrunk sections downstream.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import { basename } from "node:path";

const run = promisify(execFile);

/** Anything below this share of the (double-counted) photoCount gets a human look. */
export const SUSPICIOUS_RATIO = 0.4;

const JPEG = /\.(jpe?g)$/i;

/**
 * Parse Pixieset's `-NofM` multi-part suffix.
 *
 * Measured on a real single-part download (`-1of1`); the multi-part shape is
 * inferred from that, so the matcher stays deliberately loose — it accepts the
 * suffix anywhere before `.zip` rather than pinning a full filename template we
 * have not actually observed.
 */
export function parseParts(filename) {
  const m = basename(filename).match(/-(\d+)of(\d+)\.zip$/i);
  if (!m) return { part: 1, of: 1, stem: basename(filename).replace(/\.zip$/i, ""), explicit: false };
  return {
    part: Number(m[1]),
    of: Number(m[2]),
    stem: basename(filename).slice(0, m.index),
    explicit: true,
  };
}

/** True only when every part 1..of is present exactly once. */
export function partsComplete(filenames) {
  const parsed = filenames.map(parseParts);
  const of = parsed[0]?.of ?? 0;
  if (!parsed.length) return { complete: false, of: 0, have: [], missing: [] };
  if (parsed.some((p) => p.of !== of)) {
    return { complete: false, of, have: parsed.map((p) => p.part), missing: [], conflict: true };
  }
  const have = new Set(parsed.map((p) => p.part));
  const missing = Array.from({ length: of }, (_, i) => i + 1).filter((i) => !have.has(i));
  return { complete: missing.length === 0 && have.size === of, of, have: [...have].sort((a, b) => a - b), missing };
}

/** CRC-check every entry. Returns false with the reason rather than throwing. */
export async function testIntegrity(zipPath) {
  try {
    await run("unzip", ["-t", "-qq", zipPath], { maxBuffer: 64 * 1024 * 1024 });
    return { ok: true };
  } catch (err) {
    const detail = (err.stderr || err.stdout || err.message || "").trim().split("\n").slice(0, 3).join("; ");
    return { ok: false, reason: detail || `unzip exited ${err.code}` };
  }
}

/** List entries without extracting — cheap enough to run before committing disk. */
export async function listEntries(zipPath) {
  const { stdout } = await run("unzip", ["-Z1", zipPath], { maxBuffer: 256 * 1024 * 1024 });
  return stdout.split("\n").map((l) => l.trim()).filter(Boolean).filter((l) => !l.endsWith("/"));
}

/**
 * Verify one collection's full set of ZIP parts.
 *
 * `expectedPhotos` is the inventory's photoCount — an UPPER bound, never an
 * equality target. See the note at the top of this file.
 */
export async function verifyArchive(zipPaths, { expectedPhotos = null } = {}) {
  const problems = [];
  if (!zipPaths.length) return { ok: false, problems: ["no archive files"], files: 0, bytes: 0, sets: {} };

  const parts = partsComplete(zipPaths.map((p) => basename(p)));
  if (parts.conflict) problems.push(`parts disagree on total: saw ${parts.have.join(",")} across differing totals`);
  else if (!parts.complete) problems.push(`incomplete: have part(s) ${parts.have.join(",")} of ${parts.of}, missing ${parts.missing.join(",")}`);

  let bytes = 0;
  const sets = {};
  let files = 0;

  for (const p of zipPaths) {
    const integrity = await testIntegrity(p);
    if (!integrity.ok) {
      problems.push(`${basename(p)}: failed CRC — ${integrity.reason}`);
      continue;
    }
    bytes += (await stat(p)).size;
    for (const entry of await listEntries(p)) {
      if (!JPEG.test(entry)) continue;
      files++;
      // Top-level folder = the Pixieset set, which becomes a Pixeltrunk section.
      const slash = entry.indexOf("/");
      const set = slash === -1 ? "(root)" : entry.slice(0, slash);
      sets[set] = (sets[set] || 0) + 1;
    }
  }

  if (files === 0) problems.push("archive contains no JPEGs");

  let suspicious = false;
  if (expectedPhotos != null && expectedPhotos > 0) {
    if (files > expectedPhotos) {
      problems.push(`${files} files exceeds the inventory's ${expectedPhotos} — photoCount is an upper bound, so this should be impossible`);
    } else if (files / expectedPhotos < SUSPICIOUS_RATIO) {
      // Not fatal: heavy set-overlap legitimately produces a low ratio.
      suspicious = true;
    }
  }

  return { ok: problems.length === 0, problems, files, bytes, sets, parts, suspicious };
}
