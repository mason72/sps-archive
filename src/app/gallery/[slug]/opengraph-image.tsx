import { ImageResponse } from "next/og";
import { createServiceClient } from "@/lib/supabase/server";
import { getPresignedDownloadUrl } from "@/lib/r2/client";
import { DEFAULT_BRANDING } from "@/types/user-profile";
import { DEFAULT_EVENT_SETTINGS } from "@/types/event-settings";

export const runtime = "nodejs";
export const alt = "Gallery Preview";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OGImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = createServiceClient();

  // 1. Resolve slug → share
  const { data: share } = await supabase
    .from("shares")
    .select("event_id, is_active")
    .eq("slug", slug)
    .eq("is_active", true)
    .single();

  if (!share) {
    return fallbackImage("Gallery");
  }

  // 2. Fetch event + settings
  const { data: event } = await supabase
    .from("events")
    .select("name, event_date, user_id, settings")
    .eq("id", share.event_id)
    .single();

  if (!event) {
    return fallbackImage("Gallery");
  }

  // 3. Fetch branding
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("business_name, logo_url, branding")
    .eq("user_id", event.user_id)
    .single();

  const businessName = profile?.business_name || null;
  const brandColors = (profile?.branding ?? {}) as Record<string, unknown>;
  const accentColor =
    (brandColors.accentColor as string) || DEFAULT_BRANDING.accentColor;

  // 4. Resolve cover image URL
  const eventSettings = (event.settings ?? {}) as Record<string, unknown>;
  const cover = (eventSettings.cover ?? DEFAULT_EVENT_SETTINGS.cover) as {
    layout: string;
    imageId?: string;
  };

  let coverImageUrl: string | null = null;
  if (cover.imageId) {
    const { data: coverImg } = await supabase
      .from("images")
      .select("r2_key")
      .eq("id", cover.imageId)
      .single();
    if (coverImg) {
      coverImageUrl = await getPresignedDownloadUrl(coverImg.r2_key, 600);
    }
  }

  // If no cover image set, use first image from event
  if (!coverImageUrl) {
    const { data: firstImg } = await supabase
      .from("images")
      .select("r2_key")
      .eq("event_id", share.event_id)
      .neq("processing_status", "error")
      .order("created_at", { ascending: true })
      .limit(1)
      .single();
    if (firstImg) {
      coverImageUrl = await getPresignedDownloadUrl(firstImg.r2_key, 600);
    }
  }

  // 5. Format date
  const dateStr = event.event_date
    ? new Date(event.event_date).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  // 6. Render OG image
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          backgroundColor: "#1C1917",
          fontFamily: "serif",
        }}
      >
        {/* Background cover image with dark overlay */}
        {coverImageUrl && (
          <img
            src={coverImageUrl}
            alt=""
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        )}

        {/* Dark gradient overlay */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            display: "flex",
            background: coverImageUrl
              ? "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 40%, rgba(0,0,0,0.2) 100%)"
              : "linear-gradient(135deg, #1C1917 0%, #292524 100%)",
          }}
        />

        {/* Content */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            display: "flex",
            flexDirection: "column",
            padding: "48px 56px",
            gap: "12px",
          }}
        >
          {/* Accent bar */}
          <div
            style={{
              width: "48px",
              height: "3px",
              backgroundColor: accentColor,
              marginBottom: "4px",
              display: "flex",
            }}
          />

          {/* Event name */}
          <div
            style={{
              fontSize: "48px",
              fontWeight: 700,
              color: "white",
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
              display: "flex",
            }}
          >
            {event.name}
          </div>

          {/* Date + photographer */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "16px",
              marginTop: "4px",
            }}
          >
            {dateStr && (
              <div
                style={{
                  fontSize: "18px",
                  color: "rgba(255,255,255,0.7)",
                  display: "flex",
                }}
              >
                {dateStr}
              </div>
            )}
            {dateStr && businessName && (
              <div
                style={{
                  fontSize: "18px",
                  color: "rgba(255,255,255,0.35)",
                  display: "flex",
                }}
              >
                ·
              </div>
            )}
            {businessName && (
              <div
                style={{
                  fontSize: "18px",
                  color: "rgba(255,255,255,0.7)",
                  fontStyle: "italic",
                  display: "flex",
                }}
              >
                {businessName}
              </div>
            )}
          </div>
        </div>

        {/* Pixeltrunk watermark — top right */}
        <div
          style={{
            position: "absolute",
            top: "24px",
            right: "32px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <div
            style={{
              fontSize: "13px",
              color: "rgba(255,255,255,0.4)",
              letterSpacing: "0.1em",
              textTransform: "uppercase" as const,
              display: "flex",
            }}
          >
            Pixeltrunk
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}

/** Minimal fallback when data is unavailable */
function fallbackImage(title: string) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #1C1917 0%, #292524 100%)",
          fontFamily: "serif",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "16px",
          }}
        >
          <div
            style={{
              fontSize: "42px",
              fontWeight: 700,
              color: "white",
              display: "flex",
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontSize: "14px",
              color: "rgba(255,255,255,0.4)",
              letterSpacing: "0.1em",
              textTransform: "uppercase" as const,
              display: "flex",
            }}
          >
            Pixeltrunk
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
