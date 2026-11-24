import { describe, it, expect } from "vitest";
import { orderTrainingCandidates } from "./direction";

const row = (id: string, eventDate: string | null, createdAt: string) => ({
  id,
  event_id: `e-${id}`,
  events: { event_date: eventDate, created_at: createdAt },
});

describe("orderTrainingCandidates", () => {
  it("ranks past sets by when the event HAPPENED, not when the gallery was created", () => {
    // 2026-11-23: the Pixieset migration created 1,028 galleries from 2014-2023
    // on Oct 30-31 2026; ordered by created_at they filled the 40-set window and
    // only 2 real sets were left to learn from.
    const ordered = orderTrainingCandidates([
      row("pet-2015", "2015-01-25", "2026-10-31T10:00:00Z"),
      row("wedding-2017", "2017-09-23", "2026-10-30T10:00:00Z"),
      row("ebay-2026", "2026-07-15", "2026-07-16T10:00:00Z"),
      row("stripe-2026", "2026-11-18", "2026-11-19T10:00:00Z"),
    ]);
    expect(ordered.map((s) => s.id)).toEqual(["stripe-2026", "ebay-2026", "wedding-2017", "pet-2015"]);
  });

  it("falls back to the creation date for an undated gallery, and breaks ties by id", () => {
    const ordered = orderTrainingCandidates([
      row("b", "2026-05-01", "2026-05-02T00:00:00Z"),
      row("undated", null, "2026-06-01T00:00:00Z"),
      row("a", "2026-05-01", "2026-05-02T00:00:00Z"),
    ]);
    expect(ordered.map((s) => s.id)).toEqual(["undated", "a", "b"]);
  });

  it("keeps the event id for the reader", () => {
    expect(orderTrainingCandidates([row("x", "2026-01-01", "2026-01-01T00:00:00Z")])[0]).toEqual({
      id: "x",
      eventId: "e-x",
    });
  });
});

import { isHeadshotGallery, referenceVector, HEADSHOT_MIN_PHOTOS, MIN_REFERENCE_PHOTOS } from "./headshot-reference";
import { EMBEDDING_DIM } from "./direction";

describe("isHeadshotGallery (calibrated 2026-11-23 on 12 galleries)", () => {
  const gallery = (oneFaceShare: number, n = 200) =>
    Array.from({ length: n }, (_, i) => (i < Math.round(n * oneFaceShare) ? 1 : 3));
  it("headshot lounges measured 0.92 to 1.00 one-face: headshot", () => {
    for (const share of [0.92, 0.95, 1]) expect(isHeadshotGallery(gallery(share))).toBe(true);
  });
  it("events and parties measured 0.06 to 0.28: not headshot", () => {
    for (const share of [0.06, 0.24, 0.28, 0.6]) expect(isHeadshotGallery(gallery(share))).toBe(false);
  });
  it("too few photos to judge: not headshot (the learned path stays)", () => {
    expect(isHeadshotGallery(gallery(1, HEADSHOT_MIN_PHOTOS - 1))).toBe(false);
  });
});

describe("referenceVector", () => {
  const unit = (i: number) => {
    const v = new Float32Array(EMBEDDING_DIM);
    v[i % EMBEDDING_DIM] = 1;
    return v;
  };
  it("is unit length and null below the minimum sample", () => {
    expect(referenceVector(Array.from({ length: MIN_REFERENCE_PHOTOS - 1 }, (_, i) => unit(i)))).toBeNull();
    const r = referenceVector(Array.from({ length: MIN_REFERENCE_PHOTOS }, (_, i) => unit(i)))!;
    expect(Math.hypot(...r)).toBeCloseTo(1, 6);
  });
});
