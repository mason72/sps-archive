/**
 * Usage metering writer — the flow side of cost tracking.
 *
 * One call per metered operation (Modal round-trip, zip build, email send),
 * attributed to the OWNING user (for guest-triggered work — gallery search,
 * selfie search, zip downloads — that's the event owner, since they're the
 * account the cost belongs to).
 *
 * recordUsage never throws and never blocks the caller's happy path: metering
 * must not be able to take down the operation it measures. Failures go
 * through reportSystemError (throttled), so a broken meter is loud in
 * system_errors rather than silently absent from the ledger.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { reportSystemError } from "@/lib/monitoring/report";

export type UsageKind =
  | "ai_index"
  | "ai_embed_text"
  | "ai_embed_selfie"
  | "video_process"
  | "zip_build"
  | "cover_raster"
  | "email_send";

export type UsageUnit = "seconds" | "bytes" | "images" | "emails";

export interface UsageEvent {
  userId: string;
  eventId?: string | null;
  kind: UsageKind;
  quantity: number;
  unit: UsageUnit;
  metadata?: Record<string, unknown>;
}

export async function recordUsage(u: UsageEvent): Promise<void> {
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.from("usage_events").insert({
      user_id: u.userId,
      event_id: u.eventId ?? null,
      kind: u.kind,
      quantity: u.quantity,
      unit: u.unit,
      metadata: u.metadata ? JSON.parse(JSON.stringify(u.metadata)) : null,
    });
    if (error) {
      await reportSystemError("usage.record", error, {
        kind: u.kind,
        userId: u.userId,
        eventId: u.eventId ?? undefined,
      });
    }
  } catch (err) {
    await reportSystemError("usage.record", err, {
      kind: u.kind,
      userId: u.userId,
      eventId: u.eventId ?? undefined,
    });
  }
}

/** Seconds elapsed since `startedMs` (Date.now()), rounded to ms precision. */
export function secondsSince(startedMs: number): number {
  return Math.round(Date.now() - startedMs) / 1000;
}
