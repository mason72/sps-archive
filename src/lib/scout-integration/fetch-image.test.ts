import { describe, it, expect, vi } from "vitest";
import { fetchPostcardImage, looksLikeJpeg, PostcardFetchError } from "./fetch-image";

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
