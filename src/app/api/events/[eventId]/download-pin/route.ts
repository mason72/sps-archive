import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";
import { DEFAULT_SHARING_SETTINGS, normalizeDownloadPins } from "@/types/event-settings";
import type { SharingSettings } from "@/types/event-settings";

/** Four digits, entered on a phone by a guest reading an email. */
const PIN_LENGTH = 4;

/**
 * PUT /api/events/[eventId]/download-pin
 *
 * The ONE home for download-PIN writes, and the exact shape
 * `PUT /api/events/[eventId]/gallery-password` already uses next door.
 *
 * A PIN is two inseparable facts, and writing one alone is how a gallery ends
 * up looking gated while the link already in a client's inbox stays open:
 *
 *   1. the settings on the EVENT (owner-scoped JSONB) — the photographer has to
 *      read it back to tell a client, and the email composer has to print it;
 *   2. `download_pin` / `require_pin_bulk` / `require_pin_individual` on every
 *      ACTIVE share — the only values any guest-facing code ever checks
 *      (`authorizeShareDownload`, the gallery payload, the email composer).
 *
 * Until this route existed the PIN only ever got half (1). It rode the generic
 * settings PATCH, which never touches `shares`, so both consumers read the
 * share row and silently saw "no PIN": the guest was never asked, and the PIN
 * was omitted from the email announcing the gallery. Two live galleries proved
 * each half independently — one where the PIN was switched on after the share
 * existed, one where a new share was minted while the event already had a PIN.
 *
 * Deliberately NOT folded into the events PATCH, for the same reason the
 * password isn't: the sidebar re-sends the whole settings blob on every
 * unrelated toggle, and a write across every share of an event has no business
 * running when someone flips "allow downloads".
 *
 * Body: { downloadPin?, requirePinBulk?, requirePinIndividual? } — each field
 * falls back to what the event already has, so a caller may send just the one
 * it is changing. Turning the bulk gate off clears the whole PIN posture.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { eventId } = await params;
    const body = (await request.json()) as {
      downloadPin?: unknown;
      requirePinBulk?: unknown;
      requirePinIndividual?: unknown;
    };

    if (body.downloadPin !== undefined && typeof body.downloadPin !== "string") {
      return NextResponse.json({ error: "downloadPin must be a string" }, { status: 400 });
    }
    for (const flag of ["requirePinBulk", "requirePinIndividual"] as const) {
      if (body[flag] !== undefined && typeof body[flag] !== "boolean") {
        return NextResponse.json({ error: `${flag} must be a boolean` }, { status: 400 });
      }
    }

    const pin = body.downloadPin === undefined ? undefined : body.downloadPin.trim();
    // A PIN that isn't four digits can't be typed into the guest's four-slot
    // input, so it would gate the gallery against everyone including its owner.
    if (pin !== undefined && pin !== "" && !new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)) {
      return NextResponse.json(
        { error: `PIN must be exactly ${PIN_LENGTH} digits` },
        { status: 400 }
      );
    }

    // Ownership gate — getAuthUser hands back the SERVICE client, which bypasses
    // RLS. The user_id filter IS the access control (lessons #2/#14).
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
    const current: SharingSettings = {
      ...DEFAULT_SHARING_SETTINGS,
      ...((settings.sharing ?? {}) as Partial<SharingSettings>),
    };

    // Normalize ONCE, then write the same resolved values to both places — the
    // event and its shares can never disagree about the flags, because neither
    // gets a chance to apply the rule for itself.
    const resolved = normalizeDownloadPins({
      downloadPin: pin ?? current.downloadPin,
      requirePinBulk: (body.requirePinBulk as boolean | undefined) ?? current.requirePinBulk,
      requirePinIndividual:
        (body.requirePinIndividual as boolean | undefined) ?? current.requirePinIndividual,
    });

    const sharing: SharingSettings = {
      ...current,
      downloadPin: resolved.downloadPin,
      requirePinBulk: resolved.requirePinBulk,
      requirePinIndividual: resolved.requirePinIndividual,
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

    // Write through to live links. Store the PIN as NULL rather than "" when
    // there is none: `authorizeShareDownload` fails closed on a gate with no
    // secret behind it, and null is the shape every existing row already uses.
    const { data: updated, error: shareError } = await supabase
      .from("shares")
      .update({
        download_pin: resolved.downloadPin || null,
        require_pin_bulk: resolved.requirePinBulk,
        require_pin_individual: resolved.requirePinIndividual,
      })
      .eq("event_id", eventId)
      .eq("is_active", true)
      .select("id");

    if (shareError) throw shareError;

    return NextResponse.json({
      downloadPin: resolved.downloadPin,
      requirePinBulk: resolved.requirePinBulk,
      requirePinIndividual: resolved.requirePinIndividual,
      sharesUpdated: updated?.length ?? 0,
    });
  } catch (error) {
    console.error("Download PIN error:", error);
    void reportSystemError("events.downloadPin", error);
    return NextResponse.json({ error: "Failed to save the download PIN" }, { status: 500 });
  }
}
