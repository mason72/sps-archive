import { describe, it, expect } from "vitest";
import { looksLikeSpsToken, maskToken, TOKEN_PREFIX_LENGTH } from "./connection";

/**
 * SPS shows the token exactly once, so a truncated or mistyped paste that only
 * surfaces at the first import reads as "the integration is broken". These are
 * the cheap checks that make a bad paste fail at the paste.
 */
describe("looksLikeSpsToken", () => {
  it("accepts a real-shaped token", () => {
    expect(looksLikeSpsToken("spsa_AwOrxqNZ3k-9_bQ7tYuIoP4sDfGhJkL2")).toBe(true);
  });

  it("tolerates surrounding whitespace from a clipboard paste", () => {
    expect(looksLikeSpsToken("  spsa_AwOrxqNZ3k-9_bQ7tYuIoP4sDfGhJkL2\n")).toBe(
      true
    );
  });

  it("rejects the truncated paste — the actual failure this guards", () => {
    expect(looksLikeSpsToken("spsa_AwOrxqN")).toBe(false);
  });

  it("rejects anything without the prefix, and empty input", () => {
    for (const bad of [
      "",
      "   ",
      "AwOrxqNZ3k-9_bQ7tYuIoP4sDfGhJkL2",
      "sps_AwOrxqNZ3k-9_bQ7tYuIoP4sDfGhJkL2",
      "spsa-AwOrxqNZ3k-9_bQ7tYuIoP4sDfGhJkL2",
      "Bearer spsa_AwOrxqNZ3k-9_bQ7tYuIoP4sDfGhJkL2",
    ]) {
      expect(looksLikeSpsToken(bad)).toBe(false);
    }
  });

  it("rejects a token carrying characters base64url never produces", () => {
    // A pasted line that picked up a trailing sentence is the classic version
    // of this (the Animul DMARC incident, in credential form).
    expect(
      looksLikeSpsToken("spsa_AwOrxqNZ3k-9_bQ7tYuIoP4sDfGhJkL2 — paste this")
    ).toBe(false);
  });
});

describe("maskToken", () => {
  it("shows enough to identify a key and never enough to use one", () => {
    const token = "spsa_AwOrxqNZ3k-9_bQ7tYuIoP4sDfGhJkL2";
    const masked = maskToken(token);

    expect(masked.length).toBeLessThan(token.length / 2);
    expect(token.includes(masked.replace("…", ""))).toBe(true);
  });

  it("matches SPS's own token_prefix exactly, so both panels agree", () => {
    // spsv2 mintArchiveToken(): prefix = token.slice(0, 12). If these drift, the
    // two settings screens show different prefixes for the same credential and
    // "is the right key installed?" becomes unanswerable.
    const token = "spsa_AwOrxqNZ3k-9_bQ7tYuIoP4sDfGhJkL2";
    expect(maskToken(token)).toBe(`${token.slice(0, TOKEN_PREFIX_LENGTH)}…`);
    expect(TOKEN_PREFIX_LENGTH).toBe(12);
  });
});
