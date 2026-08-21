import { randomUUID } from "crypto";
import type { createServiceClient } from "@/lib/supabase/server";
import {
  deleteFromR2,
  getCachedThumbnailUrl,
  getPresignedUploadUrl,
  objectExistsInR2,
} from "@/lib/r2/client";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * Intel notes & behind-the-scenes photos — the store (migration 070).
 *
 * INTERNAL. An entry is text and/or a photo, tagged "about the venue" and/or
 * "about the client", optionally linked to the gig that taught it. The venue
 * page and the client page are DERIVED reads over those tags; nothing here
 * ever touches `images`, `sections` or any guest surface. See the migration
 * header for why that absence is the whole design.
 *
 * Every function takes the SERVICE client and a userId, and scopes every query
 * by it — RLS is bypassed on that client (lessons #2 and #14).
 */

type DB = ReturnType<typeof createServiceClient>;

/**
 * The R2 prefix. Outside `events/…` on purpose: `getThumbnailKey`,
 * `deleteImageAssets`, the reconciler and every gallery sweep key off that
 * prefix, and none of them may ever find a BTS shot. Same posture as
 * `crew-faces/`.
 */
export const INTEL_NOTES_PREFIX = "intel-notes";

/** Bulk upload cap per presign call — a camera roll, not an archive. */
export const MAX_NOTE_BATCH = 100;
/** Caption/body cap. */
export const MAX_BODY_CHARS = 4000;

export interface IntelNote {
  id: string;
  eventId: string | null;
  venueId: string | null;
  orgId: string | null;
  aboutVenue: boolean;
  aboutClient: boolean;
  body: string | null;
  /** Presigned, cache-windowed URLs; null for a text-only entry. */
  imageUrl: string | null;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  takenAt: string | null;
  pinned: boolean;
  createdAt: string;
  /** Display context, so a venue page can say which gig an entry came from. */
  event: { id: string; name: string; date: string | null } | null;
  venue: { id: string; name: string } | null;
  org: { id: string; name: string } | null;
}

export type NoteScope =
  | { eventId: string }
  | { venueId: string }
  | { orgId: string };

interface NoteRow {
  id: string;
  event_id: string | null;
  venue_id: string | null;
  org_id: string | null;
  about_venue: boolean;
  about_client: boolean;
  body: string | null;
  storage_key: string | null;
  thumb_key: string | null;
  width: number | null;
  height: number | null;
  taken_at: string | null;
  pinned: boolean;
  created_at: string;
}

const SELECT =
  "id, event_id, venue_id, org_id, about_venue, about_client, body, storage_key, thumb_key, width, height, taken_at, pinned, created_at";

/* ── Keys ───────────────────────────────────────────────────────────────── */

export function mintNoteKeys(userId: string): { storageKey: string; thumbKey: string } {
  const id = randomUUID();
  return {
    storageKey: `${INTEL_NOTES_PREFIX}/${userId}/${id}.jpg`,
    thumbKey: `${INTEL_NOTES_PREFIX}/${userId}/${id}.thumb.jpg`,
  };
}

/**
 * A key the client hands back must be one WE minted for THIS user. Without
 * this, a create call could claim any object in the bucket — another user's
 * BTS shot, or a gallery original — as its own photo.
 */
export function keyBelongsTo(userId: string, key: string): boolean {
  return (
    key.startsWith(`${INTEL_NOTES_PREFIX}/${userId}/`) &&
    /^[a-z0-9-]+\/[0-9a-f-]{36}\/[0-9a-f-]{36}(\.thumb)?\.jpg$/.test(key)
  );
}

export async function presignNoteUploads(userId: string, count: number) {
  const n = Math.max(0, Math.min(MAX_NOTE_BATCH, Math.floor(count)));
  return Promise.all(
    Array.from({ length: n }, async () => {
      const keys = mintNoteKeys(userId);
      const [putUrl, thumbPutUrl] = await Promise.all([
        getPresignedUploadUrl(keys.storageKey, "image/jpeg", 1800),
        getPresignedUploadUrl(keys.thumbKey, "image/jpeg", 1800),
      ]);
      return { ...keys, putUrl, thumbPutUrl };
    })
  );
}

/* ── Subject resolution ─────────────────────────────────────────────────── */

export interface NoteSubject {
  eventId: string | null;
  venueId: string | null;
  orgId: string | null;
}

/**
 * Where does an entry land?
 *
 * Given an event, the venue and client come FROM the event (event_intel.venue_id,
 * the payer in event_orgs) unless the caller names them explicitly. Every id is
 * proven to belong to the caller before it is used — a PATCH body is input.
 */
export async function resolveNoteSubject(
  db: DB,
  userId: string,
  input: { eventId?: string | null; venueId?: string | null; orgId?: string | null }
): Promise<NoteSubject | { error: string }> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const anyDb = db as any;
  let eventId: string | null = null;
  let venueId: string | null = input.venueId ?? null;
  let orgId: string | null = input.orgId ?? null;

  if (input.eventId) {
    const { data: ev, error } = await anyDb
      .from("events").select("id").eq("id", input.eventId).eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (!ev) return { error: "Event not found" };
    eventId = ev.id;

    if (!venueId) {
      const { data: intel, error: iErr } = await anyDb
        .from("event_intel").select("venue_id").eq("event_id", eventId).eq("user_id", userId).maybeSingle();
      if (iErr) throw iErr;
      venueId = intel?.venue_id ?? null;
    }
    if (!orgId) {
      const { data: links, error: oErr } = await anyDb
        .from("event_orgs").select("org_id, role").eq("event_id", eventId).eq("user_id", userId);
      if (oErr) throw oErr;
      const rows = (links ?? []) as { org_id: string; role: string }[];
      orgId = rows.find((r) => r.role === "payer")?.org_id ?? rows[0]?.org_id ?? null;
    }
  }

  if (venueId) {
    const { data: v, error } = await anyDb
      .from("venues").select("id").eq("id", venueId).eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (!v) return { error: "Venue not found" };
  }
  if (orgId) {
    const { data: o, error } = await anyDb
      .from("organizations").select("id").eq("id", orgId).eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (!o) return { error: "Client not found" };
  }
  if (!eventId && !venueId && !orgId) return { error: "Pick a venue, a client, or a gig" };
  return { eventId, venueId, orgId };
}

