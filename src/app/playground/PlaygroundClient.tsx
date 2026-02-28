"use client";

import { useState } from "react";
import Image from "next/image";
import { Download, Heart } from "lucide-react";

/* ─────────────────────────────────────────────
 * Types
 * ───────────────────────────────────────────── */
interface ImageData {
  id: string;
  url: string;
  width: number;
  height: number;
}

interface Variation {
  id: string;
  name: string;
  category: string;
  description: string;
  brandFont: string;
  headlineFont: string;
  bodyFont: string;
  bg: string;
  cardBg: string;
  text: string;
  muted: string;
  accent: string;
  border: string;
  brandWeight: number;
  headlineWeight: number;
  headlineItalic?: boolean;
  brandLetterSpacing?: string;
  headlineLetterSpacing?: string;
  brandLowercase?: boolean;
  darkMode?: boolean;
}

/* ─────────────────────────────────────────────
 * Google Fonts URL (all needed families)
 * ───────────────────────────────────────────── */
const GOOGLE_FONTS = [
  "Playfair+Display:ital,wght@0,400;0,700;1,400;1,700",
  "DM+Serif+Display:ital@0;1",
  "Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;0,9..144,700;1,9..144,400;1,9..144,700",
  "Space+Grotesk:wght@400;500;600;700",
  "Instrument+Serif:ital@0;1",
  "Syne:wght@400;500;600;700;800",
  "Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,700",
  "Space+Mono:wght@400;700",
  "Anybody:wght@400;500;600;700;800;900",
].join("&family=");

const FONTS_URL = `https://fonts.googleapis.com/css2?family=${GOOGLE_FONTS}&display=swap`;

/* ─────────────────────────────────────────────
 * 9 Variations
 * ───────────────────────────────────────────── */
