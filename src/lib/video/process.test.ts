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

import { processMutedVideoViaModal } from "./process";

const SRC = { url: "https://ezubznenjcogwocccznj.supabase.co/storage/v1/object/sign/p/clip.mp4?token=t" };
const DEST = "events/e1/originals/abc.mp4";
const okBody = (over: Record<string, unknown> = {}) =>
  ({ ok: true, duration_seconds: 3, width: 320, height: 240, has_audio: true, muted: true, ...over });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  process.env.VIDEO_PIPELINE_URL = "https://modal.test/process_video";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.VIDEO_PIPELINE_URL;
});

describe("processMutedVideoViaModal", () => {
  it("asks for a muted rendition written to the stored key, posters beside it", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(okBody())));
    const r = await processMutedVideoViaModal(SRC, DEST);
    expect(r).toMatchObject({ ok: true, muted: true, durationSeconds: 3 });

    const [, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse(init.body);
    expect(sent.mute).toBe(true);
    expect(sent.video_url).toBe(SRC.url); // Scout's URL: no copy with sound in our storage
    const { getPresignedUploadUrl } = await import("@/lib/r2/client");
    // Upload URLs live as long as the call may wait plus a minute, not an hour.
    const ttls = vi.mocked(getPresignedUploadUrl).mock.calls.map((c) => c[2]);
    expect(ttls).toEqual([300, 300, 300, 300]);
    expect(sent.display_put).toBe(`https://r2.test/put/${DEST}`);
    expect(Object.keys(sent.poster_puts).sort()).toEqual(["lg", "md", "sm"]);
    expect(init.signal).toBeInstanceOf(AbortSignal); // never an unbounded wait
  });

  it("refuses an answer that does not confirm muting (an older deployment ignores `mute`)", async () => {
    for (const body of [okBody({ muted: undefined }), okBody({ muted: false }), okBody({ muted: "true" })]) {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
      await expect(processMutedVideoViaModal(SRC, DEST)).rejects.toThrow(/did not confirm a muted rendition/);
    }
  });

  it("passes a clean codec rejection through for the caller to report", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: false, error: "Unsupported video codec 'hevc'" })));
    await expect(processMutedVideoViaModal(SRC, DEST)).resolves.toMatchObject({ ok: false, error: /hevc/ });
  });

  it("never lets a signed URL from the pipeline's error text into the thrown message", async () => {
    const FAKE = "FAKE-TOKEN-0123456789abcdef";
    fetchMock.mockResolvedValue(
      new Response(`RuntimeError: ffprobe failed: ${SRC.url.split("?")[0]}?token=${FAKE}: Invalid data`, { status: 500 })
    );
    const err = await processMutedVideoViaModal(SRC, DEST).then(() => null, (e) => e as Error);
    expect(err?.message).toMatch(/\?<redacted>/);
    expect(err?.message).not.toContain(FAKE);
  });

  it("throws on a pipeline error, a missing endpoint, or a non-mp4 destination", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    await expect(processMutedVideoViaModal(SRC, DEST)).rejects.toThrow(/500/);
    await expect(processMutedVideoViaModal(SRC, "events/e1/originals/abc.mov")).rejects.toThrow(/\.mp4/);
    delete process.env.VIDEO_PIPELINE_URL;
    await expect(processMutedVideoViaModal(SRC, DEST)).rejects.toThrow(/VIDEO_PIPELINE_URL/);
  });
});
