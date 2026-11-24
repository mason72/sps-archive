/**
 * The CLIENT BTS BONUS (Mason, 2026-11-24): a crew-loved postcard (2+ Banger
 * stamps in Scout) goes into the client's own Pixeltrunk gallery, 24 h after
 * qualifying unless an admin pulls it. Scout decides WHEN; this module only
 * places and removes on request. NDA gigs are allowed here (the client's own
 * private gallery); the website path is untouched.
 *
 * DATA MODEL: a COPY, not a link. `images.event_id` is single-owner, and every
 * client-facing path reads an event's photos by it: the guest gallery
 * (`readGalleryImageRows` by event_id, with sections only grouping those rows),
 * the ZIP and single downloads (`download-core`, by event_id and r2_key), the
 * share scope and favorites. A section link to the Scout Road row would show
 * in none of them. So the copy is a new `images` row OWNED BY THE CLIENT EVENT,
 * with its own R2 objects (original + three posters, server-side copies), and
 * marked `is_crew_bts`. `scout_postcard_links.client_*` remember exactly that
 * copy, so a pull deletes it and nothing else.
 *
 * Kept out of the client's photos (`is_crew_bts`, plus by construction):
 *   - AI indexing: inserted with `ai_indexed_at` set, never selected by the
 *     batch (`index-event.ts` also filters the flag), so no faces, no
 *     embedding, no clustering (crew never become the client's "guests"),
 *     no selfie match, no Highlights pick (picks need read faces);
 *   - /people (`index-people.ts`, three reads), face-cluster naming
 *     (`cluster-event.ts`), Highlights proposals (`highlights/propose.ts`),
 *     the event's mosaic cover pool (`cover/pool.ts`), the delivery recap's
 *     photo count (`recap/payload.ts`), Sort into sections / Rebuild inputs
 *     (`auto-sections`, `section-plan`), the scene planner (`scene-plan`);
 *     the Behind-the-scenes section survives Rebuild (`rebuildKeepReason`).
 *   - There is no "new photos" email to clients in this app; nothing to skip.
 * A clip copy is the silent stored original, re-judged with the same checks
 * (`assertStoredClipIsSilent`) and copied by ETag, so no audio can arrive.
 */
import { randomUUID } from "node:crypto";
import {
  buildImageKey,
  copyWithinR2,
  deleteImageAssets,
  getThumbnailKey,
  headR2Object,
  normalizeEtag,
} from "@/lib/r2/client";
import { reportSystemError } from "@/lib/monitoring/report";
import { WEBSITE_EVENT_SLUG } from "@/lib/site/gallery";
import { WORK_EVENT_SLUG } from "@/lib/site/jobs";
import {
  ScoutIntegrationError,
  assertStoredClipIsSilent,
  deletePostcard,
  loadOwnerUserId,
  readStoredClip,
  requireLink,
  syncOrThrow,
  type ScoutDb,
} from "./store";
import {
  BTS_SECTION_NAME,
  SCOUT_BTS_KIND,
  SCOUT_ROAD_SLUG,
  calendarIdsMatch,
  paddedWindow,
} from "./validate";
import { postcardFilename, type PostcardLink } from "./postcard-state";

/** Galleries that are never a client's: the crew's own, the website, Work. */
const NOT_CLIENT_GALLERIES = new Set([SCOUT_ROAD_SLUG, WEBSITE_EVENT_SLUG, WORK_EVENT_SLUG]);
const MAX_CANDIDATES = 30;

export interface ClientGalleryCandidate {
  event_id: string;
  name: string;
  date: string | null;
  client_name: string | null;
  match: "calendar" | "series" | "date";
}

// ── GET /client-galleries ──────────────────────────────────────────────────