const variations: Variation[] = [
  // ── Option A: Inter brand + Playfair content ──
  {
    id: "a1",
    category: "A",
    name: "Editorial Blend",
    description:
      "Inter for the brand wordmark, Playfair Display for gallery titles. Stone palette with emerald accent. Closest to current design.",
    brandFont: "'Inter', sans-serif",
    headlineFont: "'Playfair Display', serif",
    bodyFont: "'Inter', sans-serif",
    bg: "#FAFAF9",
    cardBg: "#FFFFFF",
    text: "#1C1917",
    muted: "#A8A29E",
    accent: "#10B981",
    border: "#E7E5E4",
    brandWeight: 600,
    headlineWeight: 700,
    brandLetterSpacing: "-0.02em",
    headlineLetterSpacing: "-0.03em",
    brandLowercase: true,
  },
  {
    id: "a2",
    category: "A",
    name: "Warm Editorial",
    description:
      "Inter brand + Playfair Display italic headlines. Warm cream tones with amber accent. Luxurious warmth.",
    brandFont: "'Inter', sans-serif",
    headlineFont: "'Playfair Display', serif",
    bodyFont: "'Inter', sans-serif",
    bg: "#FFFBF5",
    cardBg: "#FFFFFF",
    text: "#292524",
    muted: "#A8A29E",
    accent: "#D97706",
    border: "#E7E5E4",
    brandWeight: 600,
    headlineWeight: 400,
    headlineItalic: true,
    brandLetterSpacing: "-0.02em",
    headlineLetterSpacing: "-0.02em",
    brandLowercase: true,
  },

  // ── Option B: Modern serif replacements ──
  {
    id: "b1",
    category: "B",
    name: "Modern Heritage",
    description:
      "DM Serif Display headlines — bolder, more contemporary serif. Cool slate palette, indigo accent.",
    brandFont: "'Inter', sans-serif",
    headlineFont: "'DM Serif Display', serif",
    bodyFont: "'Inter', sans-serif",
    bg: "#F8FAFC",
    cardBg: "#FFFFFF",
    text: "#0F172A",
    muted: "#94A3B8",
    accent: "#6366F1",
    border: "#E2E8F0",
    brandWeight: 600,
    headlineWeight: 400,
    brandLetterSpacing: "-0.02em",
    headlineLetterSpacing: "-0.01em",
    brandLowercase: true,
  },
  {
    id: "b2",
    category: "B",
    name: "Playful Premium",
    description:
      "Fraunces headlines — optical-size variable serif with personality. Zinc palette, rose accent.",
    brandFont: "'Inter', sans-serif",
    headlineFont: "'Fraunces', serif",
    bodyFont: "'Inter', sans-serif",
    bg: "#FAFAFA",
    cardBg: "#FFFFFF",
    text: "#18181B",
    muted: "#A1A1AA",
    accent: "#E11D48",
    border: "#E4E4E7",
    brandWeight: 500,
    headlineWeight: 600,
    brandLetterSpacing: "-0.01em",
    headlineLetterSpacing: "-0.02em",
    brandLowercase: true,
  },

  // ── Option C: Full geometric ──
  {
    id: "c1",
    category: "C",
    name: "Pure Minimal",
    description:
      "Inter throughout — ultra-clean, no serif at all. Neutral grays, subtle teal accent. Modern SaaS feel.",
    brandFont: "'Inter', sans-serif",
    headlineFont: "'Inter', sans-serif",
    bodyFont: "'Inter', sans-serif",
    bg: "#FAFAFA",
    cardBg: "#FFFFFF",
    text: "#171717",
    muted: "#A3A3A3",
    accent: "#0D9488",
    border: "#E5E5E5",
    brandWeight: 700,
    headlineWeight: 600,
    brandLetterSpacing: "-0.03em",
    headlineLetterSpacing: "-0.02em",
    brandLowercase: true,
  },
  {
    id: "c2",
    category: "C",
    name: "Space Age",
    description:
      "Space Grotesk everywhere — geometric with a techy edge. Strong uppercase brand, cool vibes.",
    brandFont: "'Space Grotesk', sans-serif",
    headlineFont: "'Space Grotesk', sans-serif",
    bodyFont: "'Space Grotesk', sans-serif",
    bg: "#F9FAFB",
    cardBg: "#FFFFFF",
    text: "#111827",
    muted: "#9CA3AF",
    accent: "#0891B2",
    border: "#E5E7EB",
    brandWeight: 700,
    headlineWeight: 700,
    brandLetterSpacing: "-0.04em",
    headlineLetterSpacing: "-0.03em",
    brandLowercase: true,
  },

  // ── Wild Cards ──
  {
    id: "w1",
    category: "W",
    name: "Darkroom",
    description:
      "Instrument Serif + Space Mono. Dark interface like a photographer's darkroom. Amber/gold highlights on black.",
    brandFont: "'Space Mono', monospace",
    headlineFont: "'Instrument Serif', serif",
    bodyFont: "'Space Mono', monospace",
    bg: "#0C0A09",
    cardBg: "#1C1917",
    text: "#FAFAF9",
    muted: "#78716C",
    accent: "#F59E0B",
    border: "#292524",
    brandWeight: 400,
    headlineWeight: 400,
    headlineItalic: true,
    brandLetterSpacing: "0.05em",
    headlineLetterSpacing: "-0.01em",
    brandLowercase: true,
    darkMode: true,
  },
  {
    id: "w2",
    category: "W",
    name: "Brutalist",
    description:
      "Syne — geometric brutalism with oversized type. High contrast black/white with a slash of red. Raw, confident, bold.",
    brandFont: "'Syne', sans-serif",
    headlineFont: "'Syne', sans-serif",
    bodyFont: "'Inter', sans-serif",
    bg: "#FFFFFF",
    cardBg: "#FFFFFF",
    text: "#000000",
    muted: "#737373",
    accent: "#DC2626",
    border: "#000000",
    brandWeight: 800,
    headlineWeight: 800,
    brandLetterSpacing: "-0.05em",
    headlineLetterSpacing: "-0.04em",
    brandLowercase: true,
  },
  {
    id: "w3",
    category: "W",
    name: "Old Money",
    description:
      "Cormorant Garamond — ultra-refined thin serifs. Muted sage/olive palette. Whisper-quiet luxury, like old European galleries.",
    brandFont: "'Cormorant Garamond', serif",
    headlineFont: "'Cormorant Garamond', serif",
    bodyFont: "'Inter', sans-serif",
    bg: "#F7F7F2",
    cardBg: "#FBFBF8",
    text: "#3F3F3B",
    muted: "#9A9A8F",
    accent: "#6B7F5E",
    border: "#E5E5DA",
    brandWeight: 600,
    headlineWeight: 300,
    headlineItalic: true,
    brandLetterSpacing: "0.08em",
    headlineLetterSpacing: "0.01em",
    brandLowercase: false,
  },
];

/* ─────────────────────────────────────────────
 * Category labels
 * ───────────────────────────────────────────── */
const CATEGORY_INFO: Record<string, { label: string; description: string }> = {
  A: {
    label: "Option A — Dual Voice",
    description: "Inter for brand, Playfair Display for content headlines",
  },
  B: {
    label: "Option B — Modern Serif",
    description: "Replace Playfair with a more contemporary serif",
  },
  C: {
    label: "Option C — Full Geometric",
    description: "All sans-serif, lean into the logo's geometric DNA",
  },
  W: {
    label: "Wild Cards",
    description: "Weird, surprising, or esoteric choices",
  },
};

