import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { clientIp } from "@/lib/security/rate-limit";
import { getPresignedDownloadUrl } from "@/lib/r2/client";
import {
  authorizeShareDownload,
  type DownloadScope,
} from "@/lib/gallery/download-core";

/**
 * GET /api/gallery/[slug]/download/status?job=<id>&dt=<token>
 *
 * Poll a background ZIP build. Runs the same download gates as the download
 * route itself (the ready response includes the presigned R2 URL — this IS
 * the download handoff). "expired" tells the client to re-prepare.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const supabase = createServiceClient();
  const sp = request.nextUrl.searchParams;

  const jobId = sp.get("job");
  if (!jobId) {
    return NextResponse.json({ error: "job is required" }, { status: 400 });
  }

  // The job is read BEFORE the gates because its stored scope decides which
  // PIN gate applies (a person's stack is not "the whole gallery"). Nothing
  // from the row leaves this function until share ownership is checked below.
  const { data: job } = await supabase
    .from("zip_jobs")
    .select("*")
    .eq("id", jobId)
    .single();
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const auth = await authorizeShareDownload(supabase, slug, {
    cookieShareId: request.cookies.get(`gallery_auth_${slug}`)?.value ?? null,
    downloadToken: sp.get("dt"),
    pin: sp.get("pin"),
    ip: clientIp(request),
    scope: (job.scope ?? {}) as DownloadScope,
  });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  if (job.share_id !== auth.share.id) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.status === "ready" && job.r2_key) {
    if (job.expires_at && new Date(job.expires_at) < new Date()) {
      return NextResponse.json({ status: "expired" });
    }
    const url = await getPresignedDownloadUrl(job.r2_key, 3600, job.zip_filename);
    return NextResponse.json({
      status: "ready",
      url,
      imageCount: job.image_count,
      totalBytes: job.size_bytes,
    });
  }

  if (job.status === "error") {
    return NextResponse.json({ status: "error" });
  }

  // pending/building — include build progress for the client's toast.
  return NextResponse.json({
    status: job.status,
    imagesDone: job.images_done ?? 0,
    imageTotal: job.image_count,
  });
}
