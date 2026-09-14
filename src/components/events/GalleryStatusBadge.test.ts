import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GalleryStatusBadge } from "./GalleryStatusBadge";
import { isAiReady, type EventStatus } from "@/lib/events/status";

function status(r: { total: number; indexed: number; uploading?: number; gaveUp?: number }): EventStatus {
  const readiness = {
    total: r.total,
    indexed: r.indexed,
    uploading: r.uploading ?? 0,
    gaveUp: r.gaveUp ?? 0,
    rows: r.total,
    ready: false,
  };
  readiness.ready = isAiReady(readiness);
  return {
    delivery: { stage: "published", expired: false, lastViewedAt: null, viewCount: 0 },
    readiness,
  };
}

const render = (s: EventStatus) => renderToStaticMarkup(createElement(GalleryStatusBadge, { status: s }));

describe("GalleryStatusBadge readiness", () => {
  it("a gallery finished except for given-up photos stops showing Processing", () => {
    const html = render(status({ total: 500, indexed: 497, gaveUp: 3 }));
    expect(html).not.toContain("Processing");
    expect(html).toContain("3 not processed");
    expect(html).toContain("couldn&#x27;t be AI-processed");
  });

  it("a cleanly finished gallery shows neither the ring nor a note", () => {
    const html = render(status({ total: 500, indexed: 500 }));
    expect(html).not.toContain("Processing");
    expect(html).not.toContain("not processed");
  });

  it("while work is still running, given-up photos count as settled progress and are named in the tooltip", () => {
    const html = render(status({ total: 100, indexed: 49, gaveUp: 1 }));
    expect(html).toContain("Processing 50%");
    expect(html).toContain("1 photo couldn&#x27;t be AI-processed");
    expect(html).not.toContain("not processed<");
  });

  it("a first batch that failed outright is not 'Queued, nothing is stuck'", () => {
    const html = render(status({ total: 500, indexed: 0, gaveUp: 100 }));
    expect(html).not.toContain("Queued");
    expect(html).not.toContain("nothing is stuck");
    expect(html).toContain("Processing 20%");
    expect(html).toContain("100 photos couldn&#x27;t be AI-processed");
  });

  it("singular wording for one photo", () => {
    expect(render(status({ total: 10, indexed: 9, gaveUp: 1 }))).toContain("1 not processed");
  });
});
