import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// R2 and the read-back are faked over one in-memory bucket; the store and the
// client-BTS logic are real.
const r2 = vi.hoisted(() => ({
  objects: new Map<string, Buffer>(),
  swapAfterRead: null as Buffer | null,
}));
const tag = vi.hoisted(() => (b: Buffer) => {
  let h = 0x811c9dc5;
  for (const x of b) h = Math.imul(h ^ x, 0x01000193) >>> 0;
  return `${h.toString(16)}-${b.byteLength}`;
});
vi.mock("@/lib/r2/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/r2/client")>();
  return {
    ...real,
    copyWithinR2: vi.fn(async (src: string, dest: string, _ct: string, _t: number, opts?: { ifMatch?: string }) => {
      const b = r2.objects.get(src);
      if (!b) throw new Error(`no object ${src}`);
      if (opts?.ifMatch && opts.ifMatch !== `"${tag(b)}"`) {
        throw Object.assign(new Error("PreconditionFailed"), { name: "PreconditionFailed" });
      }
      r2.objects.set(dest, b);
    }),
    headR2Object: vi.fn(async (key: string) => {
      const b = r2.objects.get(key);
      if (!b) throw new Error(`no object ${key}`);
      return { etag: tag(b), size: b.byteLength };
    }),
    deleteImageAssets: vi.fn(async (key: string) => {
      for (const k of [key, real.getThumbnailKey(key, "thumb-sm"), real.getThumbnailKey(key, "thumb-md"), real.getThumbnailKey(key, "thumb-lg")]) {
        r2.objects.delete(k);
      }
      return [];
    }),
    deleteFromR2: vi.fn(async (key: string) => void r2.objects.delete(key)),
    getPresignedDownloadUrl: vi.fn(async (key: string) => `https://r2.test/${key}`),
  };
});
vi.mock("./fetch-image", async (importOriginal) => {
  const real = await importOriginal<typeof import("./fetch-image")>();
  return {
    ...real,
    fetchCappedWithEtag: vi.fn(async (url: URL) => {
      const key = url.pathname.slice(1);
      const b = r2.objects.get(key);
      if (!b) throw new Error(`no object ${key}`);
      if (r2.swapAfterRead) r2.objects.set(key, r2.swapAfterRead);
      return { buf: b, etag: `"${tag(b)}"` };
    }),
  };
});
vi.mock("@/lib/monitoring/report", () => ({ reportSystemError: vi.fn(async () => {}) }));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: vi.fn(async () => ({ ids: [] })) } }));
vi.mock("@/lib/site/membership", () => ({ syncSitePublication: vi.fn(async () => ({ published: [], unpublished: [], failed: [] })) }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn() }));

import { getThumbnailKey } from "@/lib/r2/client";
import { FakeDb } from "./fake-db";
import { deletePostcardEverywhere, listClientGalleries, placeInClientGallery, removeFromClientGallery } from "./client-bts";
import type { ScoutDb } from "./store";

const fixture = (n: string) => readFileSync(join(__dirname, "../video/__fixtures__", n));
const MUTED = fixture("tone-muted.mp4");
const WITH_AUDIO = fixture("tone-with-audio.mp4");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);

const OWNER = "00000000-0000-4000-8000-00000000aaaa";
const OTHER_OWNER = "00000000-0000-4000-8000-00000000bbbb";
const ROAD = "00000000-0000-4000-8000-0000000000a0";
const CLIENT = "00000000-0000-4000-8000-0000000000c1";
const CLIENT2 = "00000000-0000-4000-8000-0000000000c2";
const ALIEN = "00000000-0000-4000-8000-0000000000d1";
const PID = "3f2a9c1e-0b7d-4e7a-9a51-2c4d6e8f0a1b";
const ARCHIVED = "00000000-0000-4000-8000-0000000000e1";

let db: FakeDb;
const store = () => db as unknown as ScoutDb;
const thumbs = (k: string) => (["thumb-sm", "thumb-md", "thumb-lg"] as const).map((v) => getThumbnailKey(k, v));

