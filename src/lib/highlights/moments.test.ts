import { describe, expect, it } from "vitest";
import { groupIntoMoments, selectMoments, type MomentInput } from "./moments";
import {
  bwBaselineNote,
  bwSiblings,
  capTags,
  subjectFaceRows,
  eventCutoffs,
  summarizeFaces,
  vetoReason,
  type FrameFacts,
} from "./rules";

const at = (min: number) => new Date(Date.UTC(2026, 10, 10, 9, min)).toISOString();
const frame = (id: string, min: number, score: number, extra: Partial<MomentInput> = {}): MomentInput => ({
  id,
  takenAt: at(min),
  score,
  ...extra,
});

describe("selectMoments: hard limits (Electronica, 2026-11-16)", () => {
  it("one per person: a subject never appears twice, even when that leaves the set short", () => {
    // The robot dog: one name-stack, many high-scoring frames, no face cluster.
    const dog = Array.from({ length: 8 }, (_, i) => frame(`dog${i}`, i, 0.9 - i * 0.01, { personIds: ["name:lukas"] }));
    const ana = frame("ana", 20, 0.5, { personIds: ["p-ana"] });
    const picked = selectMoments(groupIntoMoments([...dog, ana]), 5, { onePerPerson: true });
    const ids = picked.map((m) => m.frames[m.bestIndex].id);
    expect(ids.filter((id) => id.startsWith("dog"))).toHaveLength(1);
    expect(ids).toContain("ana");
    expect(ids).toHaveLength(2); // short, not padded with repeats
  });

  it("moments handed over in score order (not capture order) still spread over the timeline", () => {
    const ms = groupIntoMoments(
      Array.from({ length: 12 }, (_, i) => frame(`f${i}`, i * 10, (i * 7) % 12, { personIds: [`p${i}`] }))
    ).sort((a, b) => b.score - a.score); // propose passes its shortlist this way
    expect(() => selectMoments(ms, 4, { onePerPerson: true })).not.toThrow();
    expect(selectMoments(ms, 4, { onePerPerson: true })).toHaveLength(4);
  });

  it("without onePerPerson the old behavior repeats a subject (the bug this guards)", () => {
    const dog = Array.from({ length: 8 }, (_, i) => frame(`dog${i}`, i, 0.9 - i * 0.01, { personIds: ["name:lukas"] }));
    const picked = selectMoments(groupIntoMoments(dog), 5, {});
    expect(picked.length).toBeGreaterThan(1);
  });

  it("a pair holding an already-picked person is out", () => {
    const solo = frame("solo", 0, 0.9, { personIds: ["p-a"] });
    const pair = frame("pair", 30, 0.8, { personIds: ["p-a", "p-b"] });
    const other = frame("other", 60, 0.1, { personIds: ["p-d"] });
    const ids = selectMoments(groupIntoMoments([solo, pair, other]), 3, { onePerPerson: true }).map((m) => m.frames[0].id);
    expect(ids.sort()).toEqual(["other", "solo"]);
  });

  it("a group shot with one familiar face among new ones still counts; mostly-familiar is out", () => {
    const solo = frame("solo", 0, 0.9, { personIds: ["p-a"] });
    const fresh = frame("fresh", 30, 0.8, { personIds: ["p-a", "p-b", "p-c", "p-d"], tags: ["group"] });
    const stale = frame("stale", 60, 0.7, { personIds: ["p-a", "p-b", "p-c"], tags: ["group"] });
    const ids = selectMoments(groupIntoMoments([solo, fresh, stale]), 3, { onePerPerson: true }).map((m) => m.frames[0].id);
    expect(ids.sort()).toEqual(["fresh", "solo"]);
  });

  it("caps hold in the SECOND pass too, when the first pass leaves slots open", () => {
    // The plain frames are all of one person ("host"), who becomes over-exposed
    // after 3, so the soft first pass ends at 2 glasses + 3 host = 5 and the
    // second pass must fill the last 3. The glasses frames score higher, so a
    // second pass without the cap would take them.
    const glasses = Array.from({ length: 6 }, (_, i) =>
      frame(`g${i}`, i * 10, 0.9 - i * 0.01, { personIds: [`p${i}`], tags: ["glasses"] })
    );
    const plain = Array.from({ length: 6 }, (_, i) =>
      frame(`n${i}`, i * 10 + 5, 0.1, { personIds: ["host"] })
    );
    const picked = selectMoments(groupIntoMoments([...glasses, ...plain]), 8, { caps: { glasses: 2 } });
    expect(picked).toHaveLength(8);
    expect(picked.filter((m) => m.tags.includes("glasses"))).toHaveLength(2);
  });

  it("variety prefers a face unlike the ones already chosen", () => {
    const twinA = frame("a", 0, 0.9, { personIds: ["pa"] });
    const twinB = frame("b", 1, 0.85, { personIds: ["pb"] });
    const other = frame("c", 2, 0.8, { personIds: ["pc"] });
    const ms = groupIntoMoments([twinA, twinB, other]);
    const vec: Record<string, number[]> = { a: [1, 0], b: [0.99, 0.141], c: [0, 1] };
    const pick = (variety: number) =>
      selectMoments(ms, 2, {
        coverage: false,
        onePerPerson: true,
        facesOf: (m) => (vec[m.frames[0].id] ? [vec[m.frames[0].id]] : undefined),
        variety,
      }).map((m) => m.frames[0].id).sort();
    expect(pick(0)).toEqual(["a", "b"]); // score alone takes the look-alike
    expect(pick(1)).toEqual(["a", "c"]);
  });

  it("a moment with no known face is not favoured over a different-looking known one", () => {
    // a is chosen first. d's face is unknown and d ranks one place above c,
    // which looks unlike a. Most known faces look like a, so the AVERAGE
    // penalty an unknown face takes is high and c wins; a free pass would hand
    // the slot to d. Fillers make one rank step small, as in a real event
    // (percentiles are rank-based).
    const fillers = Array.from({ length: 6 }, (_, i) => frame(`e${i}`, 10 + i, 0.1, { personIds: [`pe${i}`] }));
    const ms = groupIntoMoments([
      frame("a", 0, 0.9, { personIds: ["pa"] }),
      frame("b", 1, 0.58, { personIds: ["pb"] }),
      frame("c", 2, 0.59, { personIds: ["pc"] }),
      frame("d", 3, 0.6, { personIds: ["pd"] }),
      ...fillers,
    ]);
    const vec: Record<string, number[]> = { a: [1, 0], b: [1, 0], c: [0, 1] };
    for (let i = 0; i < 6; i++) vec[`e${i}`] = [1, 0];
    const ids = selectMoments(ms, 2, {
      coverage: false,
      onePerPerson: true,
      facesOf: (m) => (vec[m.frames[0].id] ? [vec[m.frames[0].id]] : undefined),
      variety: 1,
    }).map((m) => m.frames[0].id).sort();
    expect(ids).toEqual(["a", "c"]);
  });
});

