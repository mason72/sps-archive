import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { serializeSiteAsset, type SiteAssetRow } from "./serialize";

const row = (overrides: Partial<SiteAssetRow> = {}): SiteAssetRow => ({
  id: "img-1",
  r2_key: "events/e1/originals/a.jpg",
  width: 4000,
  height: 3000,
  service: null,
  featured: false,
  created_at: "2026-06-01T00:00:00Z",
  focal_x: null,
  focal_y: null,
  media_type: "image",
  duration_seconds: null,
  stream_uid: null,
  events: { name: "Knowledge 25", city: "Las Vegas" },
  ...overrides,
});

describe("serializeSiteAsset", () => {
  const saved = {
    lane: process.env.R2_PUBLIC_LANE_URL,
    code: process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE,
  };
  beforeEach(() => {
    process.env.R2_PUBLIC_LANE_URL = "https://cdn.test";
    process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE = "abc123";
  });
  afterEach(() => {
    process.env.R2_PUBLIC_LANE_URL = saved.lane;
    process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE = saved.code;
  });

  it("keeps the frozen image contract and adds inert video fields", () => {
    const out = serializeSiteAsset(row(), "photo-booth");
    expect(out).toMatchObject({
      id: "img-1",
      event: "Knowledge 25",
      city: "Las Vegas",
      service: "photo-booth", // scene fallback when unset
      featured: false,
      width: 4000,
      height: 3000,
      thumbUrl: "https://cdn.test/events/e1/thumbnails/thumb-md/a.jpg",
      fullUrl: "https://cdn.test/events/e1/originals/a.jpg",
      focalX: null,
      focalY: null,
      kind: "image",
      duration: null,
      posterUrl: null,
      videoUrl: null,
      iframeUrl: null,
      streamUid: null,
    });
  });

  it("serves a short muted clip from the R2 lane with poster + mp4", () => {
    const out = serializeSiteAsset(
      row({
        r2_key: "events/e1/originals/loop.mp4",
        media_type: "video",
        duration_seconds: 14.5,
      })
    );
    expect(out.kind).toBe("video");
    expect(out.duration).toBe(14.5);
    expect(out.thumbUrl).toBe(
      "https://cdn.test/events/e1/thumbnails/thumb-md/loop.jpg"
    );
    // fullUrl stays <img>-safe: the large poster, never the mp4.
    expect(out.fullUrl).toBe(
      "https://cdn.test/events/e1/thumbnails/thumb-lg/loop.jpg"
    );
    expect(out.posterUrl).toBe(
      "https://cdn.test/events/e1/thumbnails/thumb-lg/loop.jpg"
    );
    expect(out.videoUrl).toBe("https://cdn.test/events/e1/originals/loop.mp4");
    expect(out.streamUid).toBeNull();
  });

  it("points a .mov clip's videoUrl at the remuxed mp4 rendition", () => {
    const out = serializeSiteAsset(
      row({
        r2_key: "events/e1/originals/loop.mov",
        media_type: "video",
        duration_seconds: 9,
      })
    );
    expect(out.videoUrl).toBe("https://cdn.test/events/e1/video/loop.mp4");
  });

  it("serves a Stream-published reel as HLS + iframe with R2 posters", () => {
    const out = serializeSiteAsset(
      row({
        r2_key: "events/e1/originals/reel.mp4",
        media_type: "video",
        duration_seconds: 182,
        stream_uid: "uid-9",
      })
    );
    expect(out.kind).toBe("stream");
    expect(out.videoUrl).toBe(
      "https://customer-abc123.cloudflarestream.com/uid-9/manifest/video.m3u8"
    );
    expect(out.iframeUrl).toBe(
      "https://customer-abc123.cloudflarestream.com/uid-9/iframe"
    );
    expect(out.posterUrl).toBe(
      "https://cdn.test/events/e1/thumbnails/thumb-lg/reel.jpg"
    );
    expect(out.streamUid).toBe("uid-9");
  });
});
