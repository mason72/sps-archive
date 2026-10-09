import { createServiceClient } from "@/lib/supabase/server";
import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";
import { DEFAULT_BRANDING } from "@/types/user-profile";
import { resolveShareImageScope, shareScopeIdFilter } from "@/lib/gallery/share-scope";
import { fetchMosaicPool, poolLeads } from "@/lib/cover/pool";
import { normalizeRecap } from "./normalize";
import type { SpsRecap } from "./types";

/**
 * Everything the recap page and the paste-ready cards show, resolved once for
 * a share slug. The slug IS the credential, as for the gallery: an inactive
 * or expired share resolves to nothing, and a password-protected share stays
 * locked until the same `gallery_auth_<slug>` cookie the gallery sets is
 * present. Owner views are not counted anywhere here; the recap page writes
 * nothing.
 *
 * Lead frames come through the share's scope and the same stack-deduped pool
 * the cover draws from, so a selection share never shows a frame outside its
 * picks, and a person with 14 frames appears once.
 */

export interface RecapLeadFrame {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  /** 0–100, where the subject is; null means center. */
  focalX: number | null;
  focalY: number | null;
}

export interface RecapBrand {
  businessName: string | null;
  logoUrl: string | null;
  website: string | null;
  accentColor: string;
}

export interface RecapPayload {
  slug: string;
  eventName: string;
  eventDate: string | null;
  /** The client's own logo, when they have added one; null shows the slot. */
  clientLogoUrl: string | null;
  clientName: string | null;
  photographer: RecapBrand;
  recap: SpsRecap | null;
  recapFetchedAt: string | null;
  archive: {
    /** Photos in this share's scope, as the archive holds them today. */
    photos: number;
    /** Of those, carrying the person's name (searchable by name). */
    named: number;
    sections: number;
    /** AI renders in scope. */
    aiRenders: number;
  };
  leads: RecapLeadFrame[];
  /**
   * AI renders (SPS makes them on the spot from the guest's own frame; the
   * archive marks them by `sps_source_image_id`), spread across the event so
   * eight tiles are eight different looks. Empty when the event had none.
   */
  aiLeads: RecapLeadFrame[];
  galleryUrl: string;
}

export type RecapResolution =
  | { kind: "ok"; payload: RecapPayload }
  | { kind: "locked"; eventName: string; customMessage: string | null; photographer: RecapBrand }
  | { kind: "gone"; status: 404 | 410 };

export const CLIENT_LOGO_KEY_PREFIX = "recap/";

export interface RecapSettings {
  clientLogoKey?: string;
  clientName?: string;
}

/** `events.settings.recap`, tolerated when absent or malformed. */
export function readRecapSettings(settings: unknown): RecapSettings {
  const s = ((settings ?? {}) as Record<string, unknown>).recap;
  if (!s || typeof s !== "object") return {};
  const r = s as Record<string, unknown>;
  return {
    clientLogoKey:
      typeof r.clientLogoKey === "string" && r.clientLogoKey.startsWith(CLIENT_LOGO_KEY_PREFIX)
        ? r.clientLogoKey
        : undefined,
    clientName: typeof r.clientName === "string" && r.clientName.trim() ? r.clientName.trim() : undefined,
  };
}

async function photographerBrand(userId: string | null): Promise<RecapBrand> {
  const supabase = createServiceClient();
  if (!userId) return { businessName: null, logoUrl: null, website: null, accentColor: DEFAULT_BRANDING.accentColor };
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("business_name, logo_url, website, branding")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile) return { businessName: null, logoUrl: null, website: null, accentColor: DEFAULT_BRANDING.accentColor };
  const b = (profile.branding ?? {}) as Record<string, unknown>;
  const logoUrl = profile.logo_url
    ? profile.logo_url.startsWith("branding/")
      ? await getPresignedDownloadUrl(profile.logo_url, 86400)
      : profile.logo_url
    : null;
  return {
    businessName: profile.business_name,
    logoUrl,
    website: profile.website,
    accentColor: (b.accentColor as string) || DEFAULT_BRANDING.accentColor,
  };
}

