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

// Paper ground, ink type: a photographer's logo is almost always dark on
// light, and the lead frames carry the color.
const INK = "#0C0A09";
const PAPER = "#FAFAF9";
const DIM = "#78716C";
const RULE = "#E7E5E4";

function headline(p: RecapPayload): string[] {
  const r = p.recap!;
  const median = formatSeconds(r.lastFrameToSend.medianSec);
  const who = r.guests > 0 ? `${formatCount(r.guests)} people photographed.` : `${formatCount(r.photos)} finished photos.`;
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
  try {
    return await renderCard(p, variant as Variant, size, fonts, wide);
  } catch (err) {
    // satori's own errors are the useful part; Next's HTML 500 page hides them.
    console.error("Recap card render failed:", err instanceof Error ? err.stack : err);
    return NextResponse.json({ error: "Card could not be rendered" }, { status: 500 });
  }
}

async function renderCard(
  p: RecapPayload,
  variant: Variant,
  size: { width: number; height: number },
  fonts: Awaited<ReturnType<typeof loadCardFonts>>,
  wide: boolean
) {
  const pad = Math.round(size.width * 0.055);
  const lines = headline(p);
  const rows = stats(p, wide ? 4 : 3);
  // Spread the picks across the pool so four faces are four different sessions.
  const want = 4;
  const step = Math.max(1, Math.floor(p.leads.length / want));
  const frames = Array.from({ length: want }, (_, i) => p.leads[i * step]).filter(Boolean);
  const headSize = wide ? 68 : 54;

  const image = new ImageResponse(
    (
      <div
        style={{
          width: size.width,
          height: size.height,
          display: "flex",
          background: PAPER,
          color: INK,
          fontFamily: "Inter, sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {wide ? (
          // Wide: a tilted 2×2 of lead frames bleeding off the right edge.
          <div
            style={{
              position: "absolute",
              top: -40,
              right: -30,
              width: 560,
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
                width={270}
                height={405}
                style={{
                  objectFit: "cover",
                  objectPosition: `${f.focalX ?? 50}% ${f.focalY ?? 35}%`,
                  borderRadius: 6,
                }}
              />
            ))}
          </div>
        ) : (
          // Square: a straight strip of four across the lower half.
          <div
            style={{
              position: "absolute",
              left: pad,
              right: pad,
              bottom: pad,
              display: "flex",
              gap: 14,
            }}
          >
            {frames.map((f) => (
              <img
                key={f.id}
                src={f.url}
                width={Math.floor((size.width - pad * 2 - 14 * 3) / 4)}
                height={Math.floor(((size.width - pad * 2 - 14 * 3) / 4) * 1.7)}
                style={{
                  objectFit: "cover",
                  objectPosition: `${f.focalX ?? 50}% ${f.focalY ?? 35}%`,
                  borderRadius: 6,
                }}
              />
            ))}
          </div>
        )}

        <div
          style={{
            position: "absolute",
            inset: 0,
            padding: pad,
            display: "flex",
            flexDirection: "column",
            gap: wide ? 36 : 28,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
              {p.photographer.logoUrl ? (
                <img src={p.photographer.logoUrl} width={wide ? 220 : 180} height={wide ? 56 : 46} style={{ objectFit: "contain", objectPosition: "left center" }} />
              ) : (
                <div style={{ fontSize: 26, fontWeight: 600 }}>{p.photographer.businessName ?? ""}</div>
              )}
              {p.clientLogoUrl ? (
                <>
                  <div style={{ color: DIM, fontSize: 22 }}>×</div>
                  <img src={p.clientLogoUrl} width={wide ? 220 : 180} height={wide ? 56 : 46} style={{ objectFit: "contain", objectPosition: "left center" }} />
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
              lineHeight: 1.06,
              letterSpacing: -1.5,
              maxWidth: wide ? "58%" : "100%",
            }}
          >
            {lines.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>

          <div style={{ display: "flex", gap: wide ? 56 : 44, paddingTop: 22, borderTop: `1px solid ${RULE}`, maxWidth: wide ? "58%" : "100%" }}>
            {rows.map((s, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: wide ? 38 : 32, fontWeight: 600, letterSpacing: -1 }}>{s.v}</div>
                <div style={{ fontSize: wide ? 17 : 16, color: DIM, marginTop: 6 }}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: fonts.length ? fonts : undefined,
    }
  );
  const png = await image.arrayBuffer();
  return new NextResponse(png, {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=300" },
  });
}
