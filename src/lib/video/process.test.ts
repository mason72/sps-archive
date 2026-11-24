import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/r2/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/r2/client")>();
  return {
    ...real,
    getPresignedDownloadUrl: vi.fn(async (key: string) => `https://r2.test/get/${key}`),
    getPresignedUploadUrl: vi.fn(async (key: string) => `https://r2.test/put/${key}`),
  };
});
vi.mock("@/lib/usage/record", () => ({ recordUsage: vi.fn(async () => {}), secondsSince: () => 1 }));

import { getPresignedUploadUrl } from "@/lib/r2/client";
import { VideoMuteUnavailableError, mutePutTtlSeconds, processMutedVideoViaModal } from "./process";

const SRC = { url: "https://ezubznenjcogwocccznj.supabase.co/storage/v1/object/sign/p/clip.mp4?token=t" };
const KEYS = {
  stagedKey: "scout-staging/e1/abc.mp4",
  posterKey: "events/e1/originals/abc.mp4",
};
const MUTE_URL = "https://ws--sps-archive-video-mute-video.modal.run";
const okBody = (over: Record<string, unknown> = {}) =>
  ({ ok: true, duration_seconds: 3, width: 320, height: 240, has_audio: true, muted: true, ...over });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

let fetchMock: ReturnType<typeof vi.fn>;
const call = (over: { timeoutMs?: number; pollDelayMs?: number } = {}) =>
  processMutedVideoViaModal(SRC, KEYS, undefined, { fetchImpl: fetchMock as unknown as typeof fetch, pollDelayMs: 0, ...over });

beforeEach(() => {
  process.env.VIDEO_MUTE_URL = MUTE_URL;
  process.env.VIDEO_PIPELINE_URL = "https://ws--sps-archive-video-process-video.modal.run";
  fetchMock = vi.fn();
  vi.mocked(getPresignedUploadUrl).mockClear();
});
afterEach(() => {
  delete process.env.VIDEO_MUTE_URL;
  delete process.env.VIDEO_PIPELINE_URL;
});

describe("processMutedVideoViaModal", () => {
  it("calls the mute endpoint (never the upload pipeline's) with a STAGING key and posters", async () => {
    fetchMock.mockResolvedValue(json(okBody()));
    const r = await call();
    expect(r).toMatchObject({ ok: true, muted: true, durationSeconds: 3 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(MUTE_URL);
    expect(init.redirect).toBe("manual"); // never follows a redirect blindly
    const sent = JSON.parse(init.body);
    expect(sent.video_url).toBe(SRC.url);
    expect(sent.staged_put).toBe(`https://r2.test/put/${KEYS.stagedKey}`);
    expect(sent).not.toHaveProperty("display_put");
    expect(Object.keys(sent.poster_puts).sort()).toEqual(["lg", "md", "sm"]);
    const ttls = vi.mocked(getPresignedUploadUrl).mock.calls.map((c) => c[2]);
    expect(ttls).toEqual([300, 300, 300, 300]);
    expect(mutePutTtlSeconds(240_000)).toBe(300);
  });

  it("refuses to stage anywhere but scout-staging/", async () => {
    await expect(
      processMutedVideoViaModal(SRC, { stagedKey: "events/e1/originals/abc.mp4", posterKey: KEYS.posterKey })
    ).rejects.toThrow(/scout-staging/);
  });

  it("is unavailable (not a silent pass) when VIDEO_MUTE_URL is unset or the endpoint 404s", async () => {
    delete process.env.VIDEO_MUTE_URL;
    await expect(call()).rejects.toBeInstanceOf(VideoMuteUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();

    process.env.VIDEO_MUTE_URL = MUTE_URL;
    fetchMock.mockResolvedValue(new Response("Not Found", { status: 404 }));
    await expect(call()).rejects.toBeInstanceOf(VideoMuteUnavailableError);
  });

  it("follows Modal's 303 to a result URL on ITS OWN host, by GET, until the answer", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 303, headers: { location: `${MUTE_URL}/?__modal_function_call_id=fc-1` } }))
      .mockResolvedValueOnce(new Response(null, { status: 303, headers: { location: `/?__modal_function_call_id=fc-1` } }))
      .mockResolvedValueOnce(json(okBody()));
    await expect(call()).resolves.toMatchObject({ muted: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchMock.mock.calls.slice(1)) {
      expect(init.method).toBe("GET");
      expect(init.redirect).toBe("manual");
    }
  });

  it("pauses between repeated polls", async () => {
    const redirect = () => new Response(null, { status: 303, headers: { location: `${MUTE_URL}/?__modal_function_call_id=fc-1` } });
    fetchMock.mockResolvedValueOnce(redirect()).mockResolvedValueOnce(redirect()).mockResolvedValueOnce(redirect()).mockResolvedValueOnce(json(okBody()));
    const t0 = Date.now();
    await call({ pollDelayMs: 60 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(110); // two pauses: between poll 1-2 and 2-3
  });

  it("treats a 404 on the RESULT URL as an expired result, not a missing endpoint", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 303, headers: { location: `${MUTE_URL}/?__modal_function_call_id=fc-1` } }))
      .mockResolvedValueOnce(new Response("gone", { status: 404 }));
    const err = await call().then(() => null, (e) => e as Error);
    expect(err).not.toBeInstanceOf(VideoMuteUnavailableError);
    expect(err?.message).toMatch(/expired/);
  });

  it("refuses a redirect to another host, and any other redirect", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 303, headers: { location: "https://evil.test/x" } }));
    await expect(call()).rejects.toThrow(/off its own host/);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: `${MUTE_URL}/x` } }));
    await expect(call()).rejects.toThrow(/redirect \(302\)/);
  });

  it("refuses an answer that does not confirm muting", async () => {
    for (const body of [okBody({ muted: undefined }), okBody({ muted: false }), okBody({ muted: "true" })]) {
      fetchMock.mockResolvedValueOnce(json(body));
      await expect(call()).rejects.toThrow(/did not confirm a muted copy/);
    }
  });

  it("passes a clean codec rejection through for the caller to report", async () => {
    fetchMock.mockResolvedValue(json({ ok: false, error: "Unsupported video codec 'hevc'" }));
    await expect(call()).resolves.toMatchObject({ ok: false, error: /hevc/ });
  });

  it("never lets a signed URL from the pipeline's error text into the thrown message", async () => {
    const FAKE = "FAKE-TOKEN-0123456789abcdef";
    fetchMock.mockResolvedValue(
      new Response(`RuntimeError: ffprobe failed: ${SRC.url.split("?")[0]}?token=${FAKE}: Invalid data`, { status: 500 })
    );
    const err = await call().then(() => null, (e) => e as Error);
    expect(err?.message).toMatch(/\?<redacted>/);
    expect(err?.message).not.toContain(FAKE);
  });
});
