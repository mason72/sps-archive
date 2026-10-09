import { ImageResponse } from "next/og";
import { NextRequest, NextResponse } from "next/server";
import { resolveRecap, type RecapPayload } from "@/lib/recap/payload";
import { formatCount, formatSeconds, recapOpenRate } from "@/lib/recap/normalize";
import { loadCardFonts } from "@/lib/recap/card-fonts";

export const runtime = "nodejs";

/**
 * GET /api/recap/[slug]/card/wide    → 1600×840 PNG (a slide, a LinkedIn post)
 * GET /api/recap/[slug]/card/square  → 1080×1080 PNG (Slack, Instagram)
 *
 * The paste-ready card: the recap's numbers, the photographer's logo, the
 * client's logo when they added one, and a few lead frames, as one image a
 * client drops into a deck or a channel. Rendered on demand by satori, so
 * there is no raster job and nothing stored; the share gate is the same as
 * the page's (locked shares answer 401, so a card URL cannot leak numbers
 * past a password).
 *
 * A still has no caveats on it. Every number here is a count SPS measured or
 * the archive holds today, and the headline is built from them, never typed.
 */

const SIZES = {
  wide: { width: 1600, height: 840 },
  square: { width: 1080, height: 1080 },
} as const;
type Variant = keyof typeof SIZES;

const INK = "#0C0A09";
const PAPER = "#FAFAF9";
const DIM = "rgba(250,250,249,0.72)";

function headline(p: RecapPayload): string[] {
  const r = p.recap!;
  const median = formatSeconds(r.lastFrameToSend.medianSec);
  const who = r.guestsCheckedIn > 0 ? `${formatCount(r.guestsCheckedIn)} people photographed.` : `${formatCount(r.photos)} finished photos.`;
  const how = median ? ["Finished photos in their inbox", `in ${median}.`] : ["Finished photos, delivered", "before they left."];
  return [who, ...how];
}

function stats(p: RecapPayload, max: number): { v: string; l: string }[] {
  const r = p.recap!;
  const out: { v: string; l: string }[] = [];
  if (r.photos > 0) out.push({ v: formatCount(r.photos), l: "finished photos" });
  const median = formatSeconds(r.lastFrameToSend.medianSec);
  if (median) out.push({ v: median, l: "last frame to inbox" });
  const open = recapOpenRate(r);
  if (open !== null) out.push({ v: `${open}%`, l: "opened their gallery" });
  if (r.hours.length) {
    const days = new Set(r.hours.map((h) => h.startsAt.slice(0, 10))).size;
    out.push({ v: String(days), l: days === 1 ? "day" : "days" });
  }
  return out.slice(0, max);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; variant: string }> }
) {
  const { slug, variant } = await params;
  if (!(variant in SIZES)) return NextResponse.json({ error: "Unknown card" }, { status: 404 });
  const size = SIZES[variant as Variant];

  const cookie = request.cookies.get(`gallery_auth_${slug}`)?.value;
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const resolved = await resolveRecap(slug, cookie, origin, 4);
  if (resolved.kind === "gone") return NextResponse.json({ error: "Not found" }, { status: resolved.status });
  if (resolved.kind === "locked") return NextResponse.json({ error: "Locked" }, { status: 401 });
  const p = resolved.payload;
  if (!p.recap) return NextResponse.json({ error: "No recap yet" }, { status: 404 });

  const fonts = await loadCardFonts();
  const wide = variant === "wide";
  const pad = Math.round(size.width * 0.055);
  const lines = headline(p);
  const rows = stats(p, wide ? 4 : 2);
  const frames = p.leads.slice(0, wide ? 4 : 2);
  const headSize = wide ? 84 : 64;

  return new ImageResponse(
    (
      <div
        style={{
          width: size.width,
          height: size.height,
          display: "flex",
          background: INK,
          color: PAPER,
          fontFamily: "Inter, sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Lead frames, tilted, bleeding off the edge */}
        <div
          style={{
            position: "absolute",
            right: wide ? -30 : -60,
            top: wide ? -40 : undefined,
            bottom: wide ? undefined : -80,
            width: wide ? 560 : 520,
            display: "flex",
            flexWrap: "wrap",
            gap: 18,
            transform: "rotate(6deg)",
          }}
        >
          {frames.map((f) => (
            <img
              key={f.id}
              src={f.url}
              width={wide ? 270 : 250}
              height={wide ? 405 : 375}
              style={{
                objectFit: "cover",
                objectPosition: `${f.focalX ?? 50}% ${f.focalY ?? 35}%`,
                borderRadius: 6,
              }}
            />
          ))}
        </div>

        <div
          style={{
            position: "absolute",
            inset: 0,
            padding: pad,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
              {p.photographer.logoUrl ? (
                <img src={p.photographer.logoUrl} height={wide ? 56 : 48} style={{ objectFit: "contain" }} />
              ) : (
                <div style={{ fontSize: 26, fontWeight: 600 }}>{p.photographer.businessName ?? ""}</div>
              )}
              {p.clientLogoUrl ? (
                <>
                  <div style={{ color: DIM, fontSize: 22 }}>×</div>
                  <img src={p.clientLogoUrl} height={wide ? 56 : 48} style={{ objectFit: "contain" }} />
                </>
              ) : null}
            </div>
            <div style={{ color: DIM, fontSize: wide ? 20 : 18, letterSpacing: 2, textTransform: "uppercase" }}>
              {p.eventName}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontFamily: "Playfair Display, serif",
              fontWeight: 700,
              fontSize: headSize,
              lineHeight: 1.04,
              letterSpacing: -2,
              maxWidth: wide ? "62%" : "100%",
            }}
          >
            {lines.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>

          <div style={{ display: "flex", gap: wide ? 64 : 48 }}>
            {rows.map((s, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: wide ? 40 : 36, fontWeight: 600, letterSpacing: -1 }}>{s.v}</div>
                <div style={{ fontSize: wide ? 18 : 17, color: DIM, marginTop: 6 }}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: fonts.length ? fonts : undefined,
      headers: { "Cache-Control": "private, max-age=300" },
    }
  );
}