export async function listClientGalleries(
  db: ScoutDb,
  { date, days, calendarEventId }: { date: string | null; days: number; calendarEventId: string | null }
): Promise<ClientGalleryCandidate[]> {
  const ownerId = await loadOwnerUserId(db);

  // Calendar matches: the owner's event_intel rows that carry any calendar id,
  // matched in code: exact ("calendar") or by the recurring series ("series").
  const relation = new Map<string, "calendar" | "series">();
  if (calendarEventId) {
    // Paged by the key (PostgREST answers at most 1,000 rows per request).
    let after: string | null = null; // a uuid column: no "" sentinel
    for (;;) {
      let q = db.from("event_intel").select("event_id, calendar_event_ids").eq("user_id", ownerId);
      if (after) q = q.gt("event_id", after);
      const { data, error } = await q.order("event_id", { ascending: true }).limit(1_000);
      if (error) throw error;
      const page = data ?? [];
      for (const r of page) {
        const m = calendarIdsMatch(r.calendar_event_ids, calendarEventId);
        if (m) relation.set(r.event_id, m);
      }
      if (page.length < 1_000) break;
      after = page[page.length - 1].event_id;
    }
  }

  type EventRow = { id: string; name: string; slug: string; event_date: string | null };
  // No date: the calendar and series matches only.
  let byDate: EventRow[] = [];
  if (date) {
    const { from, to } = paddedWindow(date, days);
    const { data, error } = await db
      .from("events")
      .select("id, name, slug, event_date")
      .eq("user_id", ownerId)
      .gte("event_date", from)
      .lte("event_date", to)
      .order("event_date", { ascending: false })
      .limit(MAX_CANDIDATES * 2);
    if (error) throw error;
    byDate = data ?? [];
  }

  let byCalendar: EventRow[] = [];
  if (relation.size) {
    const { data, error } = await db
      .from("events")
      .select("id, name, slug, event_date")
      .eq("user_id", ownerId)
      .in("id", [...relation.keys()].slice(0, 100))
      .order("event_date", { ascending: false });
    if (error) throw error;
    byCalendar = data ?? [];
  }

  const seen = new Set<string>();
  const rows: (Omit<ClientGalleryCandidate, "client_name">)[] = [];
  const take = (e: EventRow, match: ClientGalleryCandidate["match"]) => {
    if (seen.has(e.id) || NOT_CLIENT_GALLERIES.has(e.slug) || rows.length >= MAX_CANDIDATES) return;
    seen.add(e.id);
    rows.push({ event_id: e.id, name: e.name, date: e.event_date, match });
  };
  // Exact calendar matches first, then the series, then the date window.
  for (const e of byCalendar) if (relation.get(e.id) === "calendar") take(e, "calendar");
  for (const e of byCalendar) if (relation.get(e.id) === "series") take(e, "series");
  for (const e of byDate) take(e, "date");

  // Client name: the payer organisation, else the end brand.
  const names = new Map<string, string>();
  if (rows.length) {
    const { data, error } = await db
      .from("event_orgs")
      .select("event_id, role, organizations!inner(name)")
      .eq("user_id", ownerId)
      .in("event_id", rows.map((r) => r.event_id))
      .in("role", ["payer", "end_brand"]);
    if (error) throw error;
    const orgRows = (data ?? []) as unknown as { event_id: string; role: string; organizations: { name: string } }[];
    for (const role of ["end_brand", "payer"]) {
      for (const r of orgRows) if (r.role === role) names.set(r.event_id, r.organizations.name);
    }
  }
  return rows.map((r) => ({ ...r, client_name: names.get(r.event_id) ?? null }));
}

// ── PUT /postcards/:id/client ──────────────────────────────────────────────

interface SourceImage {
  id: string;
  r2_key: string;
  media_type: string;
  mime_type: string | null;
  file_size: number | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  thumbnail_generated: boolean | null;
  processing_status: string;
  taken_at: string | null;
  dominant_color: string | null;
  thumb_bytes: number | null;
  focal_x: number | null;
  focal_y: number | null;
}

const SOURCE_COLUMNS =
  "id, r2_key, media_type, mime_type, file_size, width, height, duration_seconds, thumbnail_generated, processing_status, taken_at, dominant_color, thumb_bytes, focal_x, focal_y";

