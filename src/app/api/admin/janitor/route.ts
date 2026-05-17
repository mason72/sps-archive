import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceClient } from "@/lib/supabase/server";
import { deleteFromR2 } from "@/lib/r2/client";
import { log } from "@/lib/log";

/** Same admin gate as the other admin routes. */
function isAdminEmail(email: string | undefined): boolean {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return false;
  return list.includes(email.toLowerCase());
}

const DEFAULT_AGE_HOURS = 24;
const MAX_PER_RUN = 500;

/**
 * POST /api/admin/janitor
 *
 * Sweeps orphan images: rows stuck in `pending` status older than N hours
 * (default 24). Pre-Phase-1, /api/upload created a DB row before the
 * browser PUT to R2 — if the user closed the tab the row never advanced
 * past `pending` and silently grew the database.
 *
 * Phase 1 closed the loudest source of orphans by authenticating
 * /api/upload/complete and tightening the state machine, but the older
 * abandoned rows still exist. This route lets the operator clean them.
 *
 * Body (optional):
 *   ageHours: number   — only delete rows older than this (default 24)
 *   dryRun:   boolean  — return counts without deleting (default false)
 *
 * Restricted to ADMIN_EMAILS. Deletes from R2 too (best-effort; failures
 * are logged but don't block the DB delete).
 */
export async function POST(request: NextRequest) {
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

    const body = (await request.json().catch(() => ({}))) as {
      ageHours?: number;
      dryRun?: boolean;
    };
    const ageHours = Math.max(1, body.ageHours ?? DEFAULT_AGE_HOURS);
    const dryRun = !!body.dryRun;

    const cutoff = new Date(Date.now() - ageHours * 60 * 60 * 1000).toISOString();
    const supabase = createServiceClient();

    const { data: candidates, error: queryError } = await supabase
      .from("images")
      .select("id, r2_key, event_id, created_at")
      .eq("processing_status", "pending")
      .lt("created_at", cutoff)
      .limit(MAX_PER_RUN);

    if (queryError) throw queryError;
    const rows = candidates ?? [];

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        ageHours,
        candidateCount: rows.length,
        sample: rows.slice(0, 10).map((r) => ({
          id: r.id,
          eventId: r.event_id,
          createdAt: r.created_at,
        })),
      });
    }

    // Best-effort R2 cleanup. We continue the DB delete even if R2 fails,
    // since the DB row is the canonical source of truth — a leaked R2 byte
    // is worse than a stuck DB row but the alternative (leaving the row
    // and the byte) is also bad.
    let r2Deleted = 0;
    let r2Failed = 0;
    await Promise.all(
      rows.map(async (row) => {
        if (!row.r2_key) return;
        try {
          await deleteFromR2(row.r2_key);
          r2Deleted++;
        } catch (err) {
          r2Failed++;
          log.warn("janitor", "R2 delete failed", {
            imageId: row.id,
            r2Key: row.r2_key,
            err,
          });
        }
      })
    );

    if (rows.length > 0) {
      const { error: deleteError } = await supabase
        .from("images")
        .delete()
        .in(
          "id",
          rows.map((r) => r.id)
        );
      if (deleteError) throw deleteError;
    }

    return NextResponse.json({
      deleted: rows.length,
      r2Deleted,
      r2Failed,
      ageHours,
      hadMore: rows.length === MAX_PER_RUN,
    });
  } catch (err) {
    log.error("admin/janitor", "request failed", { err });
    return NextResponse.json(
      { error: "Janitor sweep failed" },
      { status: 500 }
    );
  }
}
