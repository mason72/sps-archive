import { createServiceClient } from "@/lib/supabase/server";
import { renderEmailShell } from "@/lib/email/shell";
import { reportSystemError } from "@/lib/monitoring/report";
import {
  selectDigestCandidates,
  buildDigestEmailBody,
  type DigestCandidate,
  type FavoriteRow,
} from "./digest";

/**
 * I/O half of the favorites digest (the pure half lives in ./digest). Used by
 * the Inngest cron and by verification scripts.
 */

/** How far back to scan for favorites (bounds the cron's query). */
const SCAN_DAYS = 90;

/** Fetch candidate shares due a digest right now. */
export async function findDigestCandidates(
  supabase: ReturnType<typeof createServiceClient>,
  now: Date
): Promise<DigestCandidate[]> {
  const since = new Date(
    now.getTime() - SCAN_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("favorites")
    .select(
      "share_id, image_id, created_at, shares!inner(slug, event_id, digested_at, is_active)"
    )
    .eq("shares.is_active", true)
    .gte("created_at", since);

  if (error) throw error;

  const rows: FavoriteRow[] = (data ?? []).map((r) => ({
    share_id: r.share_id,
    image_id: r.image_id,
    created_at: r.created_at,
    share: r.shares as unknown as FavoriteRow["share"],
  }));

  return selectDigestCandidates(rows, now);
}

export type DigestSendResult =
  | "sent"
  | "skipped-no-provider"
  | "skipped-no-owner-email"
  | "skipped-no-app-url";

/** Build + send one share's digest email, then advance the watermark. */
export async function sendShareDigest(
  supabase: ReturnType<typeof createServiceClient>,
  candidate: DigestCandidate,
  now: Date
): Promise<DigestSendResult> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return "skipped-no-provider";

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    void reportSystemError(
      "favorites.digest",
      "NEXT_PUBLIC_APP_URL is not set — digest emails can't build links"
    );
    return "skipped-no-app-url";
  }

  // Event name + owner
  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("name, user_id")
    .eq("id", candidate.eventId)
    .single();
  if (eventError || !event) throw eventError ?? new Error("event not found");
  // events.user_id is nullable — an ownerless event has nobody to digest to.
  if (!event.user_id) return "skipped-no-owner-email";

  const { data: owner } = await supabase.auth.admin.getUserById(event.user_id);
  const ownerEmail = owner?.user?.email;
  if (!ownerEmail) return "skipped-no-owner-email";

  // Total favorites on this share (for "(N total)" context on re-digests)
  const { count: totalCount } = await supabase
    .from("favorites")
    .select("id", { count: "exact", head: true })
    .eq("share_id", candidate.shareId);

  const newCount = candidate.newImageIds.length;
  const galleryUrl = `${appUrl}/events/${candidate.eventId}`;
  const body = buildDigestEmailBody({
    eventName: event.name,
    newCount,
    totalCount: totalCount ?? newCount,
    previewUrls: candidate.previewImageIds.map(
      (id) => `${appUrl}/api/gallery/${candidate.slug}/fav-thumb/${id}`
    ),
    galleryUrl,
  });

  const html = renderEmailShell({
    body,
    galleryUrl,
    fromName: "Pixeltrunk",
    buttonLabel: "View Favorites",
  });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `Pixeltrunk <${process.env.RESEND_FROM_EMAIL || "gallery@resend.dev"}>`,
      to: [ownerEmail],
      subject: `${newCount} favorite${newCount === 1 ? "" : "s"} selected — ${event.name}`,
      html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    void reportSystemError("favorites.digest", err, {
      shareId: candidate.shareId,
    });
    throw new Error(`Resend ${res.status}: ${err.slice(0, 200)}`);
  }

  // Watermark AFTER a successful send — a failed send retries next cron tick.
  const { error: markError } = await supabase
    .from("shares")
    .update({ digested_at: now.toISOString() })
    .eq("id", candidate.shareId);
  if (markError) throw markError;

  return "sent";
}