/** The client gallery's Behind-the-scenes section: found by name, else made at the end. */
async function ensureBtsSection(db: ScoutDb, eventId: string): Promise<string> {
  const { data: sections, error } = await db
    .from("sections")
    .select("id, name, locked, sort_order")
    .eq("event_id", eventId);
  if (error) throw error;
  const existing = (sections ?? []).find((s) => s.name.trim().toLowerCase() === BTS_SECTION_NAME.toLowerCase());
  if (existing) {
    if (existing.locked) {
      throw new ScoutIntegrationError(`"${existing.name}" is locked in this gallery; unlock it to add photos.`, 409);
    }
    return existing.id;
  }
  const last = Math.max(-1, ...(sections ?? []).map((s) => s.sort_order ?? 0));
  const { data, error: insErr } = await db
    .from("sections")
    .insert({ event_id: eventId, name: BTS_SECTION_NAME, sort_order: last + 1, is_auto: false, job_meta: { kind: SCOUT_BTS_KIND } })
    .select("id")
    .single();
  if (!insErr) return data.id;
  if (insErr.code === "23505") {
    // Made a moment ago by a concurrent placement (names are unique per gallery).
    const { data: again, error: rErr } = await db.from("sections").select("id, name, locked").eq("event_id", eventId);
    if (rErr) throw rErr;
    const hit = (again ?? []).find((s) => s.name.trim().toLowerCase() === BTS_SECTION_NAME.toLowerCase());
    if (hit && !hit.locked) return hit.id;
  }
  throw insErr;
}

/** Copy one object to another key, exactly (ETag-conditional, then verified). */
async function copyExactly(source: string, dest: string, contentType: string, etag: string, size: number) {
  try {
    await copyWithinR2(source, dest, contentType, 60_000, { ifMatch: `"${etag}"` });
  } catch (err) {
    throw new ScoutIntegrationError(
      `The archived copy changed or could not be copied (${err instanceof Error ? err.name : "error"}).`,
      502
    );
  }
  const filed = await headR2Object(dest);
  if (filed.etag !== etag || filed.size !== size) {
    throw new ScoutIntegrationError("The client copy is not the archived bytes; nothing was placed.", 502);
  }
}