export async function resolveRecap(
  slug: string,
  authCookie: string | undefined,
  appOrigin: string,
  leadCount = 12
): Promise<RecapResolution> {
  const supabase = createServiceClient();

  const { data: share } = await supabase
    .from("shares")
    .select("id, event_id, expires_at, share_type, image_ids, section_id, password_hash, custom_message")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (!share) return { kind: "gone", status: 404 };
  if (share.expires_at && new Date(share.expires_at) < new Date()) return { kind: "gone", status: 410 };

  const scope = resolveShareImageScope(share);
  if (scope.kind === "none") return { kind: "gone", status: 404 };

  const { data: event } = await supabase
    .from("events")
    .select("id, name, event_date, user_id, settings, recap, recap_fetched_at")
    .eq("id", share.event_id)
    .maybeSingle();
  if (!event) return { kind: "gone", status: 404 };

  const photographer = await photographerBrand(event.user_id);

  if (share.password_hash && (!authCookie || authCookie !== share.id)) {
    return { kind: "locked", eventName: event.name, customMessage: share.custom_message, photographer };
  }

  const selected = shareScopeIdFilter(scope);
  const recapSettings = readRecapSettings(event.settings);
  const clientLogoUrl = recapSettings.clientLogoKey
    ? await getPresignedDownloadUrl(recapSettings.clientLogoKey, 86400)
    : null;

  // Archive facts, in scope. Two counts, one filter.
  let photosQuery = supabase
    .from("images")
    .select("id", { count: "exact", head: true })
    .eq("event_id", event.id)
    .eq("thumbnail_generated", true);
  let namedQuery = supabase
    .from("images")
    .select("id", { count: "exact", head: true })
    .eq("event_id", event.id)
    .eq("thumbnail_generated", true)
    .not("parsed_name", "is", null);
  if (selected) {
    const ids = [...selected];
    photosQuery = photosQuery.in("id", ids);
    namedQuery = namedQuery.in("id", ids);
  }
  const [{ count: photos }, { count: named }, { count: sections }] = await Promise.all([
    photosQuery,
    namedQuery,
    supabase.from("sections").select("id", { count: "exact", head: true }).eq("event_id", event.id),
  ]);

  // Lead frames: the share's own pool, stack-deduped, first N, presigned.
  const pool = await fetchMosaicPool(event.id, share.section_id ?? undefined);
  const inScope = selected ? pool.filter((t) => selected.has(t.id)) : pool;
  const leadRows = poolLeads(inScope).slice(0, leadCount);
  const leads: RecapLeadFrame[] = await Promise.all(
    leadRows.map(async (t) => ({
      id: t.id,
      url: await getPresignedDownloadUrl(getThumbnailKey(t.r2_key, "thumb-md"), 3600),
      width: t.width,
      height: t.height,
      focalX: t.focal_x,
      focalY: t.focal_y,
    }))
  );

  // AI renders, in scope, spread evenly so the strip shows eight different looks.
  let aiQuery = supabase
    .from("images")
    .select("id, r2_key, width, height, focal_x, focal_y")
    .eq("event_id", event.id)
    .eq("thumbnail_generated", true)
    .not("sps_source_image_id", "is", null)
    .neq("media_type", "video")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1000);
  if (selected) aiQuery = aiQuery.in("id", [...selected]);
  const { data: aiRows } = await aiQuery;
  const aiAll = aiRows ?? [];
  const aiWant = Math.min(8, aiAll.length);
  const aiStep = aiWant ? Math.max(1, Math.floor(aiAll.length / aiWant)) : 1;
  const aiPicked = Array.from({ length: aiWant }, (_, i) => aiAll[i * aiStep]).filter(Boolean);
  const aiLeads: RecapLeadFrame[] = await Promise.all(
    aiPicked.map(async (t) => ({
      id: t.id,
      url: await getPresignedDownloadUrl(getThumbnailKey(t.r2_key, "thumb-md"), 3600),
      width: t.width,
      height: t.height,
      focalX: t.focal_x,
      focalY: t.focal_y,
    }))
  );

  return {
    kind: "ok",
    payload: {
      slug,
      eventName: event.name,
      eventDate: event.event_date,
      clientLogoUrl,
      clientName: recapSettings.clientName ?? null,
      photographer,
      recap: normalizeRecap(event.recap),
      recapFetchedAt: event.recap_fetched_at,
      archive: { photos: photos ?? 0, named: named ?? 0, sections: sections ?? 0, aiRenders: aiAll.length },
      leads,
      aiLeads,
      galleryUrl: `${appOrigin.replace(/\/$/, "")}/gallery/${slug}`,
    },
  };
}
