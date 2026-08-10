import { describe, expect, it } from "vitest";
import {
  costOf,
  ESTIMATED_THUMB_RATIO,
  KIND_UNIT_COST,
  storageCostPerMonth,
} from "./costs";
import { secondsSince } from "./record";

describe("usage costs", () => {
  it("prices every kind non-negatively, with the GPU lanes costing the most per second", () => {
    for (const [kind, price] of Object.entries(KIND_UNIT_COST)) {
      expect(price, kind).toBeGreaterThanOrEqual(0);
    }
    // T4 lanes must out-price CPU lanes — if a price edit inverts this,
    // something was fat-fingered.
    expect(KIND_UNIT_COST.ai_index).toBeGreaterThan(KIND_UNIT_COST.ai_embed_text);
    expect(KIND_UNIT_COST.ai_index).toBeGreaterThan(KIND_UNIT_COST.video_process);
  });

  it("computes flow and stock costs", () => {
    // 100 GPU-seconds of indexing at the T4 rate.
    expect(costOf("ai_index", 100)).toBeCloseTo(0.0164, 5);
    // 100 GB held for a month.
    expect(storageCostPerMonth(100e9)).toBeCloseTo(1.5, 5);
  });

  it("keeps the thumbnail estimate in a sane band", () => {
    // 3 mozjpeg variants of a multi-MB original are a few percent of it.
    // A typo (0.3, 3) would silently multiply storage bills.
    expect(ESTIMATED_THUMB_RATIO).toBeGreaterThan(0);
    expect(ESTIMATED_THUMB_RATIO).toBeLessThan(0.1);
  });

  it("measures elapsed seconds", () => {
    const started = Date.now() - 1500;
    const s = secondsSince(started);
    expect(s).toBeGreaterThanOrEqual(1.5);
    expect(s).toBeLessThan(2.5);
  });
});