function seed(kind: "photo" | "video" = "photo", archivedBytes?: Buffer) {
  db = new FakeDb();
  r2.objects.clear();
  r2.swapAfterRead = null;
  db.tables.events.push(
    { id: "web", slug: "tdp-website", user_id: OWNER, name: "TDP Website", event_date: "2026-11-20" },
    { id: ROAD, slug: "scout-road", user_id: OWNER, name: "Scout Road", event_date: null },
    { id: CLIENT, slug: "acme-sko", user_id: OWNER, name: "Acme SKO", event_date: "2026-11-20" },
    { id: CLIENT2, slug: "acme-dinner", user_id: OWNER, name: "Acme Dinner", event_date: "2026-11-21" },
    { id: ALIEN, slug: "not-ours", user_id: OTHER_OWNER, name: "Someone else's", event_date: "2026-11-20" }
  );
  const ext = kind === "video" ? "mp4" : "jpg";
  const key = `events/${ROAD}/originals/${ARCHIVED}.${ext}`;
  const bytes = archivedBytes ?? (kind === "video" ? MUTED : JPEG);
  r2.objects.set(key, bytes);
  for (const t of thumbs(key)) r2.objects.set(t, Buffer.from("poster"));
  db.tables.images.push({
    id: ARCHIVED, event_id: ROAD, r2_key: key, media_type: kind === "video" ? "video" : "image",
    mime_type: kind === "video" ? "video/mp4" : "image/jpeg", file_size: bytes.byteLength, width: 320, height: 240,
    duration_seconds: kind === "video" ? 3 : null, thumbnail_generated: true, processing_status: "complete",
    taken_at: null, dominant_color: null, thumb_bytes: 10, focal_x: null, focal_y: null, is_crew_bts: false,
  });
  db.tables.scout_postcard_links.push({
    postcard_id: PID, image_id: ARCHIVED, event_id: ROAD, section_id: null, gig_id: "g", author_email: null,
    created_at: "", published_target: null, published_at: null,
    client_event_id: null, client_image_id: null, client_section_id: null, client_placed_at: null,
  });
}
const link = () => db.tables.scout_postcard_links[0];
const copies = () => db.tables.images.filter((r) => r.is_crew_bts);
const keysUnder = (eventId: string) => [...r2.objects.keys()].filter((k) => k.startsWith(`events/${eventId}/`));

beforeEach(() => {
  vi.clearAllMocks();
  seed();
});

