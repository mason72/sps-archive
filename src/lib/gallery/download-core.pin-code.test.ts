import { describe, it, expect, vi } from "vitest";

/**
 * `code: "pin_required"` is the ONE signal the guest gallery re-prompts for a
 * PIN on (lesson 199). Since every share's single-photo downloads go through
 * /image-download, a refusal a PIN cannot fix (a lapsed password, downloads
 * switched off, a PIN gallery with no PIN set) must never carry it, or the
 * guest loops on a prompt that can never succeed.
 */

vi.mock("@/lib/security/rate-limit", () => ({
  checkAuthRateLimit: async () => true,
}));
vi.mock("@/lib/shares/download-token", () => ({
  verifyDownloadToken: () => false,
}));

import { authorizeShareDownload } from "./download-core";

const baseShare = {
  id: "share-1",
  slug: "abc123",
  event_id: "event-1",
  is_active: true,
  expires_at: null,
  share_type: "full",
  image_ids: null,
  allow_download: true,
  password_hash: null,
  require_pin_individual: true,
  require_pin_bulk: false,
  download_pin: "4321",
};

function client(share: Record<string, unknown>) {
  const q: Record<string, unknown> = {};
  for (const fn of ["select", "eq"]) q[fn] = () => q;
  q.single = async () => ({ data: share, error: null });
  return { from: () => q } as unknown as Parameters<typeof authorizeShareDownload>[0];
}

const ask = (share: Record<string, unknown>, opts: { pin?: string; cookie?: string } = {}) =>
  authorizeShareDownload(client(share), "abc123", {
    cookieShareId: opts.cookie ?? null,
    downloadToken: null,
    pin: opts.pin ?? null,
    ip: "203.0.113.7",
    kind: "individual",
  });

describe("authorizeShareDownload: the PIN re-prompt code", () => {
  it("carries code pin_required when a correct PIN would get through", async () => {
    const res = await ask(baseShare, { pin: "0000" });
    expect(res).toMatchObject({ ok: false, status: 403, code: "pin_required" });
    expect(await ask(baseShare, { pin: "4321" })).toMatchObject({ ok: true });
  });

  it("carries no code when no PIN could fix it", async () => {
    const refusals = [
      // downloads switched off
      await ask({ ...baseShare, allow_download: false }),
      // the password session has lapsed
      await ask({ ...baseShare, password_hash: "h" }),
      // a PIN gallery with the PIN cleared: locked for everyone
      await ask({ ...baseShare, download_pin: null }),
    ];
    for (const res of refusals) {
      expect(res.ok).toBe(false);
      expect(res).not.toHaveProperty("code");
    }
  });
});
