import { NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceClient } from "@/lib/supabase/server";
import { log } from "@/lib/log";

/**
 * Whether `email` is in the comma-separated ADMIN_EMAILS env list.
 * Mirrors the gate in /api/admin/batch-thumbnails.
 */
function isAdminEmail(email: string | undefined): boolean {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return false;
  return list.includes(email.toLowerCase());
}

const STUCK_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * GET /api/admin/health
 *
 * Internal ops endpoint. Surfaces signals that previously required
 * SSHing into the DB:
 *   - Images stuck in `processing` for more than 10 minutes
 *   - Images currently in `failed` state (with most recent last_error)
 *   - A small recent-failure feed
 *
 * Restricted to ADMIN_EMAILS. Returns 403 to everyone else so the route
 * exists without leaking ops detail to regular users.
 */
export async function GET() {
  try {
    const ssr = await createServerSupabaseClient();
    const {
      data: { user },
    } = await ssr.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isAdminEmail(user.email)) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const supabase = createServiceClient();
    const stuckCutoff = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString();

    const [stuckRes, failedRes, recentRes, totalRes] = await Promise.all([
      supabase
        .from("images")
        .select("id", { count: "exact", head: true })
        .eq("processing_status", "processing")
        .lt("updated_at", stuckCutoff),

      supabase
        .from("images")
        .select("id", { count: "exact", head: true })
        .eq("processing_status", "failed"),

      supabase
        .from("images")
        .select("id, event_id, original_filename, last_error, updated_at")
        .eq("processing_status", "failed")
        .order("updated_at", { ascending: false })
        .limit(10),

      supabase
        .from("images")
        .select("id", { count: "exact", head: true }),
    ]);

    return NextResponse.json({
      stuckProcessing: stuckRes.count ?? 0,
      stuckThresholdMinutes: STUCK_THRESHOLD_MS / 60_000,
      failed: failedRes.count ?? 0,
      totalImages: totalRes.count ?? 0,
      inngestConfigured: !!process.env.INNGEST_EVENT_KEY,
      modalConfigured: !!process.env.MODAL_API_URL,
      sentryConfigured: !!(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN),
      recentFailures: (recentRes.data ?? []).map((r) => ({
        id: r.id,
        eventId: r.event_id,
        filename: r.original_filename,
        lastError: r.last_error,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err) {
    log.error("admin/health", "request failed", { err });
    return NextResponse.json(
      { error: "Failed to load health" },
      { status: 500 }
    );
  }
}
