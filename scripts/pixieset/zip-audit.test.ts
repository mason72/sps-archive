/**
 * npx tsx --test scripts/pixieset/zip-audit.test.ts
 *
 * The pure half of the audit: how its counts become a verdict, and the two name
 * rules that find a deleted copy's frames in the gallery that was kept.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The audit reads its retirement folder from the environment at load time.
const STAGING = fs.mkdtempSync(path.join(os.tmpdir(), "zip-audit-"));
process.env.PIXIESET_STAGING = STAGING;
const { AUDIT_VERSION, RowLedger, decide, frameNumber, looseName, nearSample, settled, spread, tally } = await import("./zip-audit");

const none = { todo: 0, unmatched: 0, far: 0, near: 0, newNames: 0, sampled: 0, sameImage: 0, nearDifferent: 0 };

test("nothing absent is complete; absent but all held elsewhere is elsewhere", () => {
  assert.equal(decide(none).verdict, "complete");
  assert.equal(decide({ ...none, todo: 12 }).verdict, "elsewhere");
});

test("near-identical photos read as the same picture are metadata, not missing (Kia at Dad 2.0)", () => {
  const d = decide({ ...none, todo: 491, near: 491, sampled: 4, sameImage: 4 });
  assert.deepEqual(d, { verdict: "metadata", versions: 0, nearLeft: 491, onlyHere: 491 });
});

test("metadata needs at least one read: near photos nobody read stay missing", () => {
  assert.equal(decide({ ...none, todo: 3, near: 3 }).verdict, "missing");
});

test("one near photo that proved a different picture makes every near photo a version", () => {
  const d = decide({ ...none, todo: 10, near: 10, sampled: 4, sameImage: 3, nearDifferent: 1 });
  assert.deepEqual(d, { verdict: "missing", versions: 10, nearLeft: 0, onlyHere: 10 });
});

test("far versions, new names or unmatched rows are missing even when every read matched", () => {
  assert.equal(decide({ ...none, todo: 5, near: 4, far: 1, sampled: 5, sameImage: 5 }).verdict, "missing");
  assert.equal(decide({ ...none, todo: 1, newNames: 1 }).verdict, "missing");
  assert.equal(decide({ ...none, unmatched: 1 }).verdict, "missing");
});

test("a far photo that read as the same picture still counts as a version (cost, never a loss)", () => {
  const d = decide({ ...none, todo: 2, far: 2, sampled: 2, sameImage: 2 });
  assert.equal(d.verdict, "missing");
  assert.equal(d.versions, 2);
});

test("loose names: Pixieset's dropped spaces and case are one name; other letters are not", () => {
  assert.equal(looseName("Abby Main_26-08-05_Appfolio_367.jpg"), looseName("AbbyMain_26-08-05_Appfolio_367.jpg"));
  assert.equal(looseName("amanda cheromiah_26-06-04_CollegeBoard_2685.JPG"), looseName("AmandaCheromiah_26-06-04_CollegeBoard_2685.jpg"));
  assert.notEqual(looseName("AbbyMain_26-08-05_Appfolio_367.jpg"), looseName("AbbyMain_26-08-05_Appfolio_368.jpg"));
  assert.equal(looseName("Andreas Löcher.jpg"), looseName("AndreasLöcher.jpg"));
});

test("frame number is the last digit run before the extension", () => {
  assert.equal(frameNumber("AbbyMain_26-08-05_Appfolio_367.jpg"), "367");
  assert.equal(frameNumber("241214_Wall&CeilingAllianceHolidayParty9233.jpg"), "9233");
  assert.equal(frameNumber("Falco.jpg"), "Falco.jpg");
});

test("spread takes items across the whole list, not its head", () => {
  assert.deepEqual(spread([1, 2, 3], 5), [1, 2, 3]);
  assert.deepEqual(spread([...Array(100).keys()], 4), [0, 25, 50, 75]);
  assert.deepEqual(spread([], 4), []);
});

test("an older version's flags are read again; its clean verdicts are kept", () => {
  const at = "2026-10-31T00:00:00Z";
  assert.equal(settled({ slug: "a", verdict: "missing", at }), false);
  assert.equal(settled({ slug: "a", verdict: "unread", at }), false);
  assert.equal(settled({ slug: "a", verdict: "complete", at }), true);
  assert.equal(settled({ slug: "a", verdict: "elsewhere", at }), true);
  assert.equal(settled({ slug: "a", verdict: "missing", at, v: AUDIT_VERSION }), true);
  assert.equal(settled(undefined), false);
});

test("a near set nobody read keeps the gallery out of metadata", () => {
  assert.equal(decide({ ...none, todo: 50, near: 50, sampled: 12, sameImage: 12, setsLeft: 1 }).verdict, "missing");
});

test("near sampling reads every set, so a small logo set hidden in metadata copies is read", () => {
  const near = [
    ...Array.from({ length: 491 }, (_, i) => ({ id: `meta${i}`, sets: ["All"] })),
    ...Array.from({ length: 20 }, (_, i) => ({ id: `logo${i}`, sets: ["With Logo"] })),
  ];
  const { list, setsLeft } = nearSample(near);
  assert.ok(list.some((p) => p.sets[0] === "With Logo"));
  assert.ok(list.length >= 4 && list.length <= 12);
  assert.equal(setsLeft, 0);
  const many = Array.from({ length: 30 }, (_, i) => ({ sets: [`Set ${i}`] }));
  assert.equal(nearSample(many).list.length, 12);
  assert.equal(nearSample(many).setsLeft, 18);
  assert.equal(nearSample([]).list.length, 0);
});

test("one stored row stands for one photo across every matcher (DAIS: color held, BW not)", () => {
  const ledger = new RowLedger();
  const sps = [{ id: "R", name: "X.jpg", size: 10 }];
  const elsewhere = ledger.index(sps, (r) => `${r.name}|${r.size}`);
  const byName = ledger.index(sps, (r) => looseName(r.name));
  assert.equal(elsewhere("X.jpg|10"), true, "the color version is the SPS row's bytes");
  assert.equal(byName("x.jpg"), false, "the BW version cannot claim the same row by name");
  const two = ledger.index([{ id: "A", k: "b" }, { id: "B", k: "b" }], (r) => r.k);
  assert.equal(two("b"), true);
  assert.equal(two("b"), true);
  assert.equal(two("b"), false);
  assert.equal(ledger.used("A") && ledger.used("B"), true);
});

test("a version-1 flag that Pixieset then refused to rebuild is counted and no longer waits", () => {
  const at = "2026-10-31T00:00:00Z";
  const state = { createdAt: at, results: { old: { slug: "old", verdict: "missing" as const, absent: 7, at }, fresh: { slug: "fresh", verdict: "missing" as const, at } } };
  const retired = path.join(STAGING, "retired");
  fs.mkdirSync(retired, { recursive: true });
  fs.writeFileSync(path.join(retired, "px-retired-old.json"), JSON.stringify({ reason: "gone" }));
  const t = tally(state, ["old", "fresh"]);
  assert.equal(t.missing, 1, "the refused one counts under its old verdict");
  assert.deepEqual(t.waiting, ["fresh"], "the other is still owed its re-read");
  assert.deepEqual(t.retired, []);
});
