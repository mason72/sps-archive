/**
 * Crew faces — the reference set behind "recognise the crew".
 *
 * Full design: `tasks/crew-faces.md`. The two rules that shape everything here:
 *
 *  1. A reference SET, not one face. ArcFace across years, beards and haircuts
 *     wants several embeddings; `is_avatar` marks the one a human looks at
 *     (Mason: "pin or star or whatever makes sense").
 *  2. Crew identity never touches `persons.name`. That is the GUEST identity
 *     space; `crew_persons` keeps the association internal and reversible.
 *
 * OWNERSHIP. Callers hand in the SERVICE client, so every read and write here
 * is scoped by `userId` explicitly — same contract as apply-gig.ts, same two
 * shipped IDORs behind it. And the FEATURE is gated a layer up (`getIntelUser`
 * on every route); the filters here are what keep the data safe if that gate
 * is ever mis-set. Two protections, neither optional.
 */
import {
  deleteFromR2,
  getCachedThumbnailUrl,
  getThumbnailKey,
  uploadToR2,
} from "@/lib/r2/client";
import { recordUsage, secondsSince } from "@/lib/usage/record";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Everything a client needs to draw one reference face. */
export interface CrewFaceView {
  id: string;
  /** Where the pixels live — an archive thumbnail or the uploaded file. */
  url: string;
  bbox: FaceBox | null;
  imageWidth: number | null;
  imageHeight: number | null;
  isAvatar: boolean;
  source: string;
  /** Set when the reference came from an archive photo that still exists. */
  imageId: string | null;
  /**
   * Where a click can GO — Mason: "if they're in a gallery we should be able
   * to go look at the images." The event holding the source photo, and the
   * face cluster there when its detection still exists, so the strip links to
   * the person's card in that gallery. Null for uploads and for references
   * whose source has since been deleted — matchable, not visitable.
   */
  sourceEventId: string | null;
  sourcePersonId: string | null;
}

const clamp01 = (v: unknown): number =>
  Math.min(1, Math.max(0, typeof v === "number" && Number.isFinite(v) ? v : 0));

function cleanBox(raw: unknown): FaceBox | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const box = { x: clamp01(b.x), y: clamp01(b.y), w: clamp01(b.w), h: clamp01(b.h) };
  return box.w > 0 && box.h > 0 ? box : null;
}

/**
 * Resolve stored reference rows into renderable views.
 *
 * A reference whose pixels are GONE (archive photo deleted, upload key
 * missing) resolves to null and is skipped — the embedding still matches, so
 * the row stays; only the picture is unavailable. That asymmetry is the whole
 * reason the embedding is a snapshot.
 */
async function resolveViews(
  db: Db,
  rows: {
    id: string;
    image_id: string | null;
    face_id?: string | null;
    storage_key: string | null;
    bbox: unknown;
    is_avatar: boolean;
    source: string;
  }[]
): Promise<CrewFaceView[]> {
  const imageIds = [...new Set(rows.map((r) => r.image_id).filter(Boolean))] as string[];
  const imageById = new Map<
    string,
    { r2_key: string; width: number | null; height: number | null; event_id: string }
  >();
  if (imageIds.length) {
    const { data } = await db
      .from("images")
      .select("id, r2_key, width, height, event_id")
      .in("id", imageIds);
    for (const img of data ?? []) imageById.set(img.id, img);
  }

  // The cluster each reference face belongs to, for the click-through. Looked
  // up live rather than stored: clusters merge and re-form, and a stale
  // person id would open the wrong card.
  const faceIds = [...new Set(rows.map((r) => r.face_id).filter(Boolean))] as string[];
  const personByFace = new Map<string, string | null>();
  if (faceIds.length) {
    const { data } = await db.from("faces").select("id, person_id").in("id", faceIds);
    for (const f of data ?? []) personByFace.set(f.id, f.person_id);
  }

  const out: CrewFaceView[] = [];
  for (const r of rows) {
    const img = r.image_id ? imageById.get(r.image_id) : null;
    if (img) {
      out.push({
        id: r.id,
        url: await getCachedThumbnailUrl(getThumbnailKey(img.r2_key)),
        bbox: cleanBox(r.bbox),
        imageWidth: img.width,
        imageHeight: img.height,
        isAvatar: r.is_avatar,
        source: r.source,
        imageId: r.image_id,
        sourceEventId: img.event_id,
        sourcePersonId: (r.face_id && personByFace.get(r.face_id)) || null,
      });
    } else if (r.storage_key) {
      out.push({
        id: r.id,
        url: await getCachedThumbnailUrl(r.storage_key),
        bbox: cleanBox(r.bbox),
        // Uploads carry their box normalized, so the crop math needs no pixel
        // dimensions — FaceCrop treats null dims as "bbox is already relative".
        imageWidth: null,
        imageHeight: null,
        isAvatar: r.is_avatar,
        source: r.source,
        imageId: null,
        sourceEventId: null,
        sourcePersonId: null,
      });
    }
    // else: pixels gone everywhere — matchable, not drawable. Skipped.
  }
  return out;
}

