import { describe, it, expect } from "vitest";
import {
  AI_INDEX_MAX_ATTEMPTS,
  AI_INDEX_RETRY_AFTER_MINUTES,
  aiIndexEligibleFilter,
  batchFailures,
} from "./failures";

describe("batchFailures", () => {
  it("records ids Modal reported in errors", () => {
    const r = batchFailures(["a", "b", "c"], {
      results: { a: {}, c: {} },
      errors: { b: "HTTP 503 fetching thumb" },
    });
    expect(r).toEqual({ ids: ["b"], messages: ["HTTP 503 fetching thumb"] });
  });

  it("treats an id missing from BOTH maps as a failure, not as nothing", () => {
    const r = batchFailures(["a", "b"], { results: { a: {} }, errors: {} });
    expect(r.ids).toEqual(["b"]);
    expect(r.messages[0]).toMatch(/missing/);
  });

  it("a result wins over an error for the same id", () => {
    const r = batchFailures(["a"], { results: { a: {} }, errors: { a: "late" } });
    expect(r.ids).toEqual([]);
  });

  it("an all-failed batch marks every id, so the next select moves past them", () => {
    const ids = Array.from({ length: 100 }, (_, i) => `id${i}`);
    const r = batchFailures(ids, {
      results: {},
      errors: Object.fromEntries(ids.map((id) => [id, "boom"])),
    });
    expect(r.ids).toHaveLength(100);
  });

  it("never records a presigned URL's signature from an httpx error", () => {
    const msg =
      "Client error '403 Forbidden' for url 'https://acct.r2.cloudflarestorage.com/sps-prism/events/e1/thumb-lg/x.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIA123%2F20260914&X-Amz-Signature=deadbeef'\nFor more information";
    const r = batchFailures(["a"], { results: {}, errors: { a: msg } });
    expect(r.messages[0]).not.toMatch(/Amz|AKIA|deadbeef/);
    expect(r.messages[0]).toContain("thumb-lg/x.jpg?[redacted]'");
  });

  it("ignores stray ids Modal returned that were not in the batch", () => {
    const r = batchFailures(["a"], { results: { a: {} }, errors: { zzz: "x" } });
    expect(r.ids).toEqual([]);
  });
});

describe("aiIndexEligibleFilter", () => {
  it("admits never-failed images, and failed ones only past the cool-down and under the cap", () => {
    const now = new Date("2026-09-14T12:00:00.000Z");
    const cutoff = new Date(
      now.getTime() - AI_INDEX_RETRY_AFTER_MINUTES * 60_000
    ).toISOString();
    expect(aiIndexEligibleFilter(now)).toBe(
      `ai_index_attempts.eq.0,and(ai_index_attempts.lt.${AI_INDEX_MAX_ATTEMPTS},ai_index_failed_at.lt.${cutoff})`
    );
  });

  it("gives up after a bounded number of tries spaced at least an hour apart", () => {
    // Guard against someone "fixing" a transient-looking failure by retrying
    // immediately and endlessly: all 34 real failures in 30 days recovered on
    // a later pass, so tries must be spaced, and they must end.
    expect(AI_INDEX_MAX_ATTEMPTS).toBeGreaterThanOrEqual(2);
    expect(AI_INDEX_MAX_ATTEMPTS).toBeLessThanOrEqual(10);
    expect(AI_INDEX_RETRY_AFTER_MINUTES).toBeGreaterThanOrEqual(30);
  });
});