/* ── Reads ──────────────────────────────────────────────────────────────── */

export async function listNotes(db: DB, userId: string, scope: NoteScope): Promise<IntelNote[]> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const anyDb = db as any;
  let q = anyDb.from("intel_notes").select(SELECT).eq("user_id", userId);
  if ("eventId" in scope) q = q.eq("event_id", scope.eventId);
  else if ("venueId" in scope) q = q.eq("venue_id", scope.venueId).eq("about_venue", true);
  else q = q.eq("org_id", scope.orgId).eq("about_client", true);

  // Pinned first, newest after — and `id` as the tiebreak, because a paged read
  // without a unique order is how /people double-counted (lesson 88).
  const { data, error } = await q
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id")
    .limit(500);
  if (error) throw error;
  return hydrate(db, userId, (data ?? []) as NoteRow[]);
}

async function hydrate(db: DB, userId: string, rows: NoteRow[]): Promise<IntelNote[]> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const anyDb = db as any;
  const ids = (k: keyof NoteRow) => [...new Set(rows.map((r) => r[k]).filter(Boolean))] as string[];
  const [evRes, vRes, oRes] = await Promise.all([
    ids("event_id").length
      ? anyDb.from("events").select("id, name, sort_date").in("id", ids("event_id")).eq("user_id", userId)
      : { data: [], error: null },
    ids("venue_id").length
      ? anyDb.from("venues").select("id, name").in("id", ids("venue_id")).eq("user_id", userId)
      : { data: [], error: null },
    ids("org_id").length
      ? anyDb.from("organizations").select("id, name").in("id", ids("org_id")).eq("user_id", userId)
      : { data: [], error: null },
  ]);
  for (const r of [evRes, vRes, oRes]) if (r.error) throw r.error;
  const evBy = new Map((evRes.data as { id: string; name: string; sort_date: string | null }[]).map((e) => [e.id, e]));
  const vBy = new Map((vRes.data as { id: string; name: string }[]).map((v) => [v.id, v]));
  const oBy = new Map((oRes.data as { id: string; name: string }[]).map((o) => [o.id, o]));

  return Promise.all(
    rows.map(async (r) => {
      const [imageUrl, thumbUrl] = await Promise.all([
        r.storage_key ? getCachedThumbnailUrl(r.storage_key) : null,
        r.thumb_key ? getCachedThumbnailUrl(r.thumb_key) : null,
      ]);
      const ev = r.event_id ? evBy.get(r.event_id) : undefined;
      return {
        id: r.id,
        eventId: r.event_id,
        venueId: r.venue_id,
        orgId: r.org_id,
        aboutVenue: r.about_venue,
        aboutClient: r.about_client,
        body: r.body,
        imageUrl,
        thumbUrl,
        width: r.width,
        height: r.height,
        takenAt: r.taken_at,
        pinned: r.pinned,
        createdAt: r.created_at,
        event: ev ? { id: ev.id, name: ev.name, date: ev.sort_date } : null,
        venue: r.venue_id ? (vBy.get(r.venue_id) ?? null) : null,
        org: r.org_id ? (oBy.get(r.org_id) ?? null) : null,
      };
    })
  );
}

