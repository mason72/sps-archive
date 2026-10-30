/**
 * npx tsx --test scripts/pixieset/plan-entries.test.ts
 *
 * The fixtures are the two real shapes the filename-only dedupe lost
 * (memory `pixieset-same-name-collapse`): rendition sets, where BW and Color
 * share a name, and camera counters that repeat across days.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  distinctContent,
  jpegImageHash,
  matchExisting,
  mergeSameImage,
  planEntries,
  wrongVersionLinks,
  type ExistingRow,
  type PlannedPhoto,
  type ZipEntry,
} from "./plan-entries";

const e = (name: string, crc: number, size: number): ZipEntry => ({ entry: name, name, crc, size });
const zip = (...entries: ZipEntry[]) => [{ zipPath: "/z/a-photo-download-1of1.zip", entries }];
const row = (id: string, name: string, size: number | null): ExistingRow => ({ id, original_filename: name, file_size: size, r2_key: `k/${id}` });
const noFetch = async (): Promise<{ crc: number; size: number }> => {
  throw new Error("should not need the stored bytes");
};

test("same bytes in two sets stay one photo with two set links", () => {
  const { photos, groups } = planEntries(zip(e("Color/AC30_0382.jpg", 111, 5000), e("Highlights/AC30_0382.jpg", 111, 5000)));
  assert.equal(photos.size, 1);
  const [only] = photos.values();
  assert.equal(only.key, "AC30_0382.jpg");
  assert.deepEqual(only.sets, ["Color", "Highlights"]);
  assert.equal(groups.get("AC30_0382.jpg")!.length, 1);
});

test("different bytes under one name become one photo per version, each in its own set", () => {
  const { photos, groups } = planEntries(zip(e("Color/AC30_0382.jpg", 111, 5000), e("BW/AC30_0382.jpg", 222, 4100)));
  assert.equal(photos.size, 2);
  const versions = groups.get("AC30_0382.jpg")!;
  assert.deepEqual(versions.map((v) => v.sets), [["Color"], ["BW"]]);
  assert.deepEqual(versions.map((v) => v.base), ["AC30_0382.jpg", "AC30_0382.jpg"]);
  assert.notEqual(versions[0].key, versions[1].key);
});

test("the content count does not share the planner's idea of identity", () => {
  const entries = [e("Day_1/IMG_0001.jpg", 1, 9000), e("Day_2/IMG_0001.jpg", 2, 9100), e("Day_2/notes.txt", 3, 10)];
  assert.equal(distinctContent(entries), 2);
  // The pre-2026-10-29 rule (one photo per basename) lands 1 of these 2. The guard
  // must disagree with it, or it could never have caught the collapse.
  assert.equal(new Set(entries.filter((x) => x.name.endsWith(".jpg")).map((x) => x.name.split("/").pop())).size, 1);
});

test("a single-version name is present by its name or its legacy spelling, exactly as before", async () => {
  const { groups } = planEntries([
    { zipPath: "/z", entries: [e("All_Photos/Ana.jpg", 1, 100), { entry: "All_Photos/Andreas Lo??cher.jpg", name: "All_Photos/Andreas Löcher.jpg", crc: 2, size: 200 }, e("All_Photos/New.jpg", 3, 300)] },
  ]);
  const m = await matchExisting(groups, [row("r1", "Ana.jpg", 100), row("r2", "Andreas Lo??cher.jpg", 200)], noFetch);
  assert.deepEqual(m.todo.map((p) => p.base), ["New.jpg"]);
  assert.equal(m.existing.get("Ana.jpg"), "r1");
  assert.equal(m.unmatched.length, 0);
});

test("a collapsed rendition: the stored version is matched by size and only the missing one is planned", async () => {
  const { groups } = planEntries(zip(e("Color/AC30_0382.jpg", 111, 5000), e("BW/AC30_0382.jpg", 222, 4100)));
  const m = await matchExisting(groups, [row("kept", "AC30_0382.jpg", 4100)], noFetch);
  assert.deepEqual(m.todo.map((p) => p.sets), [["Color"]]);
  assert.equal([...m.existing.values()][0], "kept");
});

test("a re-downloaded ZIP listing the versions in another order uploads nothing twice", async () => {
  const first = planEntries(zip(e("Color/X.jpg", 1, 500), e("BW/X.jpg", 2, 400)));
  const again = planEntries(zip(e("BW/X.jpg", 2, 400), e("Color/X.jpg", 1, 500)));
  const rows = [row("c", "X.jpg", 500), row("b", "X.jpg", 400)];
  for (const plan of [first, again]) {
    const m = await matchExisting(plan.groups, rows, noFetch);
    assert.equal(m.todo.length, 0);
    assert.equal(m.existing.size, 2);
  }
});

test("versions of equal size are told apart by the stored object's CRC", async () => {
  const { groups } = planEntries(zip(e("Day_1/IMG_7.jpg", 10, 800), e("Day_2/IMG_7.jpg", 20, 800)));
  const fetched: string[] = [];
  const m = await matchExisting(groups, [row("r", "IMG_7.jpg", 800)], async (r) => {
    fetched.push(r.id);
    return { crc: 20, size: 800 };
  });
  assert.deepEqual(fetched, ["r"]);
  assert.deepEqual(m.todo.map((p) => p.sets), [["Day_1"]]);
});

test("a stored photo matching no version leaves the whole name alone", async () => {
  const { groups } = planEntries(zip(e("Color/X.jpg", 1, 500), e("BW/X.jpg", 2, 400), e("Color/Y.jpg", 3, 600)));
  const m = await matchExisting(groups, [row("odd", "X.jpg", 777)], async () => ({ crc: 99, size: 777 }));
  assert.deepEqual(m.unmatched, [{ base: "X.jpg", rowIds: ["odd"] }]);
  assert.deepEqual(m.todo.map((p) => p.base), ["Y.jpg"]);
});

// ── links ────────────────────────────────────────────────────────────────────

const sections: Record<string, string> = { Color: "s-color", BW: "s-bw", Highlights: "s-hl" };
const sectionIdOf = (set: string) => sections[set];
/** Image ids by each version's first set. */
const idsBySet = (ids: Record<string, string | undefined>) => (p: PlannedPhoto) => ids[p.sets[0]];

