import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Gallery status — TWO independent axes, deliberately never merged.
 *
 * **Delivery** is a ladder: draft → published → sent → opened → downloaded.
 * Each rung answers "what do I do next", which is the only test a status badge
 * has to pass.
 *
 * **Readiness** (uploads landing, AI indexing) is orthogonal and can be
 * mid-flight at ANY rung. Mason, 2026-08-10: "I'll often send a gallery as
 * soon as it's uploaded, but the processing may not have happened yet."
 * Folding processing into the ladder would have shown "Processing" for a
 * gallery the client was already browsing — wrong exactly when it matters.
 *
 * The evidence rule that shapes the ladder: **a view proves delivery, an email
 * only proves an attempt.** Measured on the live archive 2026-08-10, all 15
 * published galleries had been opened but only 9 were emailed from
 * Pixeltrunk — six links were pasted into a text or Slack. Treating "we sent
 * an email" as the definition of shared would have parked those six at
 * "Published" forever, and a badge that lies is worse than no badge.
 */

export type DeliveryStage =
  | "draft" // photos, no live link — your move
  | "published" // link is live, no evidence anyone has it — you owe someone a link
  | "sent" // emailed from Pixeltrunk, not yet opened — waiting on them
  | "opened" // someone has been in
  | "downloaded"; // they took the files — done

export interface DeliveryStatus {
  stage: DeliveryStage;
  /** Past its expiry while still flagged active — silently dead. */
  expired: boolean;
  lastViewedAt: string | null;
  viewCount: number;
}

export interface Readiness {
  /** Rows presigned but not yet settled (bytes still arriving). */
  uploading: number;
  indexed: number;
  total: number;
  /** Every settled photo carries an AI index. */
  ready: boolean;
}

export interface EventStatus {
  delivery: DeliveryStatus;
  readiness: Readiness;
}

/**
 * Resolve both axes for a page of events in a fixed number of queries —
 * never one query per card.
 */
export async function resolveEventStatuses(
  supabase: SupabaseClient,
  eventIds: string[]
): Promise<Map<string, EventStatus>> {
  const out = new Map<string, EventStatus>();
  if (eventIds.length === 0) return out;

  const now = Date.now();

  const [sharesRes, emailsRes, activityRes, imagesRes] = await Promise.all([
    supabase
      .from("shares")
      .select("event_id, is_active, expires_at, view_count, last_viewed_at")
      .in("event_id", eventIds),
    supabase
      .from("email_sends")
      .select("event_id")
      .in("event_id", eventIds)
      .eq("status", "sent"),
    supabase
      .from("activity_log")
      .select("event_id, action")
      .in("event_id", eventIds)
      .in("action", ["gallery_download", "image_download"]),
    // Readiness needs per-image state; ids only, paged by the caller's page
    // size (an archive page is ~24 events, so this stays bounded).
    supabase
      .from("images")
      .select("event_id, processing_status, ai_indexed_at, media_type")
      .in("event_id", eventIds)
      .eq("media_type", "image"),
  ]);

  // A Supabase error is a RETURN VALUE — `data || []` would turn a 400 into a
  // believable "no shares exist", i.e. every gallery silently reading Draft.
  for (const [label, res] of [
    ["shares", sharesRes],
    ["email_sends", emailsRes],
    ["activity_log", activityRes],
    ["images", imagesRes],
  ] as const) {
    if (res.error) throw new Error(`status:${label}: ${res.error.message}`);
  }

  const emailed = new Set(
    (emailsRes.data ?? []).map((r) => (r as { event_id: string }).event_id)
  );
  const downloaded = new Set(
    (activityRes.data ?? []).map((r) => (r as { event_id: string }).event_id)
  );

  type ShareRow = {
    event_id: string;
    is_active: boolean;
    expires_at: string | null;
    view_count: number | null;
    last_viewed_at: string | null;
  };
  const shareAgg = new Map<
    string,
    { live: boolean; expired: boolean; views: number; lastViewed: string | null }
  >();
  for (const row of (sharesRes.data ?? []) as ShareRow[]) {
    const cur =
      shareAgg.get(row.event_id) ??
      { live: false, expired: false, views: 0, lastViewed: null as string | null };
    const past = !!row.expires_at && new Date(row.expires_at).getTime() < now;
    if (row.is_active && !past) cur.live = true;
    // Expired only counts as a problem while the share still claims to be on.
    if (row.is_active && past) cur.expired = true;
    cur.views += row.view_count ?? 0;
    if (
      row.last_viewed_at &&
      (!cur.lastViewed || row.last_viewed_at > cur.lastViewed)
    ) {
      cur.lastViewed = row.last_viewed_at;
    }
    shareAgg.set(row.event_id, cur);
  }

  type ImageRow = {
    event_id: string;
    processing_status: string | null;
    ai_indexed_at: string | null;
  };
  const imgAgg = new Map<string, { uploading: number; indexed: number; total: number }>();
  for (const row of (imagesRes.data ?? []) as ImageRow[]) {
    const cur = imgAgg.get(row.event_id) ?? { uploading: 0, indexed: 0, total: 0 };
    if (row.processing_status === "complete") {
      cur.total += 1;
      if (row.ai_indexed_at) cur.indexed += 1;
    } else if (row.processing_status === "pending") {
      cur.uploading += 1;
    }
    imgAgg.set(row.event_id, cur);
  }

  for (const eventId of eventIds) {
    const share = shareAgg.get(eventId);
    const img = imgAgg.get(eventId) ?? { uploading: 0, indexed: 0, total: 0 };

    let stage: DeliveryStage = "draft";
    if (share?.live) {
      stage = "published";
      if (emailed.has(eventId)) stage = "sent";
      // A view outranks an email: it's proof of arrival regardless of how the
      // link travelled, which is how six of Mason's fifteen were delivered.
      if ((share.views ?? 0) > 0) stage = "opened";
      if (downloaded.has(eventId)) stage = "downloaded";
    }

    out.set(eventId, {
      delivery: {
        stage,
        expired: !!share?.expired,
        lastViewedAt: share?.lastViewed ?? null,
        viewCount: share?.views ?? 0,
      },
      readiness: {
        uploading: img.uploading,
        indexed: img.indexed,
        total: img.total,
        // An event with no settled photos isn't "ready", it's empty — callers
        // show nothing rather than a green tick on an empty gallery.
        ready: img.total > 0 && img.indexed >= img.total && img.uploading === 0,
      },
    });
  }

  return out;
}

export const DELIVERY_LABEL: Record<DeliveryStage, string> = {
  draft: "Draft",
  published: "Published",
  sent: "Sent",
  opened: "Opened",
  downloaded: "Downloaded",
};