describe("selectMoments: who is the same person (second review, 2026-11-16)", () => {
  const near = (x: number) => [x, Math.sqrt(1 - x * x)]; // unit vector at cosine x to [1, 0]
  const pickIds = (frames: MomentInput[], n: number, vecs: Record<string, number[][]>, extra = {}) =>
    selectMoments(groupIntoMoments(frames), n, {
      onePerPerson: true,
      facesOf: (m) => vecs[m.frames[m.bestIndex].id],
      samePerson: 0.55,
      ...extra,
    }).map((m) => m.frames[m.bestIndex].id).sort();

  it("an unclustered guest is recognised by face, not by cluster id", () => {
    const ids = pickIds(
      [frame("g1", 0, 0.9), frame("g2", 30, 0.8), frame("other", 60, 0.1)],
      3,
      { g1: [[1, 0]], g2: [near(0.9)], other: [[0, 1]] }
    );
    expect(ids).toEqual(["g1", "other"]);
  });

  it("strangers below the same-person floor are both kept", () => {
    const ids = pickIds([frame("a", 0, 0.9), frame("b", 30, 0.8)], 2, { a: [[1, 0]], b: [near(0.36)] });
    expect(ids).toEqual(["a", "b"]);
  });

  it("a photo whose faces were never read is never picked unverified", () => {
    const ids = pickIds([frame("seen", 0, 0.5), frame("unread", 30, 0.9)], 2, { seen: [[1, 0]] });
    expect(ids).toEqual(["seen"]);
  });

  it("a group shot counts its SUBJECT faces: out only when most of them are already in", () => {
    const ids = pickIds(
      [frame("solo", 0, 0.9), frame("fresh", 30, 0.8, { tags: ["group"] }), frame("stale", 60, 0.7, { tags: ["group"] })],
      3,
      {
        solo: [[1, 0]],
        fresh: [[1, 0], [0, 1], [-1, 0], [0, -1]], // 1 of 4 already in
        stale: [[1, 0], near(0.95), [0, 1]], //       2 of 3 already in
      }
    );
    expect(ids).toEqual(["fresh", "solo"]);
  });

  it("only the chosen frame's people count, not the other booth in the same second", () => {
    const boothA = frame("boothA", 0, 0.9, { personIds: ["name:ana"] });
    const boothB = frame("boothB", 0, 0.2, { personIds: ["name:ben"] });
    const benLater = frame("benLater", 30, 0.5, { personIds: ["name:ben"] });
    const ids = selectMoments(groupIntoMoments([boothA, boothB, benLater]), 2, { onePerPerson: true })
      .map((m) => m.frames[m.bestIndex].id).sort();
    expect(ids).toEqual(["benLater", "boothA"]);
  });

  it("a pair is out when ONE of its two faces is already in (not a majority test)", () => {
    const ids = pickIds(
      [frame("solo", 0, 0.9), frame("pair", 30, 0.8), frame("other", 60, 0.1)],
      3,
      { solo: [[1, 0]], pair: [near(0.9), [0, 1]], other: [[-1, 0]] }
    );
    expect(ids).toEqual(["other", "solo"]);
  });

  it("a shared cluster blocks a repeat even when the two faces match below the floor", () => {
    // Clusters join through a running average: one person's two faces can sit
    // in one cluster yet match each other at 0.45 (11% of pairs at Team Curry).
    const ids = pickIds(
      [frame("luna1", 0, 0.9, { personIds: ["p-luna"] }), frame("luna2", 30, 0.8, { personIds: ["p-luna"] })],
      2,
      { luna1: [[1, 0]], luna2: [near(0.45)] }
    );
    expect(ids).toEqual(["luna1"]);
  });

  it("caps count the CHOSEN frame's tags, not another frame of the same moment", () => {
    // One moment: the chosen frame is plain, a weaker sibling is a glasses pose.
    const plain = frame("plain", 0, 0.9, { personIds: ["pa"] });
    const sibling = frame("sib", 0, 0.1, { personIds: ["pa"], tags: ["glasses"] });
    const g1 = frame("g1", 30, 0.5, { personIds: ["pb"], tags: ["glasses"] });
    const ids = selectMoments(groupIntoMoments([plain, sibling, g1]), 2, { caps: { glasses: 1 } })
      .map((m) => m.frames[m.bestIndex].id).sort();
    expect(ids).toEqual(["g1", "plain"]);
  });

  it("tied scores share a rank, so variety (not capture order) decides an unranked event", () => {
    // All scores equal. b resembles a a little (0.3), c not at all. Tied ranks
    // hand the second slot to c; ranking by capture order would give it to b.
    const ids = pickIds(
      [frame("a", 0, 0), frame("b", 10, 0), frame("c", 20, 0)],
      2,
      { a: [[1, 0]], b: [near(0.3)], c: [[0, 1]] },
      { coverage: false, variety: 1 }
    );
    expect(ids).toEqual(["a", "c"]);
  });
});