/**
 * The avatar for each of a set of crew ids, for lists.
 *
 * The avatar is the starred reference, else the NEWEST drawable one — a person
 * with references but no explicit pick still gets a face, because an initials
 * circle beside an unpinned reference set reads as "no photos exist".
 */
export async function crewAvatars(
  db: Db,
  userId: string,
  crewIds: string[]
): Promise<Record<string, CrewFaceView | null>> {
  const out: Record<string, CrewFaceView | null> = {};
  if (!crewIds.length) return out;

  const { data, error } = await db
    .from("crew_faces")
    .select("id, crew_id, image_id, face_id, storage_key, bbox, is_avatar, source")
    .eq("user_id", userId)
    .in("crew_id", crewIds)
    .order("is_avatar", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;

  const firstByCrew = new Map<string, (typeof data)[number][]>();
  for (const r of data ?? []) {
    const list = firstByCrew.get(r.crew_id) ?? [];
    list.push(r);
    firstByCrew.set(r.crew_id, list);
  }

  for (const id of crewIds) {
    const rows = firstByCrew.get(id) ?? [];
    // Resolve one at a time down the preference order, because the preferred
    // row can be undrawable (its photo deleted) while a later one is fine.
    out[id] = null;
    for (const row of rows) {
      const [view] = await resolveViews(db, [row]);
      if (view) {
        out[id] = view;
        break;
      }
    }
  }
  return out;
}

/** Every drawable reference for one person, avatar first, newest next. */
export async function crewFaceSet(
  db: Db,
  userId: string,
  crewId: string
): Promise<CrewFaceView[]> {
  const { data, error } = await db
    .from("crew_faces")
    .select("id, image_id, face_id, storage_key, bbox, is_avatar, source")
    .eq("user_id", userId)
    .eq("crew_id", crewId)
    .order("is_avatar", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return resolveViews(db, data ?? []);
}

/** Does this crew id belong to this user? The routes' pre-write check. */
export async function ownsCrew(db: Db, userId: string, crewId: string): Promise<boolean> {
  const { data } = await db
    .from("crew")
    .select("id")
    .eq("user_id", userId)
    .eq("id", crewId)
    .maybeSingle();
  return !!data;
}

/**
 * Add a reference from an ARCHIVE face the user pointed at.
 *
 * The face's embedding and box are SNAPSHOTTED into the reference — setup
 * frames are exactly the photos most likely to be deleted later, and deleting
 * one must not un-teach the recognition.
 */
export async function addTaggedFace(
  db: Db,
  {
    userId,
    crewId,
    faceId,
    source = "tagged",
  }: { userId: string; crewId: string; faceId: string; source?: "tagged" | "confirmed-suggestion" }
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  // The face id arrives from a request body: prove it sits in this user's own
  // archive before anything is written.
  //
  // The events embed is HINTED (`!images_event_id_fkey`) because images and
  // events are related twice — images.event_id up, events.cover_image_id back —
  // and PostgREST refuses an ambiguous path outright: "more than one
  // relationship was found". Found live, not in review, because the identical
  // unhinted embed works fine on tables with a single relationship, and the
  // failure was hiding inside a best-effort catch.
  const { data: face, error: fErr } = await db
    .from("faces")
    .select(
      "id, image_id, bbox_x, bbox_y, bbox_w, bbox_h, embedding, images!inner(id, events!images_event_id_fkey!inner(user_id))"
    )
    .eq("id", faceId)
    .eq("images.events.user_id", userId)
    .maybeSingle();
  if (fErr) return { ok: false, error: fErr.message };
  if (!face) return { ok: false, error: "That face is not in your archive." };

  // Re-tagging the same face is a no-op, not a duplicate — confirming a
  // suggestion twice (easy: the panel refetches) must not stack references.
  const { data: existing } = await db
    .from("crew_faces")
    .select("id")
    .eq("user_id", userId)
    .eq("crew_id", crewId)
    .eq("face_id", faceId)
    .maybeSingle();
  if (existing) return { ok: true, id: existing.id };

  const { count } = await db
    .from("crew_faces")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("crew_id", crewId);

  const { data: made, error } = await db
    .from("crew_faces")
    .insert({
      user_id: userId,
      crew_id: crewId,
      embedding: face.embedding,
      image_id: face.image_id,
      face_id: face.id,
      bbox: { x: face.bbox_x, y: face.bbox_y, w: face.bbox_w, h: face.bbox_h },
      source,
      // The first reference becomes the avatar without being asked — a face on
      // the name beats an initials circle, and the star can move it later.
      is_avatar: (count ?? 0) === 0,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: made.id };
}

/** ~6MB pre-base64; matches the Modal endpoint's own cap. */
const MAX_UPLOAD_B64 = 8 * 1024 * 1024;

/**
 * Add a reference from an UPLOADED photo — the seed path for the 49 crew with
 * no events, and Mason's ask: "we should be able to add crew images manually
 * from the Intel > crew > details pane."
 *
 * Modal finds the faces; the BEST one becomes the reference. Several faces in
 * the frame is fine for seeding (the best-quality detection is almost always
 * the subject), and a wrong pick is one visible delete away from fixed.
 */
export async function addUploadedFace(
  db: Db,
  { userId, crewId, imageBase64 }: { userId: string; crewId: string; imageBase64: string }
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!imageBase64 || imageBase64.length > MAX_UPLOAD_B64) {
    return { ok: false, error: "Image must be under 6MB." };
  }

  const started = Date.now();
  const res = await fetch(process.env.MODAL_AI_SELFIE_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pipeline_key: process.env.VIDEO_PIPELINE_KEY,
      image_b64: imageBase64,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) return { ok: false, error: "Face detection did not answer." };
  await recordUsage({
    userId,
    kind: "ai_embed_selfie",
    quantity: secondsSince(started),
    unit: "seconds",
  });

  const { faces } = (await res.json()) as {
    faces: { embedding: number[] | null; quality: number; bbox?: FaceBox | null }[];
  };
  const best = (faces ?? [])
    .filter((f) => f.embedding)
    .sort((a, b) => b.quality - a.quality)[0];
  if (!best) return { ok: false, error: "No usable face in that photo." };

  // The uploaded file itself is kept (privately) so the reference has pixels
  // to show. crew-faces/ is its own prefix: these are staff reference photos,
  // and a sweep of event imagery must never catch them.
  const storageKey = `crew-faces/${userId}/${crewId}/${crypto.randomUUID()}.jpg`;
  await uploadToR2(storageKey, Buffer.from(imageBase64, "base64"), "image/jpeg");

  const { count } = await db
    .from("crew_faces")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("crew_id", crewId);

  const { data: made, error } = await db
    .from("crew_faces")
    .insert({
      user_id: userId,
      crew_id: crewId,
      embedding: JSON.stringify(best.embedding),
      storage_key: storageKey,
      bbox: best.bbox ?? null,
      source: "upload",
      is_avatar: (count ?? 0) === 0,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: made.id };
}

/**
 * Hosts a tag-at-import URL may point at — SPS's own presigned/public storage
 * and this app's, nothing else.
 *
 * The URL arrives from a request body, and a server that fetches
 * caller-supplied URLs is an SSRF the day someone passes it an internal
 * address. Every legitimate URL on the import review screen was minted by SPS
 * (its R2 bucket or its API host) or by this app's own bucket, so the
 * allowlist costs nothing real.
 */
function urlHostAllowed(u: URL): boolean {
  if (u.protocol !== "https:") return false;
  const h = u.hostname;
  const spsHost = new URL(
    process.env.SPS_ARCHIVE_BASE_URL ||
      "https://admin2.simplephotoshare.com/api/integrations/archive"
  ).hostname;
  return (
    h === spsHost ||
    h.endsWith(".r2.dev") ||
    h.endsWith(".r2.cloudflarestorage.com")
  );
}

/**
 * Add a reference from a photo that lives at a URL — the tag-at-import path.
 *
 * Mason's decision (2026-08-15): at SPS import review, "tag it, still skip the
 * frame" — the face is kept, the setup frame is not. The frame is not in the
 * archive (that is the point), so there is no `faces` row to snapshot; this
 * fetches the pixels, downscales anything camera-sized to what the detector
 * wants, and rides the upload path from there.
 */
export async function addFaceFromUrl(
  db: Db,
  { userId, crewId, imageUrl }: { userId: string; crewId: string; imageUrl: string }
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    return { ok: false, error: "Not a URL." };
  }
  if (!urlHostAllowed(parsed)) {
    return { ok: false, error: "That image is not on SPS or this archive." };
  }

  const res = await fetch(parsed, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
  if (!res?.ok) {
    // Presigned URLs expire in an hour — the likely cause, and the fix is to
    // reopen the review screen, so say that instead of a bare failure.
    return { ok: false, error: "Couldn't fetch that frame — its link may have expired. Reopen the review and try again." };
  }
  let buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 40 * 1024 * 1024) {
    return { ok: false, error: "That file is too large to be a photo frame." };
  }

  // A camera original can be 8MB+; the detector caps at ~6MB decoded and a
  // face survives 2400px comfortably. Only re-encode when needed — a 200px
  // thumbnail through sharp is pure loss.
  if (buf.length > 4 * 1024 * 1024) {
    const sharp = (await import("sharp")).default;
    buf = Buffer.from(
      await sharp(buf).rotate().resize(2400, 2400, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
    );
  }

  return addUploadedFace(db, {
    userId,
    crewId,
    imageBase64: buf.toString("base64"),
  });
}

/** The pin. Clears the old star first — the DB enforces exactly one. */
export async function setAvatar(
  db: Db,
  { userId, crewId, faceRefId }: { userId: string; crewId: string; faceRefId: string }
): Promise<{ ok: boolean; error?: string }> {
  const { error: clearErr } = await db
    .from("crew_faces")
    .update({ is_avatar: false })
    .eq("user_id", userId)
    .eq("crew_id", crewId)
    .eq("is_avatar", true);
  if (clearErr) return { ok: false, error: clearErr.message };

  const { data, error } = await db
    .from("crew_faces")
    .update({ is_avatar: true })
    .eq("user_id", userId)
    .eq("crew_id", crewId)
    .eq("id", faceRefId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "No such reference." };
  return { ok: true };
}

/**
 * Remove one reference — or with `all`, the person's ENTIRE face record:
 * references, uploaded files, and cluster links. A freelancer can ask, and the
 * answer has to be one call.
 */
export async function deleteFaces(
  db: Db,
  { userId, crewId, faceRefId, all = false }: { userId: string; crewId: string; faceRefId?: string; all?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  let q = db
    .from("crew_faces")
    .delete()
    .eq("user_id", userId)
    .eq("crew_id", crewId);
  if (!all) {
    if (!faceRefId) return { ok: false, error: "faceRefId or all is required" };
    q = q.eq("id", faceRefId);
  }
  const { data, error } = await q.select("id, storage_key, is_avatar");
  if (error) return { ok: false, error: error.message };

  // Uploaded files go with their rows — a reference photo with no row is an
  // orphan nobody can see or delete.
  for (const r of data ?? []) {
    if (r.storage_key) await deleteFromR2(r.storage_key).catch(() => {});
  }

  if (all) {
    const { error: pErr } = await db
      .from("crew_persons")
      .delete()
      .eq("user_id", userId)
      .eq("crew_id", crewId);
    if (pErr) return { ok: false, error: pErr.message };
  } else if ((data ?? []).some((r: { is_avatar: boolean }) => r.is_avatar)) {
    // The star moved off the deleted row — hand it to the newest survivor so
    // the person does not silently fall back to initials while references
    // still exist.
    const { data: next } = await db
      .from("crew_faces")
      .select("id")
      .eq("user_id", userId)
      .eq("crew_id", crewId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (next) {
      await db.from("crew_faces").update({ is_avatar: true }).eq("id", next.id);
    }
  }
  return { ok: true };
}
