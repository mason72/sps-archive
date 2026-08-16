import { describe, expect, it } from "vitest";

import { decideSuggestion, type MatchHit } from "./identity-suggestions";

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
