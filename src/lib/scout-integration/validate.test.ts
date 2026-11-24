import { describe, it, expect } from "vitest";
import { isValidScene } from "@/lib/site/scenes";
import {
  SCOUT_PUBLISH_TARGETS,
  checkImageUrl,
  gigSectionNames,
  isScoutPublishTarget,
  isScoutGigMeta,
  parseDayWindow,
  parsePostcardBody,
} from "./validate";

const PID = "3f2a9c1e-0b7d-4e7a-9a51-2c4d6e8f0a1b";
const URL_OK =
  "https://ezubznenjcogwocccznj.supabase.co/storage/v1/object/sign/scout-photos/p/1.jpg?token=abc";
const body = (over: Record<string, unknown> = {}) => ({
  postcard_id: PID,
  gig_id: "gig-123",
  gig_title: "Acme SKO // Austin",
  image_url: URL_OK,
  ...over,
});

describe("publish targets", () => {
  it("are exactly the three BTS scenes, each a real website scene", () => {
    expect([...SCOUT_PUBLISH_TARGETS]).toEqual(["bts/headshot-booth", "bts/photo-booth", "bts/anti-booth"]);
    for (const t of SCOUT_PUBLISH_TARGETS) expect(isValidScene(t)).toBe(true);
  });

  it("refuses any other scene, including real non-BTS ones, and non-strings", () => {
    expect(isScoutPublishTarget("bts/photo-booth")).toBe(true);
    for (const bad of ["bts/other", "headshots", "BTS/photo-booth", " bts/photo-booth", "", null, 3, ["bts/photo-booth"]]) {
      expect(isScoutPublishTarget(bad)).toBe(false);
    }
  });
});

describe("parsePostcardBody", () => {
  it("accepts the minimal body and normalizes", () => {
    const r = parsePostcardBody(body({ postcard_id: PID.toUpperCase(), author_email: " Joey@TwoDudesPhoto.com " }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.postcardId).toBe(PID);
    expect(r.value.authorEmail).toBe("joey@twodudesphoto.com");
    expect(r.value.gigStart).toBeNull();
    expect(r.value.width).toBeNull();
  });

  it("refuses a missing or malformed field with a message naming it", () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ postcard_id: "not-a-uuid" }, /postcard_id/],
      [{ gig_id: "" }, /gig_id/],
      [{ gig_title: "   " }, /gig_title/],
      [{ gig_start: "2026-02-30" }, /gig_start/],
      [{ gig_start: "11/23/2026" }, /gig_start/],
      [{ taken_at: "2026-11-23T10:00:00" }, /taken_at/], // no zone: refused, never guessed
      [{ author_email: "joey" }, /author_email/],
      [{ image_url: "" }, /image_url/],
      [{ width: 0 }, /width/],
      [{ height: 12.5 }, /height/],
    ];
    for (const [over, msg] of cases) {
      const r = parsePostcardBody(body(over));
      expect(r.ok, JSON.stringify(over)).toBe(false);
      if (!r.ok) expect(r.error).toMatch(msg);
    }
    expect(parsePostcardBody(null).ok).toBe(false);
  });

  it("accepts a zoned taken_at and a real gig_start", () => {
    const r = parsePostcardBody(body({ taken_at: "2026-11-23T10:00:00-08:00", gig_start: "2026-11-20" }));
    expect(r.ok).toBe(true);
  });
});

describe("checkImageUrl", () => {
  it("accepts Scout's storage over https", () => {
    expect(checkImageUrl(URL_OK).ok).toBe(true);
  });
  it("refuses http, other hosts, look-alike hosts, credentials and non-storage paths", () => {
    for (const bad of [
      URL_OK.replace("https:", "http:"),
      "https://example.com/storage/v1/object/sign/x.jpg",
      "https://ezubznenjcogwocccznj.supabase.co.evil.com/storage/v1/object/x.jpg",
      "https://user:pw@ezubznenjcogwocccznj.supabase.co/storage/v1/object/x.jpg",
      "https://ezubznenjcogwocccznj.supabase.co:8443/storage/v1/object/x.jpg",
      "https://ezubznenjcogwocccznj.supabase.co/rest/v1/members",
      "https://169.254.169.254/latest/meta-data",
      "not a url",
    ]) {
      expect(checkImageUrl(bad).ok, bad).toBe(false);
    }
  });
});

describe("parseDayWindow", () => {
  it("allows up to 120 days inclusive", () => {
    expect(parseDayWindow("2026-01-01", "2026-04-30").ok).toBe(true); // 120 days
    expect(parseDayWindow("2026-01-01", "2026-05-01").ok).toBe(false); // 121
    expect(parseDayWindow("2026-03-05", "2026-03-05").ok).toBe(true);
  });
  it("refuses a reversed window and bad dates", () => {
    expect(parseDayWindow("2026-03-05", "2026-03-04").ok).toBe(false);
    expect(parseDayWindow(null, "2026-03-04").ok).toBe(false);
    expect(parseDayWindow("2026-3-5", "2026-03-06").ok).toBe(false);
  });
});

describe("gig sections", () => {
  it("try the title, then the date, then the gig id", () => {
    expect(gigSectionNames({ gigId: "abcdef1234567", gigTitle: "Acme", gigStart: "2026-11-20" })).toEqual([
      "Acme",
      "Acme · 2026-11-20",
      "Acme · abcdef12",
      "Acme · abcdef1234567",
    ]);
    expect(gigSectionNames({ gigId: "short", gigTitle: "Acme", gigStart: null })).toEqual(["Acme", "Acme · short"]);
  });
  it("are recognized only by the full marker", () => {
    expect(isScoutGigMeta({ kind: "scout-gig", scout_gig_id: "g" })).toBe(true);
    expect(isScoutGigMeta({ kind: "ai-looks" })).toBe(false);
    expect(isScoutGigMeta(null)).toBe(false);
  });
});
