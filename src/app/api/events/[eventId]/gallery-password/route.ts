import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { hashPassword } from "@/lib/shares/hash";
import { reportSystemError } from "@/lib/monitoring/report";
import { DEFAULT_SHARING_SETTINGS } from "@/types/event-settings";
import type { SharingSettings } from "@/types/event-settings";

/**
 * A password nobody can type is a support ticket; one nobody can guess is the
 * point. Not exported — a route module may only export request handlers.
 */
const MAX_GALLERY_PASSWORD = 64;

/**
 * PUT /api/events/[eventId]/gallery-password
 *
 * The ONE home for gallery-password writes. Setting a password is two
 * inseparable facts, and splitting them is how a gallery ends up looking
 * protected while its already-emailed link stays wide open:
 *
 *   1. the plaintext on the event (owner-scoped JSONB) — the photographer has
 *      to be able to read it back to tell a client, and the email composer has
 *      to be able to print it;
 *   2. the PBKDF2 hash on every ACTIVE share of that event — the only thing
 *      /api/gallery/[slug]/verify ever compares against.
 *
 * Deliberately NOT folded into the events PATCH: the sidebar re-sends the whole
 * settings blob on every unrelated toggle, and 310k-iteration PBKDF2 per share
 * has no business running when someone flips "allow downloads".
 *
 * Body: { password: string }  — empty string clears protection everywhere.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { eventId } = await params;
    const body = (await request.json()) as { password?: unknown };

    if (typeof body.password !== "string") {
      return NextResponse.json(
        { error: "password must be a string" },
        { status: 400 }
      );
    }

    // Trim: a trailing space pasted from a doc becomes an unguessable password
    // the photographer swears they typed correctly.
    const password = body.password.trim();
    if (password.length > MAX_GALLERY_PASSWORD) {
      return NextResponse.json(
        { error: `Password must be ${MAX_GALLERY_PASSWORD} characters or fewer` },
        { status: 400 }
      );
    }

    // Ownership gate — getAuthUser hands back the SERVICE client, which
    // bypasses RLS. The user_id filter IS the access control (lessons #2/#14).
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id, settings")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .single();

    if (eventError || !event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const settings = (event.settings ?? {}) as Record<string, unknown>;
    const sharing: SharingSettings = {
      ...DEFAULT_SHARING_SETTINGS,
      ...((settings.sharing ?? {}) as Partial<SharingSettings>),
      password,
    };
    // The column is JSONB; SharingSettings is a plain record of primitives, so
    // the cast is the type system catching up, not a shape we're unsure of.
    const nextSettings = { ...settings, sharing } as Record<string, unknown>;

    const { error: writeError } = await supabase
      .from("events")
      .update({ settings: nextSettings as never })
      .eq("id", eventId)
      .eq("user_id", user!.id);

    if (writeError) throw writeError;

    // Write through to live links. Hash ONCE and reuse it: each share carrying
    // its own salt buys nothing here (it's one secret behind every link) and
    // costs 310k iterations per row.
    const passwordHash = password ? await hashPassword(password) : null;

    const { data: updated, error: shareError } = await supabase
      .from("shares")
      .update({ password_hash: passwordHash })
      .eq("event_id", eventId)
      .eq("is_active", true)
      .select("id");

    if (shareError) throw shareError;

    return NextResponse.json({
      isProtected: !!password,
      sharesUpdated: updated?.length ?? 0,
    });
  } catch (error) {
    console.error("Gallery password error:", error);
    void reportSystemError("events.galleryPassword", error);
    return NextResponse.json(
      { error: "Failed to save gallery password" },
      { status: 500 }
    );
  }
}