describe("PUT /postcards/:id/client (placeInClientGallery)", () => {
  it("COPIES the photo into the client's gallery, in a Behind-the-scenes section at the end", async () => {
    db.tables.sections.push({ id: "s-a", event_id: CLIENT, name: "A–L", locked: false, sort_order: 0 });
    const res = await placeInClientGallery(store(), PID, CLIENT);
    expect(res).toMatchObject({ ok: true, event_id: CLIENT });

    const section = db.tables.sections.find((s) => s.id === res.section_id)!;
    expect(section).toMatchObject({ event_id: CLIENT, name: "Behind the scenes", sort_order: 1, job_meta: { kind: "scout-bts" } });

    const [copy] = copies();
    expect(copy).toMatchObject({
      event_id: CLIENT, // owned by the client event: the gallery, ZIP and downloads read by event_id
      is_crew_bts: true,
      parsed_name: null,
      processing_status: "complete",
      thumbnail_generated: true,
      media_type: "image",
    });
    expect(copy.ai_indexed_at).toBeTruthy(); // settled: never indexed, never clustered
    expect(copy.id).not.toBe(ARCHIVED);
    expect(r2.objects.get(copy.r2_key)?.equals(JPEG)).toBe(true);
    for (const t of thumbs(copy.r2_key)) expect(r2.objects.has(t)).toBe(true);
    expect(db.tables.section_images).toEqual([expect.objectContaining({ section_id: res.section_id, image_id: copy.id })]);
    expect(link()).toMatchObject({ client_event_id: CLIENT, client_image_id: copy.id, client_section_id: res.section_id });
    // The archived row is untouched.
    expect(db.tables.images.find((r) => r.id === ARCHIVED)).toMatchObject({ event_id: ROAD, is_crew_bts: false });
  });

  it("is idempotent: a repeat makes no second copy and keeps the SAME copy (its favorites, its id)", async () => {
    const first = await placeInClientGallery(store(), PID, CLIENT);
    const firstCopyId = copies()[0].id;
    const again = await placeInClientGallery(store(), PID, CLIENT);
    expect(again).toEqual(first);
    expect(copies()).toHaveLength(1);
    expect(copies()[0].id).toBe(firstCopyId);
    expect(db.tables.sections.filter((s) => s.name === "Behind the scenes")).toHaveLength(1);
  });

  it("a FAILED move leaves the shot in its old gallery (locked section, not ready, copy check)", async () => {
    await placeInClientGallery(store(), PID, CLIENT);
    const oldCopy = copies()[0];
    const stays = () => {
      expect(copies().map((c) => c.id)).toEqual([oldCopy.id]);
      expect(r2.objects.has(oldCopy.r2_key)).toBe(true);
      expect(link()).toMatchObject({ client_event_id: CLIENT, client_image_id: oldCopy.id });
      expect(keysUnder(CLIENT2)).toEqual([]);
    };

    db.tables.sections.push({ id: "locked", event_id: CLIENT2, name: "Behind the scenes", locked: true, sort_order: 0 });
    await expect(placeInClientGallery(store(), PID, CLIENT2)).rejects.toMatchObject({ status: 409 });
    stays();
    db.tables.sections = db.tables.sections.filter((s) => s.id !== "locked");

    db.tables.images.find((r) => r.id === ARCHIVED)!.processing_status = "pending";
    await expect(placeInClientGallery(store(), PID, CLIENT2)).rejects.toMatchObject({ status: 409 });
    stays();
    db.tables.images.find((r) => r.id === ARCHIVED)!.processing_status = "complete";

    const archivedKey = db.tables.images.find((r) => r.id === ARCHIVED)!.r2_key;
    const { headR2Object } = await import("@/lib/r2/client");
    vi.mocked(headR2Object).mockResolvedValueOnce({ etag: "stale", size: 1 }); // the source changed under us
    await expect(placeInClientGallery(store(), PID, CLIENT2)).rejects.toMatchObject({ status: 502 });
    stays();
    expect(r2.objects.has(archivedKey)).toBe(true);
  });

  it("MOVES it when the event changes: the old copy (row and objects) is gone", async () => {
    await placeInClientGallery(store(), PID, CLIENT);
    const oldCopy = copies()[0];
    const res = await placeInClientGallery(store(), PID, CLIENT2);
    expect(res.event_id).toBe(CLIENT2);
    expect(copies()).toHaveLength(1);
    expect(copies()[0].event_id).toBe(CLIENT2);
    expect(db.tables.images.some((r) => r.id === oldCopy.id)).toBe(false);
    expect(keysUnder(CLIENT)).toEqual([]);
    expect(link()).toMatchObject({ client_event_id: CLIENT2 });
    // The new copy was in place BEFORE the old one was deleted.
    const order = db.log.filter(([op, t]) => t === "images" && (op === "insert" || op === "delete")).map(([op]) => op);
    expect(order.slice(-2)).toEqual(["insert", "delete"]);
  });

  it("reuses an existing Behind-the-scenes section, and refuses (409) a locked one", async () => {
    db.tables.sections.push({ id: "s-bts", event_id: CLIENT, name: "behind the scenes", locked: false, sort_order: 4 });
    expect((await placeInClientGallery(store(), PID, CLIENT)).section_id).toBe("s-bts");

    seed();
    db.tables.sections.push({ id: "s-bts", event_id: CLIENT, name: "Behind the scenes", locked: true, sort_order: 0 });
    await expect(placeInClientGallery(store(), PID, CLIENT)).rejects.toMatchObject({ status: 409 });
    expect(copies()).toHaveLength(0);
    expect(keysUnder(CLIENT)).toEqual([]);
  });

  it("is 409 before the postcard is archived, 404 for an unknown postcard", async () => {
    db.tables.images[0].processing_status = "pending";
    await expect(placeInClientGallery(store(), PID, CLIENT)).rejects.toMatchObject({ status: 409 });
    await expect(placeInClientGallery(store(), "11111111-1111-4111-8111-111111111111", CLIENT)).rejects.toMatchObject({ status: 404 });
    expect(copies()).toHaveLength(0);
  });

  it("is 404 for a gallery that is not the studio's client gallery", async () => {
    for (const target of [ROAD, "web", ALIEN, "00000000-0000-4000-8000-000000000999"]) {
      await expect(placeInClientGallery(store(), PID, target)).rejects.toMatchObject({ status: 404 });
    }
    expect(copies()).toHaveLength(0);
  });

  it("places a silent clip as the silent stored original (same checks), and refuses one with sound", async () => {
    seed("video");
    await placeInClientGallery(store(), PID, CLIENT);
    const [copy] = copies();
    expect(copy).toMatchObject({ media_type: "video", has_audio: false, mime_type: "video/mp4" });
    expect(copy.r2_key).toMatch(/\.mp4$/);
    expect(r2.objects.get(copy.r2_key)?.equals(MUTED)).toBe(true);

    seed("video", WITH_AUDIO); // an archived clip that somehow has sound
    await expect(placeInClientGallery(store(), PID, CLIENT)).rejects.toMatchObject({ status: 502 });
    expect(copies()).toHaveLength(0);
    expect(keysUnder(CLIENT)).toEqual([]);
  });

  it("copies exactly the checked bytes: a clip swapped after the check is never placed", async () => {
    seed("video");
    r2.swapAfterRead = WITH_AUDIO;
    await expect(placeInClientGallery(store(), PID, CLIENT)).rejects.toMatchObject({ status: 502 });
    expect(copies()).toHaveLength(0);
    expect(keysUnder(CLIENT)).toEqual([]);
  });
});