export async function placeInClientGallery(
  db: ScoutDb,
  postcardId: string,
  targetEventId: string
): Promise<{ ok: true; event_id: string; section_id: string }> {
  const link = await requireLink(db, postcardId);
  const ownerId = await loadOwnerUserId(db);

  // The target must be one of the studio's own galleries, and a client one.
  const { data: target, error: tErr } = await db
    .from("events")
    .select("id, slug, user_id")
    .eq("id", targetEventId)
    .eq("user_id", ownerId)
    .maybeSingle();
  if (tErr) throw tErr;
  if (!target || NOT_CLIENT_GALLERIES.has(target.slug)) {
    throw new ScoutIntegrationError("No such client gallery.", 404);
  }

  // Idempotent: already placed in THIS gallery and the copy still exists.
  if (link.client_image_id && link.client_event_id === targetEventId) {
    const { data: copy, error } = await db
      .from("images")
      .select("id")
      .eq("id", link.client_image_id)
      .eq("event_id", targetEventId)
      .maybeSingle();
    if (error) throw error;
    if (copy) {
      return { ok: true, event_id: targetEventId, section_id: link.client_section_id ?? (await ensureBtsSection(db, targetEventId)) };
    }
  }
  // Placed somewhere else: a MOVE. The new copy is made, verified and claimed
  // FIRST; the old one is removed only after that, so a failed move (locked
  // section, not ready, a copy check) leaves the shot where it was and
  // Scout's "In <old gallery>" stays true.
  const previous = link.client_image_id
    ? { imageId: link.client_image_id, eventId: link.client_event_id ?? null }
    : null;

  const { data: src, error: sErr } = await db.from("images").select(SOURCE_COLUMNS).eq("id", link.image_id).maybeSingle();
  if (sErr) throw sErr;
  const source = src as SourceImage | null;
  if (!source) throw new ScoutIntegrationError("The postcard's archived photo no longer exists.", 404);
  if (source.processing_status !== "complete" || !source.thumbnail_generated) {
    throw new ScoutIntegrationError("The postcard is not archived yet; place it once it is ready.", 409);
  }

  const sectionId = await ensureBtsSection(db, targetEventId);
  const isVideo = source.media_type === "video";
  const ext = (source.r2_key.match(/\.([a-z0-9]+)$/i)?.[1] ?? (isVideo ? "mp4" : "jpg")).toLowerCase();
  const copyId = randomUUID();
  const filename = `${copyId}.${ext}`;
  const destKey = buildImageKey(targetEventId, filename);
  const contentType = source.mime_type ?? (isVideo ? "video/mp4" : "image/jpeg");

  let rowWritten = false;
  const rollback = async (why: string) => {
    if (rowWritten) {
      const { error } = await db.from("images").delete().eq("id", copyId).eq("is_crew_bts", true);
      if (error) await reportSystemError("scout.client-bts.rollback-row", error, { copyId, why });
    }
    const failed = await deleteImageAssets(destKey, source.media_type);
    if (failed.length) await reportSystemError("scout.client-bts.rollback-r2", new Error("R2 delete failed"), { failed, why });
  };

  try {
    // ── bytes first: exactly the archived original (a clip re-judged silent) ──
    let etag: string;
    let size: number;
    if (isVideo) {
      let readEtag: string | null = null;
      const stored = await assertStoredClipIsSilent(source.r2_key, async (k) => {
        const read = await readStoredClip(k);
        readEtag = read.etag;
        return read.buf;
      });
      etag = normalizeEtag(readEtag as string | null);
      size = stored.bytes;
    } else {
      const head = await headR2Object(source.r2_key);
      etag = head.etag;
      size = head.size;
    }
    if (!etag) throw new ScoutIntegrationError("The archived copy has no ETag; nothing was placed.", 502);
    await copyExactly(source.r2_key, destKey, contentType, etag, size);
    for (const v of ["thumb-sm", "thumb-md", "thumb-lg"] as const) {
      await copyWithinR2(getThumbnailKey(source.r2_key, v), getThumbnailKey(destKey, v), "image/jpeg", 30_000);
    }

    // ── the row, owned by the client's gallery, marked crew BTS ──
    const now = new Date().toISOString();
    const { error: insErr } = await db.from("images").insert({
      id: copyId,
      event_id: targetEventId,
      filename,
      original_filename: postcardFilename(postcardId, isVideo ? "video" : "photo"),
      r2_key: destKey,
      file_size: size,
      mime_type: contentType,
      media_type: source.media_type,
      parsed_name: null,
      processing_status: "complete",
      thumbnail_generated: true,
      thumb_bytes: source.thumb_bytes,
      width: source.width,
      height: source.height,
      duration_seconds: source.duration_seconds,
      has_audio: isVideo ? false : null,
      dominant_color: source.dominant_color,
      focal_x: source.focal_x,
      focal_y: source.focal_y,
      taken_at: source.taken_at,
      is_crew_bts: true,
      // Settled for the AI lane from the start: never indexed, never clustered.
      ai_indexed_at: now,
    });
    if (insErr) throw insErr;
    rowWritten = true;

    const { data: tail, error: tailErr } = await db
      .from("section_images")
      .select("sort_order")
      .eq("section_id", sectionId)
      .order("sort_order", { ascending: false })
      .limit(1);
    if (tailErr) throw tailErr;
    const { error: linkErr } = await db
      .from("section_images")
      .insert({ section_id: sectionId, image_id: copyId, sort_order: (tail?.[0]?.sort_order ?? -1) + 1 });
    if (linkErr) throw linkErr;

    // ── claim the placement, conditional on what this request read (none, or
    // the copy it is moving away from); a concurrent PUT that won keeps its copy ──
    const claim = db
      .from("scout_postcard_links")
      .update({ client_event_id: targetEventId, client_image_id: copyId, client_section_id: sectionId, client_placed_at: now })
      .eq("postcard_id", postcardId);
    const { data: claimed, error: claimErr } = await (previous
      ? claim.eq("client_image_id", previous.imageId)
      : claim.is("client_image_id", null)
    ).select("postcard_id");
    if (claimErr) throw claimErr;
    if (!claimed?.length) {
      await rollback("lost the placement race");
      const winner = await requireLink(db, postcardId);
      if (winner.client_event_id === targetEventId && winner.client_section_id) {
        return { ok: true, event_id: targetEventId, section_id: winner.client_section_id };
      }
      throw new ScoutIntegrationError("A concurrent placement moved this postcard; retry.", 409);
    }
  } catch (err) {
    await rollback(err instanceof Error ? err.message : String(err));
    throw err;
  }

  // The new copy is in place and recorded: now, and only now, the old one goes.
  if (previous) {
    try {
      await deleteClientCopy(db, postcardId, previous.imageId, previous.eventId);
    } catch (err) {
      // The move stands; the old copy is reported so it can be removed by hand.
      await reportSystemError("scout.client-bts.move-old-copy", err, {
        postcardId,
        imageId: previous.imageId,
        eventId: previous.eventId,
      });
    }
  }
  return { ok: true, event_id: targetEventId, section_id: sectionId };
}

