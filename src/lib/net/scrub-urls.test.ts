import { describe, it, expect } from "vitest";
import { scrubSignedUrls, scrubbedError } from "./scrub-urls";

const FAKE = "FAKE-TOKEN-0123456789abcdef";

describe("scrubSignedUrls", () => {
  it("removes every query string, keeps the path", () => {
    const msg =
      `ffprobe failed: https://ezubznenjcogwocccznj.supabase.co/storage/v1/object/sign/p/c.mp4?token=${FAKE}&x=1: ` +
      `Invalid data; then "https://acct.r2.cloudflarestorage.com/b/k.mp4?X-Amz-Signature=${FAKE}"`;
    const out = scrubSignedUrls(msg);
    expect(out).not.toContain(FAKE);
    expect(out).toContain("/storage/v1/object/sign/p/c.mp4?<redacted>");
    expect(out).toContain("/b/k.mp4?<redacted>");
  });

  it("leaves text without a URL alone", () => {
    expect(scrubSignedUrls("timed out after 240 s")).toBe("timed out after 240 s");
  });

  it("scrubs an Error's message and keeps its name", () => {
    const e = new TypeError(`fetch https://h.test/a?sig=${FAKE} failed`);
    const out = scrubbedError(e);
    expect(out.message).not.toContain(FAKE);
    expect(out.name).toBe("TypeError");
  });
});
