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
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { jpegSize, longEdge } from "./jpeg.mjs";

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
 * Read one entry's JPEG header out of a ZIP without extracting it.
 *
 * `unzip -p` streams to stdout; we kill it once we have enough bytes for the SOF
 * marker. Reading a 6 MB photo to learn two integers would make sampling cost
 * more than the verification it supports.
 */
export function headerBytes(zipPath, entry, bytes = 65536) {
  return new Promise((resolve) => {
    const child = spawn("unzip", ["-p", zipPath, entry]);
    const chunks = [];
    let total = 0, settled = false;
    const done = (buf) => { if (settled) return; settled = true; child.kill("SIGKILL"); resolve(buf); };
    child.stdout.on("data", (c) => {
      chunks.push(c);
      total += c.length;
      if (total >= bytes) done(Buffer.concat(chunks));
    });
    child.stdout.on("end", () => done(chunks.length ? Buffer.concat(chunks) : null));
    child.on("error", () => done(null));
    child.on("close", () => done(chunks.length ? Buffer.concat(chunks) : null));
  });
}

/**
 * The signature of Pixieset's "Web Size" rendition: a fixed pixel WIDTH.
 *
 * MEASURED 2026-08-12 by downloading `nachisheadshots` twice, once at High
 * Resolution and once at Web Size, and comparing frame by frame:
 *
 *   originals   4800x3362  3583x4620  3301x4800  4669x3578  4375x3454   (widths vary)
 *   web size    2048x….    2048x….    2048x….    2048x….    2048x….     (width ALWAYS 2048)
 *
 * The long edge is NOT a usable discriminator and an earlier guess that it was
 * would have been worse than no guard: web-size long edges run 2048–3072, which
 * overlaps genuine originals (2015–2016 medians are 3840, and 2014 holds frames
 * as small as 1,844). Any long-edge threshold either never fires or fires on real
 * archive material. The uniform width is the thing that actually separates them.
 */
export const WEB_SIZE_WIDTH = 2048;

/** Uniform width at or below this, across every sample, reads as a rendition not a camera. */
export const RENDITION_WIDTH_MAX = 2560;

/**
 * Sample pixel dimensions across an archive to prove it holds ORIGINALS.
 *
 * This is the ONLY check that can tell an original from Pixieset's Web Size
 * rendition — CRC passes, filenames match and the file count is identical for
 * both. It matters because "DOWNLOAD EXISTING" may hand back a ZIP a CLIENT
 * generated at Web Size, and archiving those would silently destroy the very
 * thing this migration exists to preserve.
 *
 * Derived from the decoded pixels, deliberately NOT from the byte size or the
 * inventory's `size` field: a guard that reads the same source as the thing it
 * is guarding can only ever agree with it.
 */
export async function sampleDimensions(zipPath, entries, { sample = 5 } = {}) {
  const jpegs = entries.filter((e) => JPEG.test(e));
  if (!jpegs.length) return { sampled: 0, longEdges: [], medianLongEdge: null };
  // Spread the sample across the archive — a burst from the front would miss a
  // gallery that changes camera (or rendition) partway through.
  const step = Math.max(1, Math.floor(jpegs.length / sample));
  const picks = [];
  for (let i = 0; i < jpegs.length && picks.length < sample; i += step) picks.push(jpegs[i]);

  const longEdges = [];
  const widths = [];
  for (const entry of picks) {
    const buf = await headerBytes(zipPath, entry);
    const size = buf ? jpegSize(buf) : null;
    if (!size) continue;
    longEdges.push(longEdge(size));
    widths.push(size.width);
  }
  const sorted = [...longEdges].sort((a, b) => a - b);
  // A camera crops to varying widths across a shoot; a renderer does not. Uniform
  // narrow width across every sample is the rendition tell — see WEB_SIZE_WIDTH.
  const uniformWidth = widths.length >= 3 && widths.every((w) => w === widths[0]) ? widths[0] : null;
  return {
    sampled: longEdges.length,
    longEdges,
    widths,
    uniformWidth,
    isRendition: uniformWidth != null && uniformWidth <= RENDITION_WIDTH_MAX,
    medianLongEdge: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
  };
}

/**
 * Verify one collection's full set of ZIP parts.
 *
 * `expectedPhotos` is the inventory's photoCount — an UPPER bound, never an
 * equality target. See the note at the top of this file.
 */
export async function verifyArchive(zipPaths, { expectedPhotos = null, expectedFiles = null, checkFidelity = true } = {}) {
  const problems = [];
  if (!zipPaths.length) return { ok: false, problems: ["no archive files"], files: 0, bytes: 0, sets: {} };

  const parts = partsComplete(zipPaths.map((p) => basename(p)));
  if (parts.conflict) problems.push(`parts disagree on total: saw ${parts.have.join(",")} across differing totals`);
  else if (!parts.complete) problems.push(`incomplete: have part(s) ${parts.have.join(",")} of ${parts.of}, missing ${parts.missing.join(",")}`);

  let bytes = 0;
  const sets = {};
  let files = 0;

  let widest = { path: null, entries: [], count: 0 };

  for (const p of zipPaths) {
    const integrity = await testIntegrity(p);
    if (!integrity.ok) {
      problems.push(`${basename(p)}: failed CRC — ${integrity.reason}`);
      continue;
    }
    bytes += (await stat(p)).size;
    const entries = await listEntries(p);
    let inThis = 0;
    for (const entry of entries) {
      if (!JPEG.test(entry)) continue;
      files++;
      inThis++;
      // Top-level folder = the Pixieset set, which becomes a Pixeltrunk section.
      const slash = entry.indexOf("/");
      const set = slash === -1 ? "(root)" : entry.slice(0, slash);
      sets[set] = (sets[set] || 0) + 1;
    }
    if (inThis > widest.count) widest = { path: p, entries, count: inThis };
  }

  if (files === 0) problems.push("archive contains no JPEGs");

  // Fidelity. The ONLY check that separates originals from Pixieset's Web Size
  // rendition — CRC, filenames, part counts and file counts are identical for both.
  let dimensions = null;
  if (checkFidelity && widest.path) {
    dimensions = await sampleDimensions(widest.path, widest.entries);
    if (dimensions.isRendition) {
      problems.push(
        `looks like a Web Size rendition, not originals: every sampled frame is ${dimensions.uniformWidth}px wide ` +
        `(median long edge ${dimensions.medianLongEdge}). Re-request this collection at High Resolution.`
      );
    }
  }

  // The set picker reports each set's photo count. That is an INDEPENDENT source
  // from the inventory's photo_count, and unlike it, it is not double-counted — so
  // here an exact match is meaningful rather than guaranteed to fail.
  if (expectedFiles != null && expectedFiles > 0 && files !== expectedFiles) {
    problems.push(`${files} JPEGs but the set picker promised ${expectedFiles}`);
  }

  let suspicious = false;
  if (expectedPhotos != null && expectedPhotos > 0) {
    if (files > expectedPhotos) {
      problems.push(`${files} files exceeds the inventory's ${expectedPhotos} — photoCount is an upper bound, so this should be impossible`);
    } else if (files / expectedPhotos < SUSPICIOUS_RATIO) {
      // Not fatal: heavy set-overlap legitimately produces a low ratio.
      suspicious = true;
    }
  }

  return { ok: problems.length === 0, problems, files, bytes, sets, parts, suspicious, dimensions };
}