const facts = (over: Partial<FrameFacts>): FrameFacts => ({
  indexed: true,
  faces: 1,
  subjectFaces: 1,
  scores: { bw: 0.03 },
  ...over,
});

describe("rules", () => {
  // A color shoot: black-and-white scores mostly ~0.03, one edit at 0.08.
  const colorShoot = [...Array.from({ length: 99 }, () => ({ bw: 0.03 })), { bw: 0.08 }];
  const c = eventCutoffs(colorShoot);

  it("only humans: an indexed frame with no face is out", () => {
    expect(vetoReason(facts({ faces: 0, subjectFaces: 0 }), c)).toBe("no-face");
  });
  it("a frame no rule could score is out, indexed or not (review 2026-11-16)", () => {
    expect(vetoReason(facts({ indexed: false, faces: 0, subjectFaces: 0, scores: {} }), c)).toBe("unscored");
    expect(vetoReason(facts({ scores: {} }), c)).toBe("unscored");
  });
  it("bans apply at their cutoff, caps tag instead of banning", () => {
    expect(vetoReason(facts({ scores: { bw: 0.08 } }), c)).toBe("bw");
    expect(vetoReason(facts({ scores: { bw: 0.04, glasses: 0.2 } }), c)).toBeNull();
    expect(vetoReason(facts({ scores: { bw: 0.03, gear: 0.06 } }), c)).toBe("gear");
    expect(capTags(facts({ faces: 3, subjectFaces: 3, scores: { glasses: 0.2 } }), c).sort()).toEqual(["glasses", "group"]);
  });
  it("background faces do not make a group shot", () => {
    expect(capTags(facts({ faces: 5, subjectFaces: 1 }), c)).toEqual([]);
  });
  it("black and white is judged against its own event's MEDIAN (LinkedIn silver backdrop)", () => {
    const silver = eventCutoffs(Array.from({ length: 100 }, (_, i) => ({ bw: 0.07 + (i % 10) * 0.001 })));
    expect(vetoReason(facts({ faces: 2, scores: { bw: 0.078 } }), silver)).toBeNull();
    expect(vetoReason(facts({ faces: 2, scores: { bw: 0.078 } }), c)).toBe("bw");
    // Median, not mean: 70 frames at 0.03 and 30 at 0.09 put the median at
    // 0.03 (cutoff 0.055) and the mean at 0.048 (cutoff 0.073), so a 0.07
    // frame is banned only under the median.
    const skew = eventCutoffs([...Array(70).fill({ bw: 0.03 }), ...Array(30).fill({ bw: 0.09 })]);
    expect(vetoReason(facts({ scores: { bw: 0.07 } }), skew)).toBe("bw");
  });
  it("the baseline is the median, not a low percentile", () => {
    // 30% at 0.01, 70% at 0.05: median 0.05 (cutoff 0.075), 25th percentile
    // 0.01 (cutoff 0.035). A 0.06 frame is ordinary for this shoot.
    const shoot = eventCutoffs([...Array(30).fill({ bw: 0.01 }), ...Array(70).fill({ bw: 0.05 })]);
    expect(vetoReason(facts({ scores: { bw: 0.06 } }), shoot)).toBeNull();
  });
  it("frames of one capture within the sibling margin are not black-and-white versions", () => {
    expect(bwSiblings([
      { id: "a", capture: "t1", bw: 0.04 },
      { id: "b", capture: "t1", bw: 0.05 },
    ]).size).toBe(0);
  });
  it("a capture delivered in colour and black and white keeps only the colour frame", () => {
    const out = bwSiblings([
      { id: "color", capture: "t1", bw: 0.04 },
      { id: "mono", capture: "t1", bw: 0.09 },
      { id: "mono-logo", capture: "t1", bw: 0.085 },
      { id: "solo", capture: "t2", bw: 0.09 },
      { id: "untimed", capture: null, bw: 0.2 },
    ]);
    expect([...out].sort()).toEqual(["mono", "mono-logo"]);
  });
  it("a duplicate detection of one face is one face, so a pair is not a group", () => {
    const s2 = summarizeFaces([
      { person_id: "a", bbox_x: 0, bbox_y: 0, bbox_w: 100, bbox_h: 100, embedding: "[1]" },
      { person_id: null, bbox_x: 10, bbox_y: 10, bbox_w: 90, bbox_h: 90 }, // same face again, no embedding
      { person_id: "b", bbox_x: 200, bbox_y: 0, bbox_w: 100, bbox_h: 100, embedding: "[1]" },
    ]);
    expect(s2.faces).toBe(2);
    expect(s2.subjectFaces).toBe(2);
    expect(subjectFaceRows([
      { person_id: "a", bbox_x: 0, bbox_y: 0, bbox_w: 100, bbox_h: 100 },
      { person_id: null, bbox_x: 10, bbox_y: 10, bbox_w: 90, bbox_h: 90, embedding: "[1]" },
    ]).map((r) => r.person_id)).toEqual([null]); // the one WITH an embedding is kept
  });
  it("the black-and-white note never reads Infinity, and fires only on a high baseline", () => {
    expect(bwBaselineNote(eventCutoffs([]))).toBeNull();
    expect(bwBaselineNote(eventCutoffs(Array(10).fill({ bw: 0.03 })))).toBeNull();
    expect(bwBaselineNote(eventCutoffs(Array(10).fill({ bw: 0.07 })))).toBe("bw-baseline-high:0.070");
  });
  it("summarizeFaces counts every face but only comparable-size ones as subjects", () => {
    const s = summarizeFaces([
      { person_id: "sitter", bbox_w: 100, bbox_h: 100 },
      { person_id: "host-behind", bbox_w: 30, bbox_h: 30 },
      { person_id: null, bbox_w: 60, bbox_h: 60 },
    ]);
    expect(s.faces).toBe(3);
    expect(s.subjectFaces).toBe(2);
    expect(s.subjectPersonIds).toEqual(["sitter"]);
  });
});