/* ── Writes ─────────────────────────────────────────────────────────────── */

export interface NewNoteInput {
  body?: string | null;
  storageKey?: string | null;
  thumbKey?: string | null;
  width?: number | null;
  height?: number | null;
  takenAt?: string | null;
  aboutVenue?: boolean;
  aboutClient?: boolean;
  pinned?: boolean;
}

function cleanBody(b: unknown): string | null {
  if (typeof b !== "string") return null;
  const t = b.trim();
  return t ? t.slice(0, MAX_BODY_CHARS) : null;
}

function cleanDate(d: unknown): string | null {
  if (typeof d !== "string" || !d) return null;
  const t = Date.parse(d);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * Insert a batch of entries against one subject.
 *
 * BYTES BEFORE ROWS: every storage key is checked in R2 before its row exists,
 * so a failed PUT can never produce a row whose image 404s. An orphaned object
 * from a row that never got inserted is harmless; a row pointing at nothing is
 * a broken tile forever (the upload path's ghost-row lesson, inverted).
 */
export async function createNotes(
  db: DB,
  userId: string,
  subject: NoteSubject,
  inputs: NewNoteInput[]
): Promise<{ notes: IntelNote[] } | { error: string; status: number }> {
  if (inputs.length === 0) return { error: "Nothing to add", status: 400 };
  if (inputs.length > MAX_NOTE_BATCH) return { error: `At most ${MAX_NOTE_BATCH} at a time`, status: 400 };

  const rows: Record<string, unknown>[] = [];
  for (const [i, n] of inputs.entries()) {
    const body = cleanBody(n.body);
    const storageKey = typeof n.storageKey === "string" && n.storageKey ? n.storageKey : null;
    const thumbKey = typeof n.thumbKey === "string" && n.thumbKey ? n.thumbKey : null;
    if (!body && !storageKey) return { error: `Entry ${i + 1} has neither text nor a photo`, status: 400 };
    if (storageKey) {
      if (!keyBelongsTo(userId, storageKey) || (thumbKey && !keyBelongsTo(userId, thumbKey))) {
        return { error: "Unknown upload", status: 400 };
      }
      const [a, b] = await Promise.all([
        objectExistsInR2(storageKey),
        thumbKey ? objectExistsInR2(thumbKey) : Promise.resolve(true),
      ]);
      if (!a || !b) return { error: `Photo ${i + 1} did not finish uploading`, status: 409 };
    }
    const aboutVenue = n.aboutVenue !== false;
    const aboutClient = n.aboutClient !== false;
    rows.push({
      user_id: userId,
      event_id: subject.eventId,
      // An entry tagged "not about the venue" still keeps venue_id — the tag is
      // what the venue page filters on, the id is provenance.
      venue_id: subject.venueId,
      org_id: subject.orgId,
      about_venue: aboutVenue,
      about_client: aboutClient,
      body,
      storage_key: storageKey,
      thumb_key: storageKey ? thumbKey : null,
      width: Number.isFinite(n.width) ? Math.round(n.width as number) : null,
      height: Number.isFinite(n.height) ? Math.round(n.height as number) : null,
      taken_at: cleanDate(n.takenAt),
      pinned: n.pinned === true,
    });
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data, error } = await (db as any).from("intel_notes").insert(rows).select(SELECT);
  if (error) throw error;
  return { notes: await hydrate(db, userId, (data ?? []) as NoteRow[]) };
}

export interface NotePatch {
  body?: string | null;
  aboutVenue?: boolean;
  aboutClient?: boolean;
  pinned?: boolean;
  /** Re-home the entry; each id is proven before use. */
  eventId?: string | null;
  venueId?: string | null;
  orgId?: string | null;
}

export async function patchNote(
  db: DB,
  userId: string,
  id: string,
  patch: NotePatch
): Promise<{ note: IntelNote } | { error: string; status: number }> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const anyDb = db as any;
  const { data: cur, error: curErr } = await anyDb
    .from("intel_notes").select(SELECT).eq("id", id).eq("user_id", userId).maybeSingle();
  if (curErr) throw curErr;
  if (!cur) return { error: "Not found", status: 404 };

  const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.body !== undefined) {
    const body = cleanBody(patch.body);
    if (!body && !cur.storage_key) return { error: "A note without a photo needs some text", status: 400 };
    upd.body = body;
  }
  if (typeof patch.aboutVenue === "boolean") upd.about_venue = patch.aboutVenue;
  if (typeof patch.aboutClient === "boolean") upd.about_client = patch.aboutClient;
  if (typeof patch.pinned === "boolean") upd.pinned = patch.pinned;

  if (patch.eventId !== undefined || patch.venueId !== undefined || patch.orgId !== undefined) {
    const subject = await resolveNoteSubject(db, userId, {
      eventId: patch.eventId === undefined ? cur.event_id : patch.eventId,
      venueId: patch.venueId === undefined ? cur.venue_id : patch.venueId,
      orgId: patch.orgId === undefined ? cur.org_id : patch.orgId,
    });
    if ("error" in subject) return { error: subject.error, status: 400 };
    upd.event_id = subject.eventId;
    upd.venue_id = subject.venueId;
    upd.org_id = subject.orgId;
  }

  const { data, error } = await anyDb
    .from("intel_notes").update(upd).eq("id", id).eq("user_id", userId).select(SELECT).single();
  if (error) throw error;
  const [note] = await hydrate(db, userId, [data as NoteRow]);
  return { note };
}

