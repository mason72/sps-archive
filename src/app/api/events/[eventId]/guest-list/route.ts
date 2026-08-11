import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";
import { uploadToR2 } from "@/lib/r2/client";
import {
  guestListKey,
  hashToken,
  mintToken,
  readGuestList,
} from "@/lib/guest-list/store";

export const runtime = "nodejs";

/** A guest list is a CSV of names; anything this large is not one. */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * POST /api/events/[eventId]/guest-list   (multipart: file)
 *   Attach the SPS analytics spreadsheet to this event and mint the download
 *   token that the publish email will carry. Returns the token ONCE — only its
 *   hash is stored, so it cannot be read back afterwards. Re-uploading mints a
 *   fresh token and instantly invalidates the old link.
 *
 * DELETE — revoke: drops the metadata, so every link already sent stops
 *   working. The R2 object is left (cheap, and re-attaching is common).
 *
 * Owner-only. The DOWNLOAD side is deliberately elsewhere and token-based:
 * see /api/guest-list/[token].
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { data: event } = await supabase
      .from("events")
      .select("id, settings")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .maybeSingle();
    if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file" }, { status: 400 });
    }
    if (file.size === 0 || file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File must be 1 byte–5MB" }, { status: 400 });
    }
    const name = file.name.toLowerCase();
    if (!name.endsWith(".csv") && !name.endsWith(".tsv")) {
      return NextResponse.json(
        { error: "Upload the CSV that SPS exports" },
        { status: 400 }
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const key = guestListKey(eventId);
    await uploadToR2(key, bytes, "text/csv");

    const token = mintToken();
    const settings = ((event as { settings: Record<string, unknown> | null }).settings ??
      {}) as Record<string, unknown>;
    const { error: updateErr } = await supabase
      .from("events")
      .update({
        settings: {
          ...settings,
          guestList: {
            key,
            filename: file.name,
            uploadedAt: new Date().toISOString(),
            tokenHash: hashToken(token),
            source: "manual-upload",
            sizeBytes: bytes.length,
          },
        } as never,
      })
      .eq("id", eventId)
      .eq("user_id", user!.id);
    if (updateErr) throw updateErr;

    return NextResponse.json({
      // Shown once and embedded in the email. We store only the hash.
      token,
      filename: file.name,
      sizeBytes: bytes.length,
    });
  } catch (error) {
    await reportSystemError("guest-list.upload", error, { eventId });
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { data: event } = await supabase
      .from("events")
      .select("id, settings")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .maybeSingle();
    if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const settings = ((event as { settings: Record<string, unknown> | null }).settings ??
      {}) as Record<string, unknown>;
    delete settings.guestList;
    const { error: updateErr } = await supabase
      .from("events")
      .update({ settings: settings as never })
      .eq("id", eventId)
      .eq("user_id", user!.id);
    if (updateErr) throw updateErr;

    return NextResponse.json({ revoked: true });
  } catch (error) {
    await reportSystemError("guest-list.revoke", error, { eventId });
    return NextResponse.json({ error: "Revoke failed" }, { status: 500 });
  }
}

/** GET — has this event got a sheet? Owner-only, and never returns the token. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  const { user, supabase, error: authError } = await getAuthUser();
  if (authError) return authError;

  const { data: event } = await supabase
    .from("events")
    .select("settings")
    .eq("id", eventId)
    .eq("user_id", user!.id)
    .maybeSingle();
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const meta = readGuestList((event as { settings: unknown }).settings);
  return NextResponse.json({
    attached: !!meta,
    filename: meta?.filename ?? null,
    uploadedAt: meta?.uploadedAt ?? null,
    sizeBytes: meta?.sizeBytes ?? null,
  });
}
