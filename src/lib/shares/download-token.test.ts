import { describe, it, expect } from "vitest";
import { createDownloadToken, verifyDownloadToken } from "./download-token";

const SECRET = "test-secret";
const SHARE = "10cdeae4-c2fe-463b-ad2d-792ab5392380";

describe("download tokens", () => {
  it("round-trips for the same share", () => {
    const token = createDownloadToken(SHARE, 3600, SECRET);
    expect(verifyDownloadToken(token, SHARE, SECRET)).toBe(true);
  });

  it("rejects a token for a different share", () => {
    const token = createDownloadToken(SHARE, 3600, SECRET);
    expect(verifyDownloadToken(token, "other-share-id", SECRET)).toBe(false);
  });

  it("rejects an expired token", () => {
    const token = createDownloadToken(SHARE, -10, SECRET);
    expect(verifyDownloadToken(token, SHARE, SECRET)).toBe(false);
  });

  it("rejects a tampered expiry (signature covers it)", () => {
    const token = createDownloadToken(SHARE, 60, SECRET);
    const [exp, sig] = token.split(".");
    const forged = `${Number(exp) + 999999}.${sig}`;
    expect(verifyDownloadToken(forged, SHARE, SECRET)).toBe(false);
  });

  it("rejects garbage", () => {
    expect(verifyDownloadToken("", SHARE, SECRET)).toBe(false);
    expect(verifyDownloadToken("nodot", SHARE, SECRET)).toBe(false);
    expect(verifyDownloadToken(".sigonly", SHARE, SECRET)).toBe(false);
    expect(verifyDownloadToken("123.", SHARE, SECRET)).toBe(false);
  });

  it("rejects a token signed with a different secret", () => {
    const token = createDownloadToken(SHARE, 3600, "other-secret");
    expect(verifyDownloadToken(token, SHARE, SECRET)).toBe(false);
  });
});
