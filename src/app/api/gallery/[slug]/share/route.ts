import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { createServiceClient } from "@/lib/supabase/server";
import { reportSystemError } from "@/lib/monitoring/report";
import { checkAuthRateLimit, clientIp } from "@/lib/security/rate-limit";
import { guestSharingEnabled } from "@/types/event-settings";
import type { SharingSettings } from "@/types/event-settings";
import { resolveShareImageScope } from "@/lib/gallery/share-scope";
import { logActivity } from "@/lib/analytics/log";

/**
 * POST /api/gallery/[slug]/share — a GUEST mints a link to a subset of the
 * gallery they're holding ("send Amanda just her 12 photos", 2026-08-28).
 *
 * Public and unauthenticated by design — the parent share slug is the
 * credential, exactly as it is for every other guest route. What keeps this
 * from being an open write surface:
 *
 *  - IDS ARE VALIDATED AGAINST THE PARENT'S SCOPE, server-side. A caller can
 *    only re-share what their own share already exposes — never reach wider.
 *  - THE PASSWORD GATE APPLIES. On a locked gallery the mint requires the
 *    same auth cookie the payload route requires: someone who never got past
 *    the gate cannot mint from behind it.
 *  - THE CHILD INHERITS EVERY GATE (password_hash, PIN columns, expiry,
 *    allow_download). Settled with Mason 2026-08-28: "always requires
 *    password/pin (if they are enabled)". A derived link is an ordinary share
 *    row, so the password/PIN write-through routes keep it in lockstep with
 *    rotations, and the DB trigger (migration 072) deactivates it with its
 *    parent. Note the bulk-only PIN still never prompts on a person link —
 *    `authorizeShareDownload` classes a curated subset as an INDIVIDUAL
 *    download, which is that gate working as designed (lesson 95).
 *  - DEDUPE MAKES RE-MINTS FREE: the same id set against the same root
 *    returns the existing link instead of a new row.
 *  - RATE-LIMITED per IP, and children per root are hard-capped.
 *
 * Depth is capped at one: minting from a derived share records the ROOT
 * parent, so lineage never chains and the cascade never recurses.
 */

