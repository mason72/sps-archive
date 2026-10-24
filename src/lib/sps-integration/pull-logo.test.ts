import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/r2/client", async (original) => ({
  ...(await original<typeof import("@/lib/r2/client")>()),
  uploadToR2: vi.fn(async () => ({ key: "", url: "" })),
}));
vi.mock("@/lib/monitoring/report", () => ({
  reportSystemError: vi.fn(async () => {}),
  describeError: (e: unknown) => String(e),
}));

import { uploadToR2 } from "@/lib/r2/client";
import { reportSystemError } from "@/lib/monitoring/report";
import {
  classifyLogoBytes,
  fetchSpsLogo,
  withMosaicLogoKey,
  attachSpsCoverLogo,
  LOGO_MAX_BYTES,
} from "./pull-logo";
import { newGalleryCoverDefaults } from "@/types/event-settings";

const EVENT = "11111111-2222-3333-4444-555555555555";

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16, 1),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16, 1)]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.alloc(4, 0),
  Buffer.from("WEBPVP8 "),
  Buffer.alloc(8, 1),
]);
const GIF = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(16, 1)]);
const SVG = Buffer.from(
  `<?xml version="1.0" encoding="UTF-8"?>\n<!-- brand -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>`
);

function response(
  body: Buffer,
  init: { status?: number; type?: string | null; length?: string } = {}
): Response {
  const headers = new Headers();
  if (init.type !== null) headers.set("content-type", init.type ?? "image/png");
  if (init.length) headers.set("content-length", init.length);
  return new Response(new Uint8Array(body), { status: init.status ?? 200, headers });
}

describe("classifyLogoBytes", () => {
  it("reads raster types from the bytes, whatever the header claims", () => {
    expect(classifyLogoBytes(PNG, "application/octet-stream")).toEqual({ mime: "image/png", ext: "png" });
    expect(classifyLogoBytes(JPEG, "image/png")).toEqual({ mime: "image/jpeg", ext: "jpg" });
    expect(classifyLogoBytes(WEBP, null)).toEqual({ mime: "image/webp", ext: "webp" });
  });

  it("refuses a real image that is not a cover-logo type", () => {
    expect(classifyLogoBytes(GIF, "image/gif")).toBeNull();
  });

  it("accepts SVG only when the document itself opens with <svg>", () => {
    expect(classifyLogoBytes(SVG, "image/svg+xml")).toEqual({ mime: "image/svg+xml", ext: "svg" });
    // No header at all: the document decides.
    expect(classifyLogoBytes(SVG, null)).toEqual({ mime: "image/svg+xml", ext: "svg" });
    // An HTML error page served as text is not a logo.
    expect(classifyLogoBytes(Buffer.from("<!DOCTYPE html><html><body>404</body></html>"), "text/html")).toBeNull();
    // A header that says SVG over bytes that are not.
    expect(classifyLogoBytes(Buffer.from("not an image at all, sorry"), "image/svg+xml")).toBeNull();
    // A header that says something else entirely over SVG text.
    expect(classifyLogoBytes(SVG, "application/pdf")).toBeNull();
  });
});