describe("DELETE /postcards/:id/client (removeFromClientGallery)", () => {
  it("deletes exactly the copy (row and objects) and nothing else", async () => {
    db.tables.images.push({ id: "client-photo", event_id: CLIENT, r2_key: `events/${CLIENT}/originals/x.jpg`, is_crew_bts: false });
    r2.objects.set(`events/${CLIENT}/originals/x.jpg`, JPEG);
    await placeInClientGallery(store(), PID, CLIENT);
    const copy = copies()[0];

    expect(await removeFromClientGallery(store(), PID)).toEqual({ removed: true });
    expect(db.tables.images.map((r) => r.id).sort()).toEqual([ARCHIVED, "client-photo"].sort());
    expect(keysUnder(CLIENT)).toEqual([`events/${CLIENT}/originals/x.jpg`]);
    expect(r2.objects.has(copy.r2_key)).toBe(false);
    expect(link()).toMatchObject({ client_event_id: null, client_image_id: null, client_section_id: null });
  });

  it("is idempotent", async () => {
    await placeInClientGallery(store(), PID, CLIENT);
    await removeFromClientGallery(store(), PID);
    expect(await removeFromClientGallery(store(), PID)).toEqual({ removed: false });
  });

  it("never deletes a row that is not a crew BTS copy, even if the link points at it", async () => {
    db.tables.images.push({ id: "client-photo", event_id: CLIENT, r2_key: `events/${CLIENT}/originals/x.jpg`, is_crew_bts: false });
    Object.assign(link(), { client_event_id: CLIENT, client_image_id: "client-photo" });
    expect(await removeFromClientGallery(store(), PID)).toEqual({ removed: false });
    expect(db.tables.images.some((r) => r.id === "client-photo")).toBe(true);
    expect(link().client_image_id).toBeNull();
  });
});

