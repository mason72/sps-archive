import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Wrap the real constant-time compare in a spy, so the test can prove the key
// check goes THROUGH it (a plain === would pass every other assertion here).
vi.mock("@/lib/shares/hash", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/shares/hash")>();
  return { ...real, timingSafeEqualStr: vi.fn(real.timingSafeEqualStr) };
});

import { timingSafeEqualStr } from "@/lib/shares/hash";
import { checkScoutKey, requireScoutKey } from "./auth";

const KEY = "s3cret-scout-key-0123456789";
const req = (key?: string) =>
  new Request("https://app.pixeltrunk.com/api/integrations/scout/publish-targets", {
    headers: key === undefined ? {} : { "X-Scout-Key": key },
  });

describe("checkScoutKey", () => {
  // Block body: a function returned from beforeEach is run as its teardown.
  beforeEach(() => {
    vi.mocked(timingSafeEqualStr).mockClear();
  });

  it("is 503 when the server has no key, whatever is presented (never open)", () => {
    for (const configured of [undefined, null, ""]) {
      const v = checkScoutKey(KEY, configured);
      expect(v).toMatchObject({ ok: false, status: 503 });
      expect(!v.ok && v.error).toMatch(/SCOUT_INTEGRATION_KEY/);
    }
    expect(checkScoutKey(undefined, undefined)).toMatchObject({ ok: false, status: 503 });
  });

  it("is 401 for a missing or wrong key", () => {
    expect(checkScoutKey(null, KEY)).toMatchObject({ ok: false, status: 401 });
    expect(checkScoutKey("", KEY)).toMatchObject({ ok: false, status: 401 });
    expect(checkScoutKey(KEY + "x", KEY)).toMatchObject({ ok: false, status: 401 });
    expect(checkScoutKey(KEY.slice(0, -1) + "Z", KEY)).toMatchObject({ ok: false, status: 401 });
    expect(checkScoutKey(KEY.toUpperCase(), KEY)).toMatchObject({ ok: false, status: 401 });
  });

  it("accepts the exact key, compared in constant time", () => {
    expect(checkScoutKey(KEY, KEY)).toEqual({ ok: true });
    expect(timingSafeEqualStr).toHaveBeenCalledWith(KEY, KEY);
    vi.mocked(timingSafeEqualStr).mockClear();
    checkScoutKey("wrong-but-same-length-key!!", KEY);
    expect(timingSafeEqualStr).toHaveBeenCalledTimes(1);
  });
});

describe("requireScoutKey (reads the header and the env)", () => {
  const saved = process.env.SCOUT_INTEGRATION_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.SCOUT_INTEGRATION_KEY;
    else process.env.SCOUT_INTEGRATION_KEY = saved;
  });

  it("answers 503 with a clear message when the env var is missing", async () => {
    delete process.env.SCOUT_INTEGRATION_KEY;
    const res = requireScoutKey(req(KEY));
    expect(res?.status).toBe(503);
    expect((await res!.json()).error).toMatch(/not configured/);
  });

  it("answers 401 for no header and for a wrong key", async () => {
    process.env.SCOUT_INTEGRATION_KEY = KEY;
    expect(requireScoutKey(req())?.status).toBe(401);
    expect(requireScoutKey(req("nope"))?.status).toBe(401);
  });

  it("lets the right key through", () => {
    process.env.SCOUT_INTEGRATION_KEY = KEY;
    expect(requireScoutKey(req(KEY))).toBeNull();
  });
});
