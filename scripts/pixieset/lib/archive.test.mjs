/**
 * Tests for archive verification.
 *
 *   node --test scripts/pixieset/lib/archive.test.mjs
 *
 * These build REAL zip files in a temp dir and corrupt one of them on purpose.
 * A verifier tested only against archives it knows are good proves nothing —
 * the whole point is that it rejects the bad ones.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseParts, partsComplete, testIntegrity, verifyArchive } from "./archive.mjs";

const run = promisify(execFile);
let dir;

/** A tiny but structurally valid JPEG (SOI … EOI). */
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);

/** Build a real zip laid out the way Pixieset lays one out: sets as folders. */
async function makeZip(name, layout) {
  const staging = join(dir, `stage-${name}`);
  for (const [folder, count] of Object.entries(layout)) {
    await mkdir(join(staging, folder), { recursive: true });
    for (let i = 1; i <= count; i++) await writeFile(join(staging, folder, `img_${i}.jpg`), jpeg);
  }
  const zipPath = join(dir, name);
  await run("zip", ["-rq", zipPath, ".", "-i", "*"], { cwd: staging });
  return zipPath;
}

before(async () => { dir = await mkdtemp(join(tmpdir(), "pxset-archive-")); });
after(async () => { await rm(dir, { recursive: true, force: true }); });

test("parseParts reads the -NofM suffix and treats a bare name as 1of1", () => {
  assert.deepEqual(parseParts("gallery-1of1.zip"), { part: 1, of: 1, stem: "gallery", explicit: true });
  assert.deepEqual(parseParts("Big Gallery-2of3.zip"), { part: 2, of: 3, stem: "Big Gallery", explicit: true });
  assert.equal(parseParts("plain.zip").of, 1);
  assert.equal(parseParts("plain.zip").explicit, false, "an assumed 1of1 is flagged as assumed");
});

test("a complete part set is complete; a missing middle part is not", () => {
  assert.equal(partsComplete(["g-1of3.zip", "g-2of3.zip", "g-3of3.zip"]).complete, true);
  const gap = partsComplete(["g-1of3.zip", "g-3of3.zip"]);
  assert.equal(gap.complete, false);
  assert.deepEqual(gap.missing, [2]);
});

test("the last part alone never passes as a complete set", () => {
  // The failure mode that matters: one valid ZIP, no error, 2/3 of the gallery gone.
  const only = partsComplete(["g-3of3.zip"]);
  assert.equal(only.complete, false);
  assert.deepEqual(only.missing, [1, 2]);
});

test("parts disagreeing on the total is a conflict, not a pass", () => {
  const c = partsComplete(["g-1of2.zip", "g-2of3.zip"]);
  assert.equal(c.complete, false);
  assert.equal(c.conflict, true);
});

test("a healthy archive verifies, and its sets map to folders", async () => {
  const zip = await makeZip("good-1of1.zip", { All_Photos: 8, Your_Favorites: 3 });
  const r = await verifyArchive([zip], { expectedPhotos: 11 });
  assert.equal(r.ok, true, r.problems.join("; "));
  assert.equal(r.files, 11);
  assert.deepEqual(r.sets, { All_Photos: 8, Your_Favorites: 3 });
  assert.ok(r.bytes > 0);
});

test("a corrupted archive fails CRC instead of extracting most of a gallery", async () => {
  const zip = await makeZip("corrupt-1of1.zip", { All_Photos: 12 });
  const buf = await readFile(zip);
  // Flip bytes in the middle of the compressed data — structure survives, CRC does not.
  for (let i = 40; i < Math.min(160, buf.length - 40); i++) buf[i] ^= 0xff;
  await writeFile(zip, buf);

  const integrity = await testIntegrity(zip);
  assert.equal(integrity.ok, false, "unzip -t must reject the corrupted archive");

  const r = await verifyArchive([zip], { expectedPhotos: 12 });
  assert.equal(r.ok, false);
  assert.match(r.problems.join(" "), /CRC|no JPEGs/);
});

