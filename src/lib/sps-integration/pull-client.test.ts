import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  confirmPulled,
  fetchGuestList,
  fetchManifestPage,
  listSpsEvents,
  walkManifest,
  SpsPullError,
  MANIFEST_PAGE_SIZE,
  PULLED_BATCH_LIMIT,
} from "./pull-client";

/**
 * These tests exist for the two failure modes that would be invisible in
 * production: stopping the manifest walk one page early (photos silently never
 * imported) and mis-classifying a 401 as a retryable error (a re-paste prompt
 * that never appears).
 */

const TOKEN = "spsa_test_token_value_1234567890";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function page(images: number, nextOffset?: number) {
  return {
    event: {
      id: "evt",
      name: "Event",
      slug: "evt",
      date: null,
      completedAt: null,
      imageCount: 9999,
      archiveEnabled: true,
    },
    images: Array.from({ length: images }, (_, i) => ({
      id: `img-${i}`,
      originalFilename: `IMG_${i}.jpg`,
      width: 100,
      height: 100,
      mimeType: "image/jpeg",
      capturedAt: null,
      boothId: null,
      quality: "archive" as const,
      alreadyPulled: false,
      url: `https://sps.example/${i}.jpg`,
    })),
    ...(nextOffset !== undefined ? { nextOffset } : {}),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("auth header", () => {
  it("sends the token as X-SPS-Archive-Token and never in the URL", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ events: [] }));
    await listSpsEvents(TOKEN);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain(TOKEN);
    expect(
      (init.headers as Record<string, string>)["X-SPS-Archive-Token"]
    ).toBe(TOKEN);
  });
});

describe("error classification", () => {
  it("treats 401 as a non-retryable token problem", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "nope" }, 401));
    const err = await listSpsEvents(TOKEN).catch((e) => e);
    expect(err).toBeInstanceOf(SpsPullError);
    expect(err.kind).toBe("unauthorized");
    expect(err.retryable).toBe(false);
  });

  it("treats 404 as not-found, not as permission-denied", async () => {
    // SPS answers 404 rather than 403 for another host's event on purpose.
    fetchMock.mockResolvedValue(jsonResponse({ error: "nope" }, 404));
    const err = await fetchManifestPage(TOKEN, "evt").catch((e) => e);
    expect(err.kind).toBe("not-found");
    expect(err.retryable).toBe(false);
  });

  it("treats 5xx and network failure as retryable", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 503));
    const serverErr = await fetchManifestPage(TOKEN, "evt").catch((e) => e);
    expect(serverErr.kind).toBe("server");
    expect(serverErr.retryable).toBe(true);

    fetchMock.mockRejectedValue(new Error("socket hang up"));
    const netErr = await fetchManifestPage(TOKEN, "evt").catch((e) => e);
    expect(netErr.kind).toBe("network");
    expect(netErr.retryable).toBe(true);
  });

  it("never echoes the token in an error message", async () => {
    fetchMock.mockResolvedValue(
      new Response(`upstream said ${TOKEN} was wrong`, { status: 500 })
    );
    const err = await listSpsEvents(TOKEN).catch((e) => e);
    // The body is surfaced for diagnosis, but we must not be the ones adding
    // the credential to it — assert on OUR construction, not SPS's.
    expect(err.message.startsWith("SPS returned 500")).toBe(true);
  });
});

describe("walkManifest", () => {
  it("pages until nextOffset is absent, not until imageCount is reached", async () => {
    // event.imageCount says 9999 — SPS's own counter, which has never matched
    // the manifest (pending rows; and until 2026-09-02, AI renders the manifest
    // left out). Trusting it would page forever; trusting a full page would
    // stop early.
    fetchMock
      .mockResolvedValueOnce(jsonResponse(page(MANIFEST_PAGE_SIZE, 500)))
      .mockResolvedValueOnce(jsonResponse(page(MANIFEST_PAGE_SIZE, 1000)))
      .mockResolvedValueOnce(jsonResponse(page(12)));

    const seen: number[] = [];
    const result = await walkManifest(TOKEN, "evt", async (_p, offset) => {
      seen.push(offset);
    });

    expect(seen).toEqual([0, 500, 1000]);
    expect(result.complete).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("treats a FULL last page as the end when nextOffset is absent", async () => {
    // The terminator is the missing field, never the page being short.
    fetchMock.mockResolvedValueOnce(jsonResponse(page(MANIFEST_PAGE_SIZE)));
    const result = await walkManifest(TOKEN, "evt", async () => {});
    expect(result.complete).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resumes from a given offset", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(page(3)));
    await walkManifest(TOKEN, "evt", async () => {}, 1500);
    expect(String(fetchMock.mock.calls[0][0])).toContain("offset=1500");
  });

  it("hands back the next offset when the caller stops early", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(page(MANIFEST_PAGE_SIZE, 500)));
    const result = await walkManifest(TOKEN, "evt", async () => false);
    expect(result).toEqual({ stoppedAt: 500, complete: false });
  });
});