/**
 * Row first, objects after. If R2 refuses, the row is already gone and the
 * orphan is reported — never the other way round, which would leave a row
 * whose image 404s.
 */
export async function deleteNote(db: DB, userId: string, id: string): Promise<boolean> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const anyDb = db as any;
  const { data, error } = await anyDb
    .from("intel_notes").delete().eq("id", id).eq("user_id", userId).select("storage_key, thumb_key").maybeSingle();
  if (error) throw error;
  if (!data) return false;
  for (const key of [data.storage_key, data.thumb_key] as (string | null)[]) {
    if (!key) continue;
    try {
      await deleteFromR2(key);
    } catch (err) {
      await reportSystemError("intel-notes.delete.r2", err, { key, noteId: id });
    }
  }
  return true;
}

/**
 * The event's venue changed: every entry that inherited the old venue follows.
 * Called from the event-intel PATCH — the one writer of `event_intel.venue_id`
 * — so the copied venue_id can never drift from the fact it was copied from.
 */
export async function repointEventNotes(db: DB, userId: string, eventId: string, venueId: string | null) {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { error } = await (db as any)
    .from("intel_notes")
    .update({ venue_id: venueId, updated_at: new Date().toISOString() })
    .eq("event_id", eventId)
    .eq("user_id", userId);
  if (error) throw error;
}