test("a truncated download is rejected", async () => {
  const zip = await makeZip("trunc-1of1.zip", { All_Photos: 10 });
  const buf = await readFile(zip);
  await writeFile(zip, buf.subarray(0, Math.floor(buf.length * 0.6)));
  const r = await verifyArchive([zip], { expectedPhotos: 10 });
  assert.equal(r.ok, false, "a 60%-complete ZIP must not verify");
});

test("a missing part fails even when every present part is individually valid", async () => {
  const a = await makeZip("split-1of3.zip", { All_Photos: 5 });
  const c = await makeZip("split-3of3.zip", { All_Photos: 5 });
  const r = await verifyArchive([a, c], { expectedPhotos: 15 });
  assert.equal(r.ok, false, "two good ZIPs are not a complete gallery");
  assert.match(r.problems.join(" "), /missing 2/);
});

test("all parts present verifies and sums across them", async () => {
  const parts = [];
  for (let i = 1; i <= 3; i++) parts.push(await makeZip(`full-${i}of3.zip`, { All_Photos: 4 }));
  const r = await verifyArchive(parts, { expectedPhotos: 12 });
  assert.equal(r.ok, true, r.problems.join("; "));
  assert.equal(r.files, 12);
});

test("photoCount is an upper bound — a half-size result is flagged, not failed", async () => {
  // The real double-counting case: 48 unique photos behind a photoCount of 80.
  const zip = await makeZip("dbl-1of1.zip", { All_Photos: 8 });
  const r = await verifyArchive([zip], { expectedPhotos: 40 });
  assert.equal(r.ok, true, "under-count must not fail — sets legitimately overlap");
  assert.equal(r.suspicious, true, "but it is worth a human look");
});

test("more files than the inventory claims is flagged, NOT failed", async () => {
  // This test previously asserted that exceeding photo_count was "impossible" and
  // therefore a failure. Real data disproved it on 2026-08-12:
  // `perkinelmereventphotos` reports photo_count 903 while its seven sets add up to
  // 1,016, so a complete every-set download of a healthy gallery exceeds the
  // inventory's number. The old assertion would have failed that download and every
  // multi-set gallery like it. photo_count is now a soft signal, never a ceiling.
  const zip = await makeZip("over-1of1.zip", { All_Photos: 10 });
  const r = await verifyArchive([zip], { expectedPhotos: 4 });
  assert.equal(r.ok, true, "exceeding photo_count is not evidence of a bad archive");
  assert.equal(r.suspicious, true, "but it is worth a human look");
});

test("an archive with no JPEGs does not pass as a gallery", async () => {
  const staging = join(dir, "stage-empty");
  await mkdir(staging, { recursive: true });
  await writeFile(join(staging, "readme.txt"), "nothing here");
  const zip = join(dir, "empty-1of1.zip");
  await run("zip", ["-rq", zip, "."], { cwd: staging });
  const r = await verifyArchive([zip], { expectedPhotos: 10 });
  assert.equal(r.ok, false);
  assert.match(r.problems.join(" "), /no JPEGs/);
});

test("no files at all is a failure, not an empty success", async () => {
  const r = await verifyArchive([], { expectedPhotos: 10 });
  assert.equal(r.ok, false);
  assert.equal(r.files, 0);
});

// --- fidelity -------------------------------------------------------------
// A Web Size rendition is IDENTICAL to the originals in filename, part count and
// file count. These are the only tests that can tell them apart, so they are the
// ones standing between the archive and a silent, permanent loss of resolution.

/** A JPEG carrying a real SOF0 frame of the given dimensions. */
function sofJpeg(width, height) {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
  ]);
}

async function makeSizedZip(name, dims) {
  const staging = join(dir, `stage-${name}`);
  await mkdir(join(staging, "All_Photos"), { recursive: true });
  let i = 0;
  for (const [w, h] of dims) await writeFile(join(staging, "All_Photos", `img_${++i}.jpg`), sofJpeg(w, h));
  const zipPath = join(dir, name);
  await run("zip", ["-rq", zipPath, ".", "-i", "*"], { cwd: staging });
  return zipPath;
}

