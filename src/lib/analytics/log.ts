import { createServiceClient } from "@/lib/supabase/server";

export type ActivityAction =
  | "share_view"
  | "image_view"
  | "image_download"
  | "image_favorite"
  | "image_unfavorite"
  | "gallery_download"
  | "share_created";

interface LogActivityParams {
  userId: string;
  action: ActivityAction;
  eventId?: string | null;
  shareId?: string | null;
  imageId?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}

/**
 * logActivity — Fire-and-forget activity logging.
 * Uses service client (bypasses RLS) so it works from both
 * authenticated and public routes. Never throws.
 */
export async function logActivity({
  userId,
  action,
  eventId,
  shareId,
  imageId,
  metadata = {} as Record<string, string | number | boolean | null>,
}: LogActivityParams): Promise<void> {
  try {
    const supabase = createServiceClient();
    await supabase.from("activity_log").insert({
      user_id: userId,
      action,
      event_id: eventId ?? null,
      share_id: shareId ?? null,
      image_id: imageId ?? null,
      metadata,
    });
  } catch {
    // Fire-and-forget: never let logging break the request
    console.warn("[analytics] Failed to log activity:", action);
  }
}