/* ─────────────────────────────────────────────
 * Mini Gallery Card
 * ───────────────────────────────────────────── */
function GalleryCard({
  v,
  images,
  expanded,
  onToggle,
}: {
  v: Variation;
  images: ImageData[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const displayImages = expanded ? images : images.slice(0, 6);
  const logoFilter = v.darkMode ? "brightness(10)" : "none";

  return (
    <div
      className="rounded-2xl overflow-hidden transition-all duration-300"
      style={{
        backgroundColor: v.cardBg,
        border: `1px solid ${v.border}`,
        boxShadow: expanded
          ? "0 25px 50px -12px rgba(0,0,0,0.15)"
          : "0 4px 6px -1px rgba(0,0,0,0.05)",
      }}
    >
      {/* ── Simulated Gallery Page ── */}
      <div
        style={{ backgroundColor: v.bg }}
        className="overflow-hidden"
      >
        {/* Nav */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: `1px solid ${v.border}` }}
        >
          <div className="flex items-center gap-2.5">
            <Image
              src="/logo.png"
              alt="pixeltrunk"
              width={28}
              height={28}
              className="rounded-md"
              style={{ filter: logoFilter }}
            />
            <span
              style={{
                fontFamily: v.brandFont,
                fontWeight: v.brandWeight,
                letterSpacing: v.brandLetterSpacing || "0",
                color: v.text,
                fontSize: "18px",
                textTransform: v.brandLowercase ? "lowercase" : "none",
              }}
            >
              {v.brandLowercase === false ? "Pixeltrunk" : "pixeltrunk"}
            </span>
          </div>
          <div className="flex items-center gap-4">
            {["Upload", "Share", "Settings"].map((item) => (
              <span
                key={item}
                style={{
                  fontFamily: v.bodyFont,
                  color: v.muted,
                  fontSize: "13px",
                  fontWeight: 500,
                }}
              >
                {item}
              </span>
            ))}
          </div>
        </div>

        {/* Header */}
        <div className="px-6 pt-8 pb-5">
          <p
            style={{
              fontFamily: v.bodyFont,
              color: v.muted,
              fontSize: "11px",
              fontWeight: 500,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            TWO DUDES PHOTO
          </p>
          <h2
            className="mt-2"
            style={{
              fontFamily: v.headlineFont,
              fontWeight: v.headlineWeight,
              fontStyle: v.headlineItalic ? "italic" : "normal",
              letterSpacing: v.headlineLetterSpacing || "0",
              color: v.text,
              fontSize: expanded ? "36px" : "28px",
              lineHeight: 1.15,
            }}
          >
            Corporate Headshots
          </h2>
          <p
            className="mt-1.5"
            style={{
              fontFamily: v.bodyFont,
              color: v.muted,
              fontSize: "13px",
              fontStyle: "italic",
            }}
          >
            February 22, 2026
          </p>

          {/* Download All button */}
          <div className="flex justify-end mt-4">
            <span
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px]"
              style={{
                fontFamily: v.bodyFont,
                border: `1px solid ${v.border}`,
                color: v.text,
              }}
            >
              <Download size={14} />
              Download All
            </span>
          </div>
        </div>

        {/* Divider */}
        <div className="mx-6" style={{ borderTop: `1px solid ${v.border}` }} />

        {/* Image Grid */}
        <div className="px-6 py-5">
          <div
            className={`grid gap-2 ${
              expanded ? "grid-cols-4" : "grid-cols-3"
            }`}
          >
            {displayImages.map((img, i) => (
              <div
                key={img.id}
                className="relative group overflow-hidden rounded-lg"
                style={{
                  aspectRatio: "3 / 4",
                  backgroundColor: v.darkMode ? "#292524" : "#F5F5F4",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={`Photo ${i + 1}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                {/* Hover overlay */}
                <div
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-end justify-end gap-1.5 p-2"
                  style={{
                    background: v.darkMode
                      ? "linear-gradient(to top, rgba(0,0,0,0.6), transparent)"
                      : "linear-gradient(to top, rgba(0,0,0,0.3), transparent)",
                  }}
                >
                  <Heart
                    size={16}
                    className="drop-shadow-sm"
                    style={{ color: "#fff" }}
                  />
                  <Download
                    size={16}
                    className="drop-shadow-sm"
                    style={{ color: "#fff" }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Gallery footer */}
        <div
          className="px-6 py-3 flex items-center justify-center gap-2"
          style={{
            borderTop: `1px solid ${v.border}`,
            backgroundColor: v.darkMode ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.02)",
          }}
        >
          <Image
            src="/logo.png"
            alt=""
            width={16}
            height={16}
            className="rounded-sm opacity-40"
            style={{ filter: logoFilter }}
          />
          <span
            style={{
              fontFamily: v.bodyFont,
              color: v.muted,
              fontSize: "11px",
            }}
          >
            Powered by{" "}
            <span style={{ fontFamily: v.brandFont, fontWeight: v.brandWeight }}>
              pixeltrunk
            </span>
          </span>
        </div>
      </div>

      {/* ── Variation Info ── */}
      <div
        className="px-6 py-4 flex items-start justify-between gap-4"
        style={{ borderTop: `1px solid ${v.border}` }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span
              className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
              style={{
                backgroundColor:
                  v.category === "A"
                    ? "#10B981"
                    : v.category === "B"
                    ? "#6366F1"
                    : v.category === "C"
                    ? "#0891B2"
                    : "#F59E0B",
              }}
            >
              {v.id.toUpperCase()}
            </span>
            <h3 className="font-semibold text-[15px] text-stone-900 truncate">
              {v.name}
            </h3>
          </div>
          <p className="mt-1.5 text-[12px] text-stone-500 leading-relaxed">
            {v.description}
          </p>
          {/* Font stack */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Array.from(
              new Set([v.brandFont, v.headlineFont, v.bodyFont])
            ).map((f) => (
              <span
                key={f}
                className="inline-block px-2 py-0.5 text-[10px] font-medium rounded-full bg-stone-100 text-stone-500"
              >
                {f.replace(/'/g, "").split(",")[0]}
              </span>
            ))}
          </div>
          {/* Color swatches */}
          <div className="mt-2 flex items-center gap-1.5">
            {[v.bg, v.text, v.muted, v.accent, v.border].map((color, i) => (
              <div
                key={i}
                className="w-4 h-4 rounded-full border border-stone-200"
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}
          </div>
        </div>
        <button
          onClick={onToggle}
          className="shrink-0 mt-1 px-3 py-1.5 text-[11px] font-medium rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors"
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
 * Main Playground Component
 * ───────────────────────────────────────────── */
export function PlaygroundClient({ images }: { images: ImageData[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Group variations by category
  const categories = ["A", "B", "C", "W"];

  return (
    <>
      {/* Load Google Fonts */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        rel="preconnect"
        href="https://fonts.gstatic.com"
        crossOrigin="anonymous"
      />
      <link rel="stylesheet" href={FONTS_URL} />

      <div className="min-h-screen bg-stone-50">
        {/* Page Header */}
        <div className="max-w-7xl mx-auto px-6 pt-12 pb-8">
          <div className="flex items-center gap-4 mb-2">
            <Image
              src="/logo.png"
              alt="pixeltrunk"
              width={48}
              height={48}
              className="rounded-xl shadow-md"
            />
            <div>
              <h1 className="font-editorial text-[32px] text-stone-900 leading-none">
                Style Playground
              </h1>
              <p className="text-[14px] text-stone-400 mt-1">
                9 visual directions for the{" "}
                <span className="font-semibold text-stone-600">pixeltrunk</span>{" "}
                rebrand
              </p>
            </div>
          </div>
          <p className="mt-4 text-[13px] text-stone-400 max-w-2xl leading-relaxed">
            Each card simulates a full gallery page with different typography,
            color palettes, and design personalities. Click &quot;Expand&quot; to
            see the full 4-column grid. All previews use real images from your
            Tester event.
          </p>
        </div>

        {/* Variations by category */}
        <div className="max-w-7xl mx-auto px-6 pb-20">
          {categories.map((cat) => {
            const catVariations = variations.filter((v) => v.category === cat);
            const info = CATEGORY_INFO[cat];
            return (
              <div key={cat} className="mb-14">
                {/* Category Header */}
                <div className="mb-5">
                  <h2 className="text-[13px] font-semibold tracking-widest uppercase text-stone-400">
                    {info.label}
                  </h2>
                  <p className="text-[12px] text-stone-300 mt-0.5">
                    {info.description}
                  </p>
                </div>

                {/* Cards grid */}
                <div
                  className={`grid gap-6 ${
                    catVariations.some((v) => v.id === expandedId)
                      ? "grid-cols-1"
                      : cat === "W"
                      ? "grid-cols-1 lg:grid-cols-3"
                      : "grid-cols-1 lg:grid-cols-2"
                  }`}
                >
                  {catVariations.map((v) => (
                    <GalleryCard
                      key={v.id}
                      v={v}
                      images={images}
                      expanded={expandedId === v.id}
                      onToggle={() =>
                        setExpandedId((prev) =>
                          prev === v.id ? null : v.id
                        )
                      }
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