test("the kept version leaves the other version's set once that version is linked there", () => {
  const plan = planEntries(zip(e("Color/X.jpg", 1, 500), e("Highlights/X.jpg", 1, 500), e("BW/X.jpg", 2, 400)));
  const idOf = idsBySet({ Color: "A", BW: "B" });
  const links = [
    { section_id: "s-color", image_id: "A" },
    { section_id: "s-hl", image_id: "A" },
    { section_id: "s-bw", image_id: "A" }, // the collapse put the color frame here
    { section_id: "s-bw", image_id: "B" }, // the BW version, just landed
  ];
  assert.deepEqual(wrongVersionLinks(plan.groups, idOf, sectionIdOf, links), [{ section_id: "s-bw", image_id: "A" }]);
});

test("nothing moves while the right version is missing from that set", () => {
  const plan = planEntries(zip(e("Color/X.jpg", 1, 500), e("BW/X.jpg", 2, 400)));
  const links = [
    { section_id: "s-color", image_id: "A" },
    { section_id: "s-bw", image_id: "A" },
  ];
  assert.deepEqual(wrongVersionLinks(plan.groups, idsBySet({ Color: "A", BW: "B" }), sectionIdOf, links), []);
  assert.deepEqual(wrongVersionLinks(plan.groups, idsBySet({ Color: "A", BW: undefined }), sectionIdOf, links), []);
});

test("an image never loses its last link", () => {
  const plan = planEntries(zip(e("Color/X.jpg", 1, 500), e("BW/X.jpg", 2, 400)));
  // A is linked ONLY in BW: removing it there would orphan it.
  const links = [
    { section_id: "s-bw", image_id: "A" },
    { section_id: "s-bw", image_id: "B" },
  ];
  assert.deepEqual(wrongVersionLinks(plan.groups, idsBySet({ Color: "A", BW: "B" }), sectionIdOf, links), []);
});