test("a Web Size rendition is REJECTED even though it is otherwise perfect", async () => {
  // Measured signature: Pixieset renders every web-size frame to exactly 2048 wide.
  const z = await makeSizedZip("web-1of1.zip", [[2048, 2896], [2048, 1387], [2048, 3072], [2048, 1455], [2048, 2813]]);
  const r = await verifyArchive([z], { expectedFiles: 5 });
  assert.equal(r.ok, false, "uniform 2048px width must not pass as originals");
  assert.equal(r.dimensions.uniformWidth, 2048);
  assert.match(r.problems.join(" "), /Web Size rendition/);
});

test("genuine originals pass — varying widths are the camera's signature", async () => {
  const z = await makeSizedZip("orig-1of1.zip", [[4800, 3362], [3583, 4620], [3301, 4800], [4669, 3578], [4375, 3454]]);
  const r = await verifyArchive([z], { expectedFiles: 5 });
  assert.equal(r.ok, true, r.problems.join("; "));
  assert.equal(r.dimensions.uniformWidth, null, "varying widths must not read as a rendition");
  // long edges 4800, 4620, 4800, 4669, 4375 → median 4669
  assert.equal(r.dimensions.medianLongEdge, 4669);
});

test("the fidelity guard does not fire on a uniform LARGE width", async () => {
  // An unedited shoot straight off one body genuinely has uniform width. Only a
  // uniform NARROW width is a rendition — a guard that cried wolf here would be
  // switched off on the day it was right.
  const z = await makeSizedZip("uniform-big-1of1.zip", [[6000, 4000], [6000, 4000], [6000, 4000], [6000, 4000]]);
  const r = await verifyArchive([z], { expectedFiles: 4 });
  assert.equal(r.ok, true, r.problems.join("; "));
});

test("the set picker's count is an equality target, unlike photo_count", async () => {
  const z = await makeSizedZip("short-1of1.zip", [[4800, 3200], [4700, 3100]]);
  const short = await verifyArchive([z], { expectedFiles: 48 });
  assert.equal(short.ok, false);
  assert.match(short.problems.join(" "), /set picker promised 48/);
  // The same archive against the double-counted inventory figure must NOT fail.
  const upper = await verifyArchive([z], { expectedPhotos: 48 });
  assert.equal(upper.ok, true, "photo_count is an upper bound and must never be asserted as equality");
});

test("a complete every-set download may legitimately EXCEED photo_count", async () => {
  // Measured on perkinelmereventphotos (2026-08-12): photo_count reports 903, but its
  // seven sets add up to 1,016. A gallery with no "All Photos" set is downloaded by
  // taking every set, so a healthy archive genuinely holds more files than the
  // inventory's number. Treating photo_count as a ceiling fails that download.
  const z = await makeSizedZip("everyset-1of1.zip", [[4800, 3200], [4700, 3100], [4600, 3000], [4500, 2900]]);
  const r = await verifyArchive([z], { expectedPhotos: 3, expectedFiles: 4 });
  assert.equal(r.ok, true, `4 files against photo_count 3 must pass when the picker promised 4 — got: ${r.problems.join("; ")}`);
});

test("without the picker's count, exceeding photo_count is flagged but not failed", async () => {
  const z = await makeSizedZip("noexpect-1of1.zip", [[4800, 3200], [4700, 3100], [4600, 3000]]);
  const r = await verifyArchive([z], { expectedPhotos: 2 });
  assert.equal(r.ok, true, "a soft flag, not a failure — we have no better evidence to judge it against");
  assert.equal(r.suspicious, true, "but it must still be surfaced for a human look");
});

test("the picker's count still fails a genuinely short download", async () => {
  // The check that matters must survive the fix above.
  const z = await makeSizedZip("stillshort-1of1.zip", [[4800, 3200], [4700, 3100]]);
  const r = await verifyArchive([z], { expectedPhotos: 903, expectedFiles: 1016 });
  assert.equal(r.ok, false);
  assert.match(r.problems.join(" "), /set picker promised 1016/);
});