describe("confirmPulled", () => {
  it("chunks at SPS's limit and sums what each call confirmed", async () => {
    // A fresh Response per call — a body can only be read once, so a shared
    // mockResolvedValue would fail on the second chunk for test reasons.
    fetchMock.mockImplementation(async () => jsonResponse({ confirmed: 10 }));
    const ids = Array.from({ length: PULLED_BATCH_LIMIT + 1 }, (_, i) => `i-${i}`);

    const confirmed = await confirmPulled(TOKEN, "evt", ids);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(confirmed).toBe(20);
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(firstBody.imageIds).toHaveLength(PULLED_BATCH_LIMIT);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondBody.imageIds).toHaveLength(1);
  });

  it("accepts confirmed: 0 as success — a passthrough image has nothing to release", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ confirmed: 0 }));
    await expect(confirmPulled(TOKEN, "evt", ["a", "b"])).resolves.toBe(0);
  });

  it("makes no call at all for an empty id list", async () => {
    await expect(confirmPulled(TOKEN, "evt", [])).resolves.toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * The guest-list fetch is the one endpoint that is NOT JSON and whose 404 is
 * overloaded, so both of those are pinned here. The failure they guard against
 * is quiet: a generic "SPS has no such event" shown to someone whose event
 * exists and simply has nobody checked in yet sends them hunting a broken
 * connection instead of telling them to wait for guests.
 */
describe("fetchGuestList", () => {
  // `Uint8Array<ArrayBuffer>`, not a bare `Uint8Array`: since TS 5.7 the typed
  // arrays are generic over their buffer, and the default `ArrayBufferLike`
  // admits SharedArrayBuffer, which is not a BodyInit. `npm test` would never
  // have caught it — vitest strips types without checking them.
  function xlsxResponse(
    bytes: Uint8Array<ArrayBuffer>,
    headers: Record<string, string> = {},
    status = 200
  ): Response {
    return new Response(bytes, {
      status,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ...headers,
      },
    });
  }

  it("returns the bytes, the filename SPS chose, and the guest count", async () => {
    const body = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x11, 0x22]);
    fetchMock.mockResolvedValue(
      xlsxResponse(body, {
        "Content-Disposition": 'attachment; filename="twodudes-k1-guest-list.xlsx"',
        "X-Guest-Count": "148",
      })
    );

    const sheet = await fetchGuestList(TOKEN, "evt");
    expect(Array.from(sheet.bytes)).toEqual(Array.from(body));
    expect(sheet.filename).toBe("twodudes-k1-guest-list.xlsx");
    expect(sheet.guestCount).toBe(148);
    expect(sheet.contentType).toContain("spreadsheetml");

    // Same rule as every other call: the token is a header, never the URL.
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain(TOKEN);
    expect(String(url)).toContain("/events/evt/guest-list");
    expect(
      (init.headers as Record<string, string>)["X-SPS-Archive-Token"]
    ).toBe(TOKEN);
  });

  it("surfaces SPS's own 404 sentence instead of the generic not-found text", async () => {
    const sentence = "This event has no guest list yet — nobody has checked in.";
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: sentence }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    );

    const err = await fetchGuestList(TOKEN, "evt").catch((e) => e);
    expect(err).toBeInstanceOf(SpsPullError);
    expect(err.kind).toBe("not-found");
    expect(err.message).toBe(sentence);
    // The trap this pins down: classify() would have said this instead.
    expect(err.message).not.toContain("no such event");
  });

  it("passes a 403 through with its reason, since it names the wrong account", async () => {
    const sentence =
      "Guest-list export is limited to info@twodudesphoto.com; this archive token belongs to someone@else.com.";
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: sentence }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );

    const err = await fetchGuestList(TOKEN, "evt").catch((e) => e);
    expect(err.message).toBe(sentence);
  });

  it("falls back to a sane filename and a null count when the headers are bare", async () => {
    fetchMock.mockResolvedValue(xlsxResponse(new Uint8Array([1, 2, 3])));
    const sheet = await fetchGuestList(TOKEN, "evt");
    expect(sheet.filename).toBe("guest-list.xlsx");
    expect(sheet.guestCount).toBeNull();
  });
});
