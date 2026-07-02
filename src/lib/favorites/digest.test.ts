import { describe, it, expect } from "vitest";
import {
  selectDigestCandidates,
  buildDigestEmailBody,
  DIGEST_PREVIEW_COUNT,
  type FavoriteRow,
} from "./digest";

const NOW = new Date("2026-07-01T12:00:00Z");
const H = 60 * 60 * 1000;

function fav(
  shareId: string,
  imageId: string,
  hoursAgo: number,
  digestedAt: string | null = null
): FavoriteRow {
  return {
    share_id: shareId,
    image_id: imageId,
    created_at: new Date(NOW.getTime() - hoursAgo * H).toISOString(),
    share: { slug: `slug-${shareId}`, event_id: `evt-${shareId}`, digested_at: digestedAt },
  };
}

describe("selectDigestCandidates", () => {
  it("digests a share quiet for more than the window", () => {
    const rows = [fav("s1", "a", 3), fav("s1", "b", 2.5)];
    const out = selectDigestCandidates(rows, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].newImageIds).toEqual(["a", "b"]);
  });

  it("defers while the client is still picking", () => {
    const rows = [fav("s1", "a", 3), fav("s1", "b", 0.5)];
    expect(selectDigestCandidates(rows, NOW)).toHaveLength(0);
  });

  it("only reports favorites newer than the watermark", () => {
    const digestedAt = new Date(NOW.getTime() - 4 * H).toISOString();
    const rows = [
      fav("s1", "old", 6, digestedAt),
      fav("s1", "new1", 3, digestedAt),
      fav("s1", "new2", 2.5, digestedAt),
    ];
    const out = selectDigestCandidates(rows, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].newImageIds).toEqual(["new1", "new2"]);
  });

  it("skips shares with nothing new since the watermark", () => {
    const digestedAt = new Date(NOW.getTime() - 1 * H).toISOString();
    const rows = [fav("s1", "old", 5, digestedAt)];
    expect(selectDigestCandidates(rows, NOW)).toHaveLength(0);
  });

  it("recent activity on OLD favorites defers a share with new picks", () => {
    // digested 4h ago; one new pick 3h ago, but another favorite 1h ago —
    // the client is back and still selecting, so wait.
    const digestedAt = new Date(NOW.getTime() - 4 * H).toISOString();
    const rows = [fav("s1", "a", 3, digestedAt), fav("s1", "b", 1, digestedAt)];
    expect(selectDigestCandidates(rows, NOW)).toHaveLength(0);
  });

  it("caps the preview and orders oldest-first", () => {
    const rows = [3.5, 3.2, 3.0, 2.8, 2.6, 2.4].map((h, i) =>
      fav("s1", `img${i}`, h)
    );
    const out = selectDigestCandidates(rows, NOW);
    expect(out[0].newImageIds).toHaveLength(6);
    expect(out[0].previewImageIds).toHaveLength(DIGEST_PREVIEW_COUNT);
    expect(out[0].previewImageIds[0]).toBe("img0"); // oldest pick first
  });

  it("handles multiple shares independently", () => {
    const rows = [fav("quiet", "a", 3), fav("busy", "b", 0.2)];
    const out = selectDigestCandidates(rows, NOW);
    expect(out.map((c) => c.shareId)).toEqual(["quiet"]);
  });
});

describe("buildDigestEmailBody", () => {
  it("includes count, event name, previews, and the overflow line", () => {
    const html = buildDigestEmailBody({
      eventName: "College Board <2026>",
      newCount: 23,
      totalCount: 23,
      previewUrls: ["u1", "u2", "u3", "u4"],
      galleryUrl: "https://app/events/e1",
    });
    expect(html).toContain("23 favorites");
    expect(html).toContain("College Board &lt;2026&gt;"); // escaped
    expect(html.match(/<img /g)).toHaveLength(4);
    expect(html).toContain("and 19 more");
  });

  it("notes the running total on re-digests", () => {
    const html = buildDigestEmailBody({
      eventName: "E",
      newCount: 2,
      totalCount: 25,
      previewUrls: ["u1"],
      galleryUrl: "g",
    });
    expect(html).toContain("25 total");
    expect(html).not.toContain("and 1 more".replace("1", "-1"));
  });
});
