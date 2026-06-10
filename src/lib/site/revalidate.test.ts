import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleSiteRevalidate } from "./revalidate";

// Outside a Next request scope, after() throws and the module falls back to a
// detached promise — which is exactly what these tests drive with fake timers.

const URL_ENV = "https://site.test/api/revalidate";

describe("scheduleSiteRevalidate", () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response("ok")));

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("TDP_SITE_REVALIDATE_URL", URL_ENV);
    vi.stubEnv("TDP_SITE_REVALIDATE_SECRET", "s3cret");
    fetchMock.mockClear();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("skips silently when the URL env is unset", async () => {
    vi.stubEnv("TDP_SITE_REVALIDATE_URL", "");
    scheduleSiteRevalidate();
    await vi.runAllTimersAsync();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pings once after the debounce window, with the key", async () => {
    scheduleSiteRevalidate();
    expect(fetchMock).not.toHaveBeenCalled(); // trailing, not leading
    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`${URL_ENV}?key=s3cret`, {
      headers: undefined,
    });
  });

  it("collapses a burst of edits into a single ping", async () => {
    for (let i = 0; i < 20; i++) scheduleSiteRevalidate();
    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the Vercel protection-bypass header when configured", async () => {
    vi.stubEnv("TDP_SITE_REVALIDATE_BYPASS", "bypass-secret");
    scheduleSiteRevalidate();
    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledWith(`${URL_ENV}?key=s3cret`, {
      headers: { "x-vercel-protection-bypass": "bypass-secret" },
    });
  });

  it("never throws on a failed ping — warns instead", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    scheduleSiteRevalidate();
    await vi.runAllTimersAsync();
    expect(warn).toHaveBeenCalledWith(
      "[site-revalidate] ping failed:",
      expect.any(Error)
    );
    warn.mockRestore();
  });
});
