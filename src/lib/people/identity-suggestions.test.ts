import { describe, expect, it } from "vitest";

import {
  AUTO_CONFIDENCE,
  AUTO_MARGIN,
  crewRunnerUp,
  decideAutoConfirm,
  decideCrewSuggestion,
  decideSuggestion,
  guestRunnerUp,
  type CrewHit,
  type MatchHit,
} from "./identity-suggestions";

const hit = (over: Partial<MatchHit>): MatchHit => ({
  matched_person_id: "ref-1",
  name_key: "stevenhughes",
  name: "Steven Hughes",
  face_count: 10,
  similarity: 0.9,
  ...over,
});

describe("decideSuggestion", () => {
  it("takes the best hit above the bar", () => {
    expect(decideSuggestion([hit({ similarity: 0.9 })], { selfId: "c", rejectedNames: [] }))
      .toMatchObject({ name: "Steven Hughes" });
  });

  it("suggests nothing below the bar — even a clear best", () => {
    // 0.54 is above every impostor ever measured (max 0.363) and STILL out:
    // the bar buys precision, and precision is the product.
    expect(decideSuggestion([hit({ similarity: 0.54 })], { selfId: "c", rejectedNames: [] }))
      .toBeNull();
  });

  it("never matches a cluster to itself", () => {
    expect(
      decideSuggestion([hit({ matched_person_id: "c", similarity: 0.99 })], {
        selfId: "c",
        rejectedNames: [],
      })
    ).toBeNull();
  });

  it("honours a rejected name but lets the next identity through", () => {
    const hits = [
      hit({ similarity: 0.9, name: "Steven Hughes", name_key: "stevenhughes" }),
      hit({
        similarity: 0.8,
        name: "Joe Delgado",
        name_key: "joedelgado",
        matched_person_id: "ref-2",
      }),
    ];
    expect(decideSuggestion(hits, { selfId: "c", rejectedNames: ["Steven Hughes"] }))
      .toMatchObject({ name: "Joe Delgado" });
  });

  it("rejects spelling variants of a rejected name", () => {
    expect(
      decideSuggestion([hit({ name: "steven hughes" })], {
        selfId: "c",
        rejectedNames: ["Steven Hughes"],
      })
    ).toBeNull();
  });

  it("never offers a name marked Not a person, and lets the next one through", () => {
    // The WEKA case (2026-09-11): a gallery label that had become reference
    // faces. An exclusion drops those references; this is the belt for a
    // reference that outlives its exclusion.
    const hits = [
      hit({ similarity: 0.93, name: "Weka SKO27", name_key: "wekasko" }),
      hit({
        similarity: 0.8,
        name: "Joe Delgado",
        name_key: "joedelgado",
        matched_person_id: "ref-2",
      }),
    ];
    expect(
      decideSuggestion(hits, {
        selfId: "c",
        rejectedNames: [],
        excludedKeys: new Set(["wekasko"]),
      })
    ).toMatchObject({ name: "Joe Delgado" });
  });

  it("stops at the first below-bar hit rather than scanning junk", () => {
    const hits = [
      hit({ similarity: 0.5 }),
      hit({ similarity: 0.95, name: "Should Never Reach", matched_person_id: "ref-9" }),
    ];
    // Hits arrive sorted best-first from SQL; a 0.95 AFTER a 0.5 would mean
    // the ordering contract broke, and trusting it would be trusting garbage.
    expect(decideSuggestion(hits, { selfId: "c", rejectedNames: [] })).toBeNull();
  });
});

const crewHit = (over: Partial<CrewHit>): CrewHit => ({
  crew_id: "crew-1",
  display_name: "Christie Jones",
  similarity: 0.9,
  ...over,
});

describe("decideCrewSuggestion", () => {
  it("takes a confident crew match", () => {
    expect(decideCrewSuggestion([crewHit({})], { rejectedNames: [] }))
      .toMatchObject({ display_name: "Christie Jones" });
  });
  it("suggests nothing below the bar", () => {
    expect(decideCrewSuggestion([crewHit({ similarity: 0.5 })], { rejectedNames: [] })).toBeNull();
  });
  it("honours a rejected crew name and falls to the next crew", () => {
    const hits = [
      crewHit({ similarity: 0.9 }),
      crewHit({ similarity: 0.8, crew_id: "crew-2", display_name: "Joey Nagoshiner" }),
    ];
    expect(decideCrewSuggestion(hits, { rejectedNames: ["Christie Jones"] }))
      .toMatchObject({ display_name: "Joey Nagoshiner" });
  });
});

describe("decideAutoConfirm", () => {
  it("applies a sure match with a clear runner-up", () => {
    expect(decideAutoConfirm(0.86, 0.31, { clusterNamed: false })).toEqual({ auto: true });
  });

  it("applies a sure match with no runner-up at all", () => {
    expect(decideAutoConfirm(0.72, null, { clusterNamed: false })).toEqual({ auto: true });
  });

  it("holds anything under the line for a person — even with no competition", () => {
    // 0.69 is far above every rejection ever recorded (max 0.58) and STILL
    // held: the line is the decision Mason made, not a guess.
    expect(decideAutoConfirm(0.69, null, { clusterNamed: false }))
      .toEqual({ auto: false, reason: "confidence" });
    expect(AUTO_CONFIDENCE).toBe(0.7);
  });

  it("holds a match whose runner-up is a different identity within the margin", () => {
    // Measured: one human under two filename names scores ~0.95 against both.
    // That is an alias decision, and aliases are a person's call.
    expect(decideAutoConfirm(0.953, 0.945, { clusterNamed: false }))
      .toEqual({ auto: false, reason: "margin" });
    // Either side of the margin, clear of float noise at the boundary.
    expect(decideAutoConfirm(0.8, 0.8 - AUTO_MARGIN - 0.01, { clusterNamed: false })).toEqual({ auto: true });
    expect(decideAutoConfirm(0.8, 0.8 - AUTO_MARGIN + 0.01, { clusterNamed: false }))
      .toEqual({ auto: false, reason: "margin" });
  });

  it("never decides a NAMED cluster — overriding a label is a correction", () => {
    expect(decideAutoConfirm(0.99, null, { clusterNamed: true }))
      .toEqual({ auto: false, reason: "named" });
  });
});

describe("runner-up", () => {
  it("skips the cluster itself and other clusters of the same identity", () => {
    const best = hit({ matched_person_id: "ref-1", name_key: "stevenhughes", similarity: 0.9 });
    const hits = [
      best,
      hit({ matched_person_id: "self", name_key: "someoneelse", similarity: 0.88 }),
      hit({ matched_person_id: "ref-2", name_key: "stevenhughes", similarity: 0.85 }),
      hit({ matched_person_id: "ref-3", name_key: "bridgerlarsen", similarity: 0.41 }),
    ];
    expect(guestRunnerUp(hits, best, "self")).toBe(0.41);
    expect(guestRunnerUp([best], best, "self")).toBeNull();
  });

  it("crew: the strongest OTHER crew member", () => {
    const best: CrewHit = { crew_id: "c1", display_name: "Christie", similarity: 0.91 };
    expect(crewRunnerUp([best, { crew_id: "c2", display_name: "Joey", similarity: 0.33 }], best)).toBe(0.33);
    expect(crewRunnerUp([best], best)).toBeNull();
  });
});
