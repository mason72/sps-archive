import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";
import { clientIp } from "@/lib/security/rate-limit";
import { getPresignedDownloadUrl } from "@/lib/r2/client";
import {
  authorizeShareDownload,
  selectDownloadImages,
  scopeFrom,
  SYNC_MAX_COUNT,
  SYNC_MAX_BYTES,
} from "@/lib/gallery/download-core";

/**
 * POST /api/gallery/[slug]/download/prepare
 *
 * Entry point for every bulk download. Decides how this download happens:
 *  - mode "direct": small enough to stream synchronously — the client
 *    navigates to /download with the same scope params.
 *  - mode "job": built in the background into R2 (big galleries OOM'd the
 *    streaming lambda); returns a jobId to poll via /download/status, or the
 *    finished URL immediately when a fresh identical build already exists
 *    (scope_key is a content hash of the exact image set).
 *
 * Body: { favorites?, section?, images?, name?, dt?, pin? } — the same scope
 * the download route takes, plus the PIN token when the share requires one.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const supabase = createServiceClient();

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // empty body = full-gallery scope
  }

  const scope = scopeFrom({
    favorites: body.favorites as string | boolean | undefined,
    section: body.section as string | undefined,
    images: body.images as string | string[] | undefined,
    name: body.name as string | undefined,
  });
  const auth = await authorizeShareDownload(supabase, slug, {
    cookieShareId: request.cookies.get(`gallery_auth_${slug}`)?.value ?? null,
    downloadToken: typeof body.dt === "string" ? body.dt : null,
    pin: typeof body.pin === "string" ? body.pin : null,
    ip: clientIp(request),
    scope,
  });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const { share } = auth;


  const selection = await selectDownloadImages(supabase, share, scope);
  if (!selection.ok) {
    return NextResponse.json(
      { error: selection.message },
      { status: selection.status }
    );
  }

  // Small download → stream it directly, no job machinery.
  if (
    selection.images.length <= SYNC_MAX_COUNT &&
    selection.totalBytes <= SYNC_MAX_BYTES
  ) {
    return NextResponse.json({
      mode: "direct",
      imageCount: selection.images.length,
      totalBytes: selection.totalBytes,
    });
  }

  // Reuse a fresh identical build (same exact image set) with ≥1h of life
  // left, or an in-flight build younger than 20 minutes.
  const { data: existing } = await supabase
    .from("zip_jobs")
    .select("*")
    .eq("share_id", share.id)
    .eq("scope_key", selection.scopeKey)
    .order("created_at", { ascending: false })
    .limit(5);

  const now = Date.now();
  for (const job of existing ?? []) {
    if (
      job.status === "ready" &&
      job.r2_key &&
      job.expires_at &&
      new Date(job.expires_at).getTime() > now + 3600 * 1000
    ) {
      const url = await getPresignedDownloadUrl(
        job.r2_key,
        3600,
        job.zip_filename
      );
      return NextResponse.json({
        mode: "job",
        jobId: job.id,
        status: "ready",
        url,
        imageCount: job.image_count,
        totalBytes: job.size_bytes,
      });
    }
    if (
      (job.status === "pending" || job.status === "building") &&
      now - new Date(job.created_at).getTime() < 20 * 60 * 1000
    ) {
      return NextResponse.json({
        mode: "job",
        jobId: job.id,
        status: job.status,
        imageCount: selection.images.length,
        totalBytes: selection.totalBytes,
      });
    }
  }

  const { data: job, error } = await supabase
    .from("zip_jobs")
    .insert({
      share_id: share.id,
      scope: JSON.parse(JSON.stringify(scope)),
      scope_key: selection.scopeKey,
      zip_filename: selection.zipFilename,
    })
    .select()
    .single();
  if (error || !job) {
    return NextResponse.json(
      { error: "Couldn't start the download build" },
      { status: 500 }
    );
  }

  try {
    await inngest.send({ name: "zip/requested", data: { jobId: job.id } });
  } catch (err) {
    // No dispatch → no build → don't leave the client polling a zombie row.
    await supabase
      .from("zip_jobs")
      .update({ status: "error", error: "dispatch failed" })
      .eq("id", job.id);
    console.error("zip/requested dispatch failed:", err);
    return NextResponse.json(
      { error: "Couldn't start the download build" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    mode: "job",
    jobId: job.id,
    status: "pending",
    imageCount: selection.images.length,
    totalBytes: selection.totalBytes,
  });
}