test("sections outside the archive's sets are never touched", () => {
  const plan = planEntries(zip(e("Color/X.jpg", 1, 500), e("BW/X.jpg", 2, 400)));
  const links = [
    { section_id: "s-color", image_id: "A" },
    { section_id: "s-favorites", image_id: "A" },
    { section_id: "s-bw", image_id: "B" },
    { section_id: "s-favorites", image_id: "B" },
  ];
  assert.deepEqual(wrongVersionLinks(plan.groups, idsBySet({ Color: "A", BW: "B" }), sectionIdOf, links), []);
});

test("two set names that land in one section never strip either version from it", () => {
  const plan = planEntries(zip(e("Day_1/IMG_7.jpg", 1, 500), e("Day 1/IMG_7.jpg", 2, 400)));
  const oneSection = () => "s-day1";
  const links = [
    { section_id: "s-day1", image_id: "A" },
    { section_id: "s-day1", image_id: "B" },
  ];
  assert.deepEqual(wrongVersionLinks(plan.groups, idsBySet({ Day_1: "A", "Day 1": "B" }), oneSection, links), []);
});

test("a one-version name whose stored row has other bytes is left for a human, not counted present", async () => {
  const { groups } = planEntries(zip(e("All_Photos/IMG_1234.jpg", 5, 700)));
  const m = await matchExisting(groups, [row("sps", "IMG_1234.jpg", 900)], noFetch);
  assert.deepEqual(m.unmatched, [{ base: "IMG_1234.jpg", rowIds: ["sps"] }]);
  assert.equal(m.todo.length, 0);
  // A row with no recorded size still vouches for its name, as before.
  const legacy = await matchExisting(groups, [row("old", "IMG_1234.jpg", null)], noFetch);
  assert.equal(legacy.existing.get("IMG_1234.jpg"), "old");
});

// ── same pixels, different metadata ──────────────────────────────────────────

const seg = (marker: number, payload: Buffer) => {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), len, payload]);
};
/** A minimal JPEG: metadata, one table, a frame header, and a scan. */
const jpeg = (opts: { exif?: string; table?: number; scan?: string }) =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe1, Buffer.from(opts.exif ?? "exif")),
    seg(0xdb, Buffer.from([opts.table ?? 1, 2, 3])),
    seg(0xc0, Buffer.from([8, 0, 1, 0, 1])),
    seg(0xda, Buffer.from([1, 2])),
    Buffer.from(opts.scan ?? "scan-data"),
    Buffer.from([0xff, 0xd9]),
  ]);

test("metadata does not change the image hash; tables and scan data do", () => {
  const base = jpegImageHash(jpeg({}));
  assert.equal(jpegImageHash(jpeg({ exif: "other camera, other date" })), base);
  assert.notEqual(jpegImageHash(jpeg({ table: 9 })), base);
  assert.notEqual(jpegImageHash(jpeg({ scan: "other-scan" })), base);
});

test("a start-of-scan inside an EXIF thumbnail is not where the image starts", () => {
  // The thumbnail's own SOS sits in APP1. A plain search for FF DA would hash from
  // there, take in the metadata after it, and call these two identical photos different.
  const thumb = (tail: string) => `thumb\xff\xdathumb-${tail}`;
  const a = jpeg({ exif: thumb("taken friday") });
  const b = jpeg({ exif: thumb("taken sunday") });
  assert.equal(jpegImageHash(a), jpegImageHash(b));
});

