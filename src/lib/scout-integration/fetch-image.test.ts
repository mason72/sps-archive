import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchCapped, fetchPostcardImage, fetchPostcardVideo, looksLikeJpeg, PostcardFetchError } from "./fetch-image";

const URL_OK = "https://ezubznenjcogwocccznj.supabase.co/storage/v1/object/sign/scout-photos/a.jpg?token=t";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

function streamOf(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(ch);
      c.close();
    },
  });
}
const fakeFetch = (res: Response) => vi.fn(async () => res) as unknown as typeof fetch;

async function failsWith(p: Promise<unknown>, status: number) {
  const err = await p.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(PostcardFetchError);
  expect((err as PostcardFetchError).status).toBe(status);
}

describe("fetchPostcardImage", () => {
  it("returns the bytes of a JPEG and refuses redirects", async () => {
    const f = fakeFetch(new Response(streamOf([JPEG])));
    const buf = await fetchPostcardImage(URL_OK, { fetchImpl: f });
    expect([...buf]).toEqual([...JPEG]);
    expect(vi.mocked(f).mock.calls[0][1]).toMatchObject({ redirect: "error" });
  });

  it("never fetches a URL outside Scout's storage", async () => {
    const f = fakeFetch(new Response(streamOf([JPEG])));
    await failsWith(fetchPostcardImage("https://example.com/storage/v1/object/a.jpg", { fetchImpl: f }), 400);
    expect(f).not.toHaveBeenCalled();
  });

  it("is 413 by declared length and by counted bytes", async () => {
    await failsWith(
      fetchPostcardImage(URL_OK, {
        fetchImpl: fakeFetch(new Response(streamOf([JPEG]), { headers: { "content-length": "999" } })),
        maxBytes: 10,
      }),
      413
    );
    await failsWith(
      fetchPostcardImage(URL_OK, { fetchImpl: fakeFetch(new Response(streamOf([JPEG, JPEG]))), maxBytes: 10 }),
      413
    );
  });

  it("is 415 for bytes that are not a JPEG, whatever the headers say", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    await failsWith(
      fetchPostcardImage(URL_OK, {
        fetchImpl: fakeFetch(new Response(streamOf([png]), { headers: { "content-type": "image/jpeg" } })),
      }),
      415
    );
  });

  it("is 502 when storage answers an error, the body is empty, or the network fails", async () => {
    await failsWith(fetchPostcardImage(URL_OK, { fetchImpl: fakeFetch(new Response("expired", { status: 400 })) }), 502);
    await failsWith(fetchPostcardImage(URL_OK, { fetchImpl: fakeFetch(new Response(streamOf([]))) }), 502);
    const boom = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await failsWith(fetchPostcardImage(URL_OK, { fetchImpl: boom }), 502);
  });

  it("knows a JPEG by its first three bytes", () => {
    expect(looksLikeJpeg(JPEG)).toBe(true);
    expect(looksLikeJpeg(new Uint8Array([0xff, 0xd8]))).toBe(false);
  });
});

describe("fetchPostcardVideo", () => {
  const VIDEO_URL = "https://ezubznenjcogwocccznj.supabase.co/storage/v1/object/sign/scout-postcards/u/1.mp4?token=t";
  const mp4 = new Uint8Array(readFileSync(join(__dirname, "../video/__fixtures__/tone-with-audio.mp4")));

  it("returns an MP4 with a video track, with redirects refused", async () => {
    const f = fakeFetch(new Response(streamOf([mp4])));
    const buf = await fetchPostcardVideo(VIDEO_URL, { fetchImpl: f });
    expect(buf.byteLength).toBe(mp4.byteLength);
    expect(vi.mocked(f).mock.calls[0][1]).toMatchObject({ redirect: "error" });
  });

  it("never fetches a clip from a foreign host", async () => {
    const f = fakeFetch(new Response(streamOf([mp4])));
    await failsWith(fetchPostcardVideo("https://example.com/storage/v1/object/x.mp4", { fetchImpl: f }), 400);
    expect(f).not.toHaveBeenCalled();
  });

  it("refuses HEVC (415) and a clip over 61 s (400) on this first read", async () => {
    const hevc = Buffer.from(mp4);
    hevc.write("hvc1", hevc.indexOf("avc1", hevc.indexOf("stsd")), "latin1");
    await failsWith(fetchPostcardVideo(VIDEO_URL, { fetchImpl: fakeFetch(new Response(streamOf([hevc]))) }), 415);

    const long = Buffer.from(mp4);
    const mvhd = long.indexOf("mvhd");
    long.writeUInt32BE(1000, mvhd + 16); // timescale
    long.writeUInt32BE(61_010, mvhd + 20); // 61.01 s
    await failsWith(fetchPostcardVideo(VIDEO_URL, { fetchImpl: fakeFetch(new Response(streamOf([long]))) }), 400);

    long.writeUInt32BE(61_000, mvhd + 20); // exactly 61 s is fine
    await expect(fetchPostcardVideo(VIDEO_URL, { fetchImpl: fakeFetch(new Response(streamOf([long]))) })).resolves.toBeTruthy();
  });

  it("is 415 for a JPEG or a broken MP4, 413 past the cap", async () => {
    await failsWith(fetchPostcardVideo(VIDEO_URL, { fetchImpl: fakeFetch(new Response(streamOf([JPEG]))) }), 415);
    await failsWith(
      fetchPostcardVideo(VIDEO_URL, { fetchImpl: fakeFetch(new Response(streamOf([mp4.subarray(0, 200)]))) }),
      415
    );
    await failsWith(
      fetchPostcardVideo(VIDEO_URL, { fetchImpl: fakeFetch(new Response(streamOf([mp4]))), maxBytes: 1000 }),
      413
    );
  });
});

describe("fetchCapped", () => {
  it("refuses to read with no byte cap", async () => {
    const f = fakeFetch(new Response(streamOf([JPEG])));
    await expect(
      fetchCapped(new URL(URL_OK), { fetchImpl: f, maxBytes: undefined as unknown as number }, "x")
    ).rejects.toThrow(/no byte cap/);
    expect(f).not.toHaveBeenCalled();
  });

  it("keeps the default cap when a caller passes maxBytes: undefined", async () => {
    const f = fakeFetch(new Response(streamOf([JPEG]), { headers: { "content-length": String(41 * 1024 * 1024) } }));
    await failsWith(fetchPostcardImage(URL_OK, { fetchImpl: f, maxBytes: undefined }), 413);
  });
});