describe("DELETE /postcards/:id", () => {
  it("takes the client placement out FIRST, then deletes the archived postcard", async () => {
    await placeInClientGallery(store(), PID, CLIENT);
    const res = await deletePostcardEverywhere(store(), PID);
    expect(res).toMatchObject({ deleted: true, removed_from_client_gallery: true });
    expect(db.tables.images).toHaveLength(0);
    expect(keysUnder(CLIENT)).toEqual([]);
  });
});

describe("GET /client-galleries (listClientGalleries)", () => {
  beforeEach(() => {
    db.tables.events.push(
      { id: "old", slug: "old", user_id: OWNER, name: "Last year", event_date: "2025-11-20" },
      { id: "edge-before", slug: "e1", user_id: OWNER, name: "Day before", event_date: "2026-11-19" },
      { id: "edge-after", slug: "e2", user_id: OWNER, name: "Day after", event_date: "2026-11-22" },
      { id: "too-late", slug: "e3", user_id: OWNER, name: "Two days after", event_date: "2026-11-23" },
      { id: "work", slug: "tdp-work", user_id: OWNER, name: "TDP Work", event_date: "2026-11-20" }
    );
    db.tables.event_intel.push(
      { event_id: "old", user_id: OWNER, calendar_event_ids: ["cal123_20261120T160000Z"] },
      { event_id: CLIENT2, user_id: OWNER, calendar_event_ids: ["other"] },
      { event_id: ALIEN, user_id: OTHER_OWNER, calendar_event_ids: ["cal123"] }
    );
    db.tables.event_orgs.push(
      { event_id: CLIENT, user_id: OWNER, role: "host", organizations: { name: "Moscone" } },
      { event_id: CLIENT, user_id: OWNER, role: "payer", organizations: { name: "Acme Inc" } }
    );
  });

  it("orders EXACT calendar matches, then SERIES matches, then the padded date window", async () => {
    db.tables.event_intel.push({ event_id: "exact", user_id: OWNER, calendar_event_ids: ["cal123"] });
    db.tables.events.push({ id: "exact", slug: "exact", user_id: OWNER, name: "This week", event_date: "2024-01-01" });
    const out = await listClientGalleries(store(), { date: "2026-11-20", days: 2, calendarEventId: "cal123" });
    expect(out.slice(0, 2)).toEqual([
      expect.objectContaining({ event_id: "exact", match: "calendar" }), // the stored id IS the asked id
      expect.objectContaining({ event_id: "old", match: "series" }), // same series, another instance: never "calendar"
    ]);
    const dated = out.filter((c) => c.match === "date").map((c) => c.event_id);
    expect(dated).toEqual(["edge-after", CLIENT2, CLIENT, "edge-before"]); // newest first
    expect(dated).not.toContain("too-late");
    for (const notClient of [ROAD, "web", "work", ALIEN]) expect(out.map((c) => c.event_id)).not.toContain(notClient);
    expect(out.find((c) => c.event_id === CLIENT)).toMatchObject({ name: "Acme SKO", date: "2026-11-20", client_name: "Acme Inc" });
  });

  it("calls an exact recurring-instance id \"calendar\", and another instance of its series \"series\"", async () => {
    let out = await listClientGalleries(store(), { date: null, days: 1, calendarEventId: "cal123_20261120T160000Z" });
    expect(out).toEqual([expect.objectContaining({ event_id: "old", match: "calendar" })]);
    out = await listClientGalleries(store(), { date: null, days: 1, calendarEventId: "cal123_20261218T160000Z" });
    expect(out).toEqual([expect.objectContaining({ event_id: "old", match: "series" })]);
  });

  it("answers the calendar and series matches only when no date is given", async () => {
    const out = await listClientGalleries(store(), { date: null, days: 1, calendarEventId: "cal123" });
    expect(out.map((c) => c.match)).toEqual(["series"]);
  });

  it("caps the list at 30", async () => {
    for (let i = 0; i < 40; i++) db.tables.events.push({ id: `bulk-${i}`, slug: `b${i}`, user_id: OWNER, name: `B${i}`, event_date: "2026-11-20" });
    expect(await listClientGalleries(store(), { date: "2026-11-20", days: 1, calendarEventId: null })).toHaveLength(30);
  });
});