test("colour transform, colour profile and rotation are part of the picture", () => {
  const withSeg = (extra: Buffer) => {
    const j = jpeg({});
    return Buffer.concat([j.subarray(0, 2), extra, j.subarray(2)]);
  };
  const base = jpegImageHash(jpeg({}));
  assert.notEqual(jpegImageHash(withSeg(seg(0xee, Buffer.from("Adobe-transform-1")))), base);
  assert.notEqual(jpegImageHash(withSeg(seg(0xe2, Buffer.from("ICC_PROFILE-p3")))), base);

  // EXIF: little-endian TIFF, one IFD entry, tag 0x0112.
  const exif = (orientation: number, note = "") => {
    const tiff = Buffer.alloc(26);
    tiff.write("II", 0, "latin1");
    tiff.writeUInt16LE(42, 2);
    tiff.writeUInt32LE(8, 4);
    tiff.writeUInt16LE(1, 8);
    tiff.writeUInt16LE(0x0112, 10);
    tiff.writeUInt16LE(3, 12);
    tiff.writeUInt32LE(1, 14);
    tiff.writeUInt16LE(orientation, 18);
    return Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff, Buffer.from(note)]);
  };
  const shot = (o: number, note = "") => Buffer.concat([jpeg({}).subarray(0, 2), seg(0xe1, exif(o, note)), jpeg({}).subarray(2)]);
  assert.notEqual(jpegImageHash(shot(6)), jpegImageHash(shot(1)));
  assert.equal(jpegImageHash(shot(6, "date a")), jpegImageHash(shot(6, "date b")));
});

test("truncated and odd files never throw", () => {
  const whole = jpeg({ exif: "Exif\0\0II" });
  for (let n = 0; n <= whole.length; n++) jpegImageHash(whole.subarray(0, n));
});

test("something that is not a JPEG is compared whole", () => {
  assert.notEqual(jpegImageHash(Buffer.from("not a jpeg, one")), jpegImageHash(Buffer.from("not a jpeg, two")));
});

const merging = (bytes: Record<number, Buffer>) => (p: PlannedPhoto) => Promise.resolve(bytes[p.crc]);

test("versions with identical image data fold into one photo linked to both sets", async () => {
  // The Kia shape: same size, different CRC, about 110 bytes of EXIF apart.
  const plan = planEntries(zip(e("Day_1/2D_0308.jpg", 1, 6000), e("Day_Zero/2D_0308.jpg", 2, 6000)));
  const m = await mergeSameImage(plan, merging({ 1: jpeg({ exif: "a" }), 2: jpeg({ exif: "b" }) }));
  assert.equal(m.merged, 1);
  assert.equal(m.photos.size, 1);
  const [only] = m.photos.values();
  assert.equal(only.key, "2D_0308.jpg");
  assert.deepEqual(only.sets, ["Day_1", "Day_Zero"]);
  // The stored row is that one photo: nothing to upload, no link to remove.
  const match = await matchExisting(m.groups, [row("kept", "2D_0308.jpg", 6000)], noFetch);
  assert.equal(match.todo.length, 0);
  assert.equal(match.unmatched.length, 0);
  assert.deepEqual(wrongVersionLinks(m.groups, () => "kept", (s) => s, [{ section_id: "Day_1", image_id: "kept" }, { section_id: "Day_Zero", image_id: "kept" }]), []);
});

test("really different versions stay apart, and only the same two of three fold", async () => {
  const plan = planEntries(zip(e("Color/X.jpg", 1, 500), e("BW/X.jpg", 2, 400), e("Web/X.jpg", 3, 500)));
  const m = await mergeSameImage(plan, merging({ 1: jpeg({ exif: "a" }), 2: jpeg({ scan: "bw-scan" }), 3: jpeg({ exif: "c" }) }));
  assert.equal(m.merged, 1);
  assert.deepEqual(m.groups.get("X.jpg")!.map((v) => v.sets), [["Color", "Web"], ["BW"]]);
  assert.equal(m.photos.size, 2);
});

test("a name with one version is never read", async () => {
  const plan = planEntries(zip(e("Color/Y.jpg", 1, 500), e("Highlights/Y.jpg", 1, 500)));
  const m = await mergeSameImage(plan, () => {
    throw new Error("should not read");
  });
  assert.equal(m.merged, 0);
  assert.equal(m.photos.size, 1);
});