// ── DELETE /postcards/:id/client ───────────────────────────────────────────

/**
 * Take the postcard out of whatever client gallery holds it: deletes exactly
 * the recorded copy (its row and its R2 objects), only if that row is a crew
 * BTS copy in the recorded gallery, and clears the link. Removal wins over a
 * locked section: the copy is Scout's, and a pulled postcard must leave.
 */
export async function removeFromClientGallery(
  db: ScoutDb,
  postcardId: string,
  link?: PostcardLink
): Promise<{ removed: boolean }> {
  const current = link ?? (await requireLink(db, postcardId));
  let removed = false;
  if (current.client_image_id) {
    removed = await deleteClientCopy(db, postcardId, current.client_image_id, current.client_event_id ?? null);
  }
  if (current.client_image_id || current.client_event_id || current.client_section_id) {
    const { error } = await db
      .from("scout_postcard_links")
      .update({ client_event_id: null, client_image_id: null, client_section_id: null, client_placed_at: null })
      .eq("postcard_id", postcardId);
    if (error) throw error;
  }
  return { removed };
}

/**
 * Delete ONE client copy (row and R2 objects), only if it is a crew BTS copy in
 * the expected gallery; otherwise touch nothing and report. True if deleted.
 */
async function deleteClientCopy(
  db: ScoutDb,
  postcardId: string,
  copyId: string,
  expectedEventId: string | null
): Promise<boolean> {
  let removed = false;
  {
    const { data: copy, error } = await db
      .from("images")
      .select("id, event_id, r2_key, media_type, site_published_at, is_crew_bts")
      .eq("id", copyId)
      .maybeSingle();
    if (error) throw error;
    if (copy && copy.is_crew_bts && copy.event_id === expectedEventId) {
      if (copy.site_published_at) {
        // Someone published the copy to the website: take it off first, so no
        // public copy outlives the row.
        const { data: memberships, error: mErr } = await db
          .from("section_images")
          .select("section_id, sections!inner(site_scene_key)")
          .eq("image_id", copy.id);
        if (mErr) throw mErr;
        const siteSections = ((memberships ?? []) as unknown as { section_id: string; sections: { site_scene_key: string | null } }[])
          .filter((m) => m.sections.site_scene_key)
          .map((m) => m.section_id);
        if (siteSections.length) {
          const { error: dErr } = await db.from("section_images").delete().eq("image_id", copy.id).in("section_id", siteSections);
          if (dErr) throw dErr;
        }
        await syncOrThrow(db, copy.id, "unpublish");
      }
      const { error: delErr } = await db.from("images").delete().eq("id", copy.id).eq("is_crew_bts", true);
      if (delErr) throw delErr;
      const failed = await deleteImageAssets(copy.r2_key, copy.media_type);
      if (failed.length) {
        await reportSystemError("scout.client-bts.delete-r2", new Error("R2 delete failed"), { imageId: copy.id, failed });
      }
      removed = true;
    } else if (copy) {
      // The recorded id now names a row that is not our copy: touch nothing.
      await reportSystemError("scout.client-bts.not-our-copy", new Error("client_image_id is not a crew BTS copy"), {
        postcardId,
        imageId: copy.id,
      });
    }
  }
  return removed;
}

/**
 * DELETE /postcards/:id: the client placement goes FIRST (deleting the archived
 * row cascades the link, and with it the only record of the client copy).
 */
export async function deletePostcardEverywhere(db: ScoutDb, postcardId: string) {
  const placement = await removeFromClientGallery(db, postcardId);
  const result = await deletePostcard(db, postcardId);
  return { ...result, removed_from_client_gallery: placement.removed };
}
