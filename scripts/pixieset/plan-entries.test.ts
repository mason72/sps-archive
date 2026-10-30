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
  matchExisting,
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
  const m = await matchExisting(groups, [row("r1", "Ana.jpg", 999), row("r2", "Andreas Lo??cher.jpg", 200)], noFetch);
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
