import { randomBytes, createHash } from "node:crypto";
import type { createServiceClient } from "@/lib/supabase/server";

type SupabaseDB = ReturnType<typeof createServiceClient>;

/**
 * The guest-list spreadsheet attached to an event — the SPS analytics export
 * the photographer hands their client alongside the gallery.
 *
 * THIS FILE IS PII. It carries guest names, email addresses and sign-in
 * answers, so three rules hold everywhere it is touched:
 *
 *  1. **It is reachable ONLY by the token minted for the publish email**
 *     (Mason, 2026-08-11: "this is only going to the client we email the
 *     gallery to in the Publish workflow. This should not be available
 *     anywhere else."). It is not on the gallery, not behind the share slug,
 *     not in any guest nav. A guest who never received the email has no path.
 *  2. **The token is stored HASHED.** A database leak must not hand anyone a
 *     working download link, and we never need the original back — only the
 *     ability to check one presented at the door.
 *  3. **It dies with the share.** Revoking is a single field, and the
 *     download route re-checks that a live share still exists.
 *
 * Stored on `events.settings.guestList` rather than its own table: it is one
 * optional attachment per event, and settings is already the event's
 * owner-scoped JSONB bag.
 */

export interface GuestListMeta {
  /** R2 key of the stored CSV. */
  key: string;
  /** What the photographer's file was called, for the download filename. */
  filename: string;
  uploadedAt: string;
  /** SHA-256 of the token. The token itself exists only in the email. */
  tokenHash: string;
  /** Where the numbers came from, for the audit trail. */
  source: "manual-upload" | "sps-api";
  /** Carried through so the download sets the right type — SPS exports XLSX. */
  contentType?: string;
  sizeBytes: number;
}

export function guestListKey(eventId: string, ext = "xlsx"): string {
  return `events/${eventId}/attachments/guest-list.${ext}`;
}

/** One-way, and constant-time compared at the door. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 32 bytes of entropy — a guessable id here leaks a client's guest list. */
export function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

export function readGuestList(settings: unknown): GuestListMeta | null {
  const gl = (settings as { guestList?: GuestListMeta } | null)?.guestList;
  if (!gl?.key || !gl.tokenHash) return null;
  return gl;
}

/**
 * Find the event a token belongs to.
 *
 * Scans events carrying a guest list and compares HASHES — there is no index
 * on a hash inside JSONB, and the population is tiny (one row per event that
 * has ever attached a sheet). If that ever stops being true this moves to its
 * own table with a unique index on the hash; it is not worth one today.
 */
export async function findEventByGuestListToken(
  supabase: SupabaseDB,
  token: string
): Promise<{ eventId: string; userId: string | null; meta: GuestListMeta } | null> {
  const wanted = hashToken(token);
  const { data, error } = await supabase
    .from("events")
    .select("id, user_id, settings")
    .not("settings->guestList", "is", null);
  if (error) throw error;

  for (const row of (data ?? []) as {
    id: string;
    user_id: string | null;
    settings: unknown;
  }[]) {
    const meta = readGuestList(row.settings);
    if (meta && meta.tokenHash === wanted) {
      return { eventId: row.id, userId: row.user_id, meta };
    }
  }
  return null;
}
