import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, timingSafeEqualStr } from "./hash";

describe("hashPassword / verifyPassword", () => {
  it("round-trips a PBKDF2 hash", async () => {
    const stored = await hashPassword("gallery-secret-1");
    expect(stored.startsWith("pbkdf2:310000:")).toBe(true);
    expect(await verifyPassword("gallery-secret-1", stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
  });

  it("produces unique salts per hash", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same", a)).toBe(true);
    expect(await verifyPassword("same", b)).toBe(true);
  });

  it("still verifies legacy salted-SHA-256 hashes", async () => {
    // Recreate the legacy format: "<salt>:<sha256(salt + password)>"
    const salt = "legacy-salt";
    const data = new TextEncoder().encode(salt + "old-password");
    const digest = await crypto.subtle.digest("SHA-256", data);
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const legacy = `${salt}:${hex}`;

    expect(await verifyPassword("old-password", legacy)).toBe(true);
    expect(await verifyPassword("not-it", legacy)).toBe(false);
  });

  it("rejects malformed stored hashes", async () => {
    expect(await verifyPassword("x", "garbage")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2:nope")).toBe(false);
  });
});

describe("timingSafeEqualStr", () => {
  it("matches equal strings and rejects unequal", () => {
    expect(timingSafeEqualStr("abcd", "abcd")).toBe(true);
    expect(timingSafeEqualStr("abcd", "abce")).toBe(false);
    expect(timingSafeEqualStr("abcd", "abcde")).toBe(false);
    expect(timingSafeEqualStr("", "")).toBe(true);
  });
});
