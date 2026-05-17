import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { getUserSubscription, getPlanLimits } from "@/lib/stripe/subscription";
import { log } from "@/lib/log";

/**
 * GET /api/account/storage
 *
 * Returns the user's current storage footprint and plan ceiling. The
 * billing tab shows this as a progress bar so photographers know how
 * close they are to their cap — previously the only signal was an upload
 * failure once they ran out.
 */
export async function GET() {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    // Owner-scoped via RLS — fetch only this user's events.
    const { data: events } = await supabase
      .from("events")
      .select("id");
    const eventIds = (events ?? []).map((e) => e.id);

    let usedBytes = 0;
    if (eventIds.length > 0) {
      // Sum file_size across all images. For small/medium archives this
      // is fine; once images > ~100k we'd want a materialized view.
      // Page through to avoid the 1000-row default cap.
      const PAGE = 1000;
      let offset = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data } = await supabase
          .from("images")
          .select("file_size")
          .in("event_id", eventIds)
          .range(offset, offset + PAGE - 1);
        if (!data || data.length === 0) break;
        usedBytes += data.reduce((sum, row) => sum + (row.file_size ?? 0), 0);
        if (data.length < PAGE) break;
        offset += PAGE;
      }
    }

    const subscription = await getUserSubscription(user!.id);
    const plan = subscription?.plan ?? "free";
    const limits = getPlanLimits(plan);
    const planLimitBytes = Number.isFinite(limits.storageLimitGB)
      ? Math.round(limits.storageLimitGB * 1024 ** 3)
      : null;

    return NextResponse.json({
      plan,
      planName: limits.name,
      usedBytes,
      planLimitBytes,
      planLimitGB: Number.isFinite(limits.storageLimitGB)
        ? limits.storageLimitGB
        : null,
    });
  } catch (err) {
    log.error("account/storage", "request failed", { err });
    return NextResponse.json(
      { error: "Failed to load storage usage" },
      { status: 500 }
    );
  }
}
