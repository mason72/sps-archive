/**
 * One way every Scout route turns a thrown error into a response: known
 * failures keep their status and message; anything else is a 500 that is
 * reported to `system_errors` first, so a failure is never only a log line.
 */
import { NextResponse } from "next/server";
import { reportSystemError } from "@/lib/monitoring/report";
import { PostcardFetchError } from "./fetch-image";
import { ScoutIntegrationError } from "./store";
import { scrubSignedUrls, scrubbedError } from "@/lib/net/scrub-urls";

export async function scoutErrorResponse(
  err: unknown,
  context: string,
  detail?: Record<string, unknown>
): Promise<NextResponse> {
  // Signed URLs in any message (ffmpeg, Modal, fetch) never reach
  // system_errors, the log or the response.
  if (err instanceof ScoutIntegrationError || err instanceof PostcardFetchError) {
    if (err.status >= 500) await reportSystemError(context, scrubbedError(err), detail);
    return NextResponse.json({ error: scrubSignedUrls(err.message) }, { status: err.status });
  }
  const safe = scrubbedError(err);
  await reportSystemError(context, safe, detail);
  console.error(`[${context}]`, safe);
  return NextResponse.json({ error: "Scout integration request failed." }, { status: 500 });
}