/** A person's stack is dozens of frames; hundreds is a scraper's shape. */
const MAX_SHARE_IMAGES = 500;
/** Abuse backstop — no legitimate gallery spawns this many guest links. */
const MAX_CHILDREN_PER_ROOT = 200;
/** PostgREST `.in()` rides the query string — page it (lesson: URL length). */
const IN_PAGE = 200;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const supabase = createServiceClient();

    const allowed = await checkAuthRateLimit(
      supabase,
      "guest-share",
      slug,
      clientIp(request)
    );
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many links created — try again in a few minutes" },
        { status: 429 }
      );
    }

    const body = (await request.json().catch(() => null)) as {
      imageIds?: unknown;
    } | null;
    const imageIds = Array.isArray(body?.imageIds)
      ? [...new Set(body.imageIds.filter((v): v is string => typeof v === "string"))]
      : [];
    if (imageIds.length === 0 || imageIds.length > MAX_SHARE_IMAGES) {
      return NextResponse.json({ error: "imageIds is required" }, { status: 400 });
    }

    // ── the parent share, alive and unexpired ──
    const { data: parent } = await supabase
      .from("shares")
      .select("*")
      .eq("slug", slug)
      .eq("is_active", true)
      .single();
    if (!parent) {
      return NextResponse.json({ error: "Gallery not found" }, { status: 404 });
    }
    if (parent.expires_at && new Date(parent.expires_at) < new Date()) {
      return NextResponse.json({ error: "This gallery link has expired" }, { status: 410 });
    }

    // ── the photographer's switch — fails closed on an explicit opt-out ──
    const { data: event } = await supabase
      .from("events")
      .select("id, user_id, settings")
      .eq("id", parent.event_id)
      .single();
    if (!event) {
      return NextResponse.json({ error: "Gallery not found" }, { status: 404 });
    }
    const sharing = ((event.settings ?? {}) as { sharing?: Partial<SharingSettings> })
      .sharing;
    if (!guestSharingEnabled(sharing)) {
      return NextResponse.json({ error: "Sharing is not enabled here" }, { status: 403 });
    }

    // ── the password gate — minting from behind a lock requires having passed
    // it, same cookie contract as the payload route ──
    if (parent.password_hash) {
      const authCookie = request.cookies.get(`gallery_auth_${slug}`);
      if (!authCookie || authCookie.value !== parent.id) {
        return NextResponse.json({ error: "Password required" }, { status: 401 });
      }
    }

    // ── scope: the caller may only re-share what their share exposes ──
    const scope = resolveShareImageScope(parent);
    if (scope.kind === "none") {
      return NextResponse.json({ error: "Gallery not found" }, { status: 404 });
    }
    if (scope.kind === "images") {
      const allowedIds = new Set(scope.imageIds);
      if (imageIds.some((id) => !allowedIds.has(id))) {
        return NextResponse.json({ error: "Unknown image" }, { status: 400 });
      }
    } else {
      // Whole-event share: confirm every id really belongs to this event.
      const confirmed = new Set<string>();
      for (let i = 0; i < imageIds.length; i += IN_PAGE) {
        const page = imageIds.slice(i, i + IN_PAGE);
        const { data: rows, error } = await supabase
          .from("images")
          .select("id")
          .eq("event_id", parent.event_id)
          .in("id", page);
        if (error) throw error;
        for (const r of rows ?? []) confirmed.add(r.id);
      }
      if (imageIds.some((id) => !confirmed.has(id))) {
        return NextResponse.json({ error: "Unknown image" }, { status: 400 });
      }
    }

    // ── lineage collapses to the root, so depth never exceeds one ──
    const rootId: string = parent.parent_share_id ?? parent.id;

    // ── dedupe: the same set against the same root is the same link ──
    const wantedKey = [...imageIds].sort().join(",");
    const { data: siblings, error: sibErr } = await supabase
      .from("shares")
      .select("id, slug, image_ids, password_hash")
      .eq("parent_share_id", rootId)
      .eq("is_active", true)
      .order("id")
      .limit(MAX_CHILDREN_PER_ROOT);
    if (sibErr) throw sibErr;
    const existing = (siblings ?? []).find(
      (s) => ((s.image_ids ?? []) as string[]).slice().sort().join(",") === wantedKey
    );
    if (existing) {
      return NextResponse.json({
        share: shareResponse(existing.slug, !!existing.password_hash),
      });
    }
    if ((siblings ?? []).length >= MAX_CHILDREN_PER_ROOT) {
      return NextResponse.json(
        { error: "This gallery has too many shared links" },
        { status: 429 }
      );
    }

    // ── mint: an ordinary selection share that inherits every gate ──
    const { data: minted, error: mintErr } = await supabase
      .from("shares")
      .insert({
        event_id: parent.event_id,
        slug: nanoid(10),
        share_type: "selection",
        image_ids: imageIds,
        parent_share_id: rootId,
        password_hash: parent.password_hash,
        allow_download: parent.allow_download,
        allow_favorites: parent.allow_favorites,
        expires_at: parent.expires_at,
        download_pin: parent.download_pin,
        require_pin_bulk: parent.require_pin_bulk,
        require_pin_individual: parent.require_pin_individual,
        // Deliberately NOT the parent's custom_message — that greeting was
        // written for the parent audience, not for a person's subset.
        custom_message: null,
        is_active: true,
      })
      .select("id, slug, password_hash")
      .single();
    if (mintErr) throw mintErr;

    logActivity({
      userId: event.user_id,
      action: "share_created",
      eventId: event.id,
      shareId: minted.id,
      metadata: { via: "guest", parentShareId: rootId, imageCount: imageIds.length },
    });

    return NextResponse.json(
      { share: shareResponse(minted.slug, !!minted.password_hash) },
      { status: 201 }
    );
  } catch (error) {
    await reportSystemError("api.gallery.share.POST", error, {
      slug: (await params).slug,
    });
    return NextResponse.json({ error: "Failed to create link" }, { status: 500 });
  }
}

/**
 * What the guest dialog gets. `passwordProtected` says only that the DOOR
 * exists — the dialog tells the sharer their recipient will need the gallery
 * password. The VALUE never appears in any guest-facing response (Mason,
 * 2026-08-28: the owner may have shared the link while withholding the PIN).
 */
function shareResponse(slug: string, passwordProtected: boolean) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.pixeltrunk.com";
  return { url: `${appUrl}/gallery/${slug}`, passwordProtected };
}
