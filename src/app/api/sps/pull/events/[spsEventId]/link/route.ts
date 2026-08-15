import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { readSpsEventId, spsEventLinkPatch } from "@/lib/sps-integration/event-link";
import type { Json } from "@/lib/supabase/database.types";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * Link an SPS event to an archive event that ALREADY exists — the "these were
 * uploaded manually" case.
 *
 * Mason, 2026-08-15: the KFL LA and NYC galleries were hand-uploaded to
 * Pixeltrunk before the pull lane existed, so the import list kept offering
 * their SPS twins as fresh imports. Linking records "this SPS event IS that
 * archive event": the row shows as in-the-archive, Event Intel's pickers can
 * resolve it, and nobody re-imports 355 photos that are already here.
 *
 * What it does NOT do: move a single byte. The archive's copies and SPS's
 * copies remain what they were (they are not byte-identical — see
 * `sps-not-a-repair-source` in memory), and a linked event has no pull job, so
 * "Review & import" would still create a duplicate — which is exactly why the
 * link demotes it.
 *
 *   POST   { eventId }  — link this SPS event to that archive event
 *   DELETE              — unlink (finds the linked event by SPS id)
 *
 * Not intel-gated: the import surface belongs to every account. Ownership is
 * the boundary, and it is checked on the archive event explicitly.
 */

type Params = { params: Promise<{ spsEventId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;
    const { spsEventId } = await params;

    const body = (await req.json().catch(() => null)) as {
      eventId?: string;
      spsEventName?: string;
    } | null;
    if (!body?.eventId) {
      return NextResponse.json({ error: "eventId is required" }, { status: 400 });
    }

    // The archive event must be the caller's own — the id arrives from a body
    // and getAuthUser hands back the service client.
    const { data: event, error: evErr } = await supabase
      .from("events")
      .select("id, name, settings")
      .eq("id", body.eventId)
      .eq("user_id", user!.id)
      .maybeSingle();
    if (evErr) throw evErr;
    if (!event) {
      return NextResponse.json({ error: "That event is not in your archive." }, { status: 404 });
    }

    // One event, one SPS twin. A different id already on the event means it is
    // claimed by another SPS event, and silently overwriting would detach that
    // link without anyone deciding to.
    const existing = readSpsEventId(event.settings as Record<string, unknown>);
    if (existing && existing !== spsEventId) {
      return NextResponse.json(
        { error: "That event is already linked to a different SPS event." },
        { status: 409 }
      );
    }

    // And one SPS event, one archive home — two rows claiming the same SPS id
    // would make the import list's "already imported" answer ambiguous.
    const { data: siblings, error: sibErr } = await supabase
      .from("events")
      .select("id, name, settings")
      .eq("user_id", user!.id)
      .neq("id", event.id);
    if (sibErr) throw sibErr;
    const claimed = (siblings ?? []).find(
      (e) => readSpsEventId(e.settings as Record<string, unknown>) === spsEventId
    );
    if (claimed) {
      return NextResponse.json(
        { error: `That SPS event is already linked to “${claimed.name}”.` },
        { status: 409 }
      );
    }

    const settings = {
      ...((event.settings as Record<string, unknown>) ?? {}),
      ...spsEventLinkPatch({
        eventId: spsEventId,
        eventName: body.spsEventName ?? null,
        linkedAt: new Date().toISOString(),
        source: "manual-link",
      }),
    };
    const { error: upErr } = await supabase
      .from("events")
      .update({ settings: settings as Json })
      .eq("id", event.id)
      .eq("user_id", user!.id);
    if (upErr) throw upErr;

    return NextResponse.json({ ok: true, eventId: event.id, eventName: event.name });
  } catch (err) {
    await reportSystemError("sps.link", err, {});
    return NextResponse.json({ error: "Could not link the event" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;
    const { spsEventId } = await params;

    const { data: events, error: evErr } = await supabase
      .from("events")
      .select("id, settings")
      .eq("user_id", user!.id);
    if (evErr) throw evErr;
    const linked = (events ?? []).find(
      (e) => readSpsEventId(e.settings as Record<string, unknown>) === spsEventId
    );
    if (!linked) return NextResponse.json({ ok: true });

    const settings = { ...((linked.settings as Record<string, unknown>) ?? {}) };
    delete settings.spsEventId;
    delete settings.spsEventName;
    delete settings.spsLinkedAt;
    delete settings.source;

    const { error: upErr } = await supabase
      .from("events")
      .update({ settings: settings as Json })
      .eq("id", linked.id)
      .eq("user_id", user!.id);
    if (upErr) throw upErr;
    return NextResponse.json({ ok: true });
  } catch (err) {
    await reportSystemError("sps.unlink", err, {});
    return NextResponse.json({ error: "Could not unlink the event" }, { status: 500 });
  }
}
