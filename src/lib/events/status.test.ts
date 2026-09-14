import { describe, it, expect } from "vitest";
import { isAiReady } from "./status";

describe("isAiReady", () => {
  it("is ready when every settled photo is indexed", () => {
    expect(isAiReady({ total: 10, indexed: 10, uploading: 0, gaveUp: 0 })).toBe(true);
  });

  it("a given-up photo settles the gallery instead of holding it open forever", () => {
    // The bug: 9 indexed + 1 photo Modal failed 3 times read as "processing" for good.
    expect(isAiReady({ total: 10, indexed: 9, uploading: 0, gaveUp: 1 })).toBe(true);
  });

  it("photos still waiting (or cooling down between retries) keep it open", () => {
    expect(isAiReady({ total: 10, indexed: 8, uploading: 0, gaveUp: 1 })).toBe(false);
  });

  it("uploads in flight keep it open even when the counts add up", () => {
    expect(isAiReady({ total: 10, indexed: 9, uploading: 2, gaveUp: 1 })).toBe(false);
  });

  it("an empty gallery is not ready, it is empty", () => {
    expect(isAiReady({ total: 0, indexed: 0, uploading: 0, gaveUp: 0 })).toBe(false);
  });

  it("a response from before gaveUp existed still reads the old way", () => {
    expect(isAiReady({ total: 10, indexed: 10, uploading: 0 })).toBe(true);
    expect(isAiReady({ total: 10, indexed: 9, uploading: 0 })).toBe(false);
  });

  it("a gallery where every photo was given up on is settled, not stuck", () => {
    expect(isAiReady({ total: 3, indexed: 0, uploading: 0, gaveUp: 3 })).toBe(true);
  });
});