describe("fetchSpsLogo", () => {
  it("returns the bytes and the type read from them", async () => {
    const fetchImpl = vi.fn(async () => response(PNG, { type: "image/jpeg" })) as unknown as typeof fetch;
    const logo = await fetchSpsLogo("https://cdn.example/events/e/e-header-1.png", fetchImpl);
    expect(logo.mime).toBe("image/png");
    expect(logo.ext).toBe("png");
    expect(Buffer.compare(logo.bytes, PNG)).toBe(0);
  });

  it("throws on a non-2xx answer", async () => {
    const fetchImpl = vi.fn(async () => response(Buffer.from("gone"), { status: 404, type: "text/plain" })) as unknown as typeof fetch;
    await expect(fetchSpsLogo("https://cdn.example/x.png", fetchImpl)).rejects.toThrow(/404/);
  });

  it("throws on a declared or actual size over the cap, and on empty bodies", async () => {
    const big = vi.fn(async () => response(PNG, { length: String(LOGO_MAX_BYTES + 1) })) as unknown as typeof fetch;
    await expect(fetchSpsLogo("https://cdn.example/x.png", big)).rejects.toThrow(/cap/);
    const oversized = vi.fn(async () => response(Buffer.alloc(LOGO_MAX_BYTES + 1, 0x89))) as unknown as typeof fetch;
    await expect(fetchSpsLogo("https://cdn.example/x.png", oversized)).rejects.toThrow(/cap/);
    const empty = vi.fn(async () => response(Buffer.alloc(0))) as unknown as typeof fetch;
    await expect(fetchSpsLogo("https://cdn.example/x.png", empty)).rejects.toThrow(/no bytes/);
  });

  it("throws on bytes that are not an accepted logo type", async () => {
    const fetchImpl = vi.fn(async () => response(GIF, { type: "image/gif" })) as unknown as typeof fetch;
    await expect(fetchSpsLogo("https://cdn.example/x.gif", fetchImpl)).rejects.toThrow(/accepted image type/);
  });

  it("refuses non-http URLs before fetching", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(fetchSpsLogo("file:///etc/passwd", fetchImpl)).rejects.toThrow(/scheme/);
    await expect(fetchSpsLogo("not a url", fetchImpl)).rejects.toThrow(/not a URL/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("withMosaicLogoKey", () => {
  it("sets only the mosaic logoKey and keeps the rest of the settings", () => {
    const settings = { sharing: { pin: "1234" }, cover: newGalleryCoverDefaults() };
    const next = withMosaicLogoKey(settings as unknown as Record<string, unknown>, "events/e/branding/cover-logo.png");
    const cover = next.cover as { mosaic: { logoKey: string; logoMode: string }; type: string };
    expect(cover.mosaic.logoKey).toBe("events/e/branding/cover-logo.png");
    expect(cover.mosaic.logoMode).toBe("insert");
    expect(cover.type).toBe("mosaic");
    expect(next.sharing).toEqual({ pin: "1234" });
    // The input is not mutated.
    expect((settings.cover.mosaic as { logoKey?: string }).logoKey).toBeUndefined();
  });
});

describe("attachSpsCoverLogo", () => {
  type Write = { table: string; values: Record<string, unknown>; eq: [string, unknown] | null };
  function recordingDb(order: string[] = []) {
    const writes: Write[] = [];
    let failUpdate = false;
    const from = (table: string) => ({
      update: (values: Record<string, unknown>) => {
        const w: Write = { table, values, eq: null };
        writes.push(w);
        return {
          eq: async (col: string, val: unknown) => {
            w.eq = [col, val];
            order.push("db");
            return { error: failUpdate ? { message: "db down" } : null };
          },
        };
      },
    });
    return {
      db: { from } as unknown as Parameters<typeof attachSpsCoverLogo>[0],
      writes,
      failUpdates: () => {
        failUpdate = true;
      },
    };
  }
  const settings = () => ({ cover: newGalleryCoverDefaults() }) as unknown as Record<string, unknown>;

  beforeEach(() => {
    vi.mocked(uploadToR2).mockClear();
    vi.mocked(reportSystemError).mockClear();
  });

  it("uploads the bytes to the fixed per-event key, THEN points the mosaic at it", async () => {
    const order: string[] = [];
    const { db, writes } = recordingDb(order);
    vi.mocked(uploadToR2).mockImplementationOnce(async () => {
      order.push("r2");
      return { key: "", url: "" };
    });
    const fetchImpl = vi.fn(async () => response(PNG)) as unknown as typeof fetch;

    const result = await attachSpsCoverLogo(
      db,
      { eventId: EVENT, spsEventId: "sps-1", settings: settings(), logoUrl: "https://cdn.example/h.png" },
      { fetchImpl }
    );

    const key = `events/${EVENT}/branding/cover-logo.png`;
    expect(result.logoKey).toBe(key);
    expect(uploadToR2).toHaveBeenCalledWith(key, expect.any(Buffer), "image/png");
    expect(writes).toHaveLength(1);
    expect(writes[0].table).toBe("events");
    expect(writes[0].eq).toEqual(["id", EVENT]);
    const written = writes[0].values.settings as { cover: { mosaic: { logoKey: string } } };
    expect(written.cover.mosaic.logoKey).toBe(key);
    // The write carries only `settings` — never a display column.
    expect(Object.keys(writes[0].values)).toEqual(["settings"]);
    expect(order).toEqual(["r2", "db"]);
    expect(reportSystemError).not.toHaveBeenCalled();
  });

  it("does nothing when SPS sent no logo", async () => {
    const { db, writes } = recordingDb();
    const s = settings();
    for (const logoUrl of [null, undefined, ""]) {
      const result = await attachSpsCoverLogo(db, { eventId: EVENT, spsEventId: "sps-1", settings: s, logoUrl });
      expect(result).toEqual({ settings: s, logoKey: null });
    }
    expect(writes).toEqual([]);
    expect(uploadToR2).not.toHaveBeenCalled();
    expect(reportSystemError).not.toHaveBeenCalled();
  });

  it("a logo that cannot be fetched is reported and leaves the settings alone, with nothing uploaded", async () => {
    const { db, writes } = recordingDb();
    const s = settings();
    const fetchImpl = vi.fn(async () => response(Buffer.from("nope"), { status: 403, type: "text/plain" })) as unknown as typeof fetch;

    const result = await attachSpsCoverLogo(
      db,
      { eventId: EVENT, spsEventId: "sps-1", settings: s, logoUrl: "https://cdn.example/h.png" },
      { fetchImpl }
    );

    expect(result).toEqual({ settings: s, logoKey: null });
    expect(uploadToR2).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(reportSystemError).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportSystemError).mock.calls[0][0]).toBe("sps.pull-logo");
    expect(vi.mocked(reportSystemError).mock.calls[0][2]).toMatchObject({ eventId: EVENT, spsEventId: "sps-1" });
  });

  it("a failed settings write is reported and never throws", async () => {
    const { db, failUpdates } = recordingDb();
    failUpdates();
    const fetchImpl = vi.fn(async () => response(PNG)) as unknown as typeof fetch;

    const result = await attachSpsCoverLogo(
      db,
      { eventId: EVENT, spsEventId: "sps-1", settings: settings(), logoUrl: "https://cdn.example/h.png" },
      { fetchImpl }
    );

    expect(result.logoKey).toBeNull();
    expect(reportSystemError).toHaveBeenCalledTimes(1);
  });
});
