"use client";

import { cn } from "@/lib/utils";
import {
  HEADING_FONTS,
  BODY_FONTS,
  type HeadingFont,
  type BodyFont,
} from "@/types/event-settings";

/** Map font value to its CSS variable for actual font rendering */
const HEADING_FONT_CSS: Record<HeadingFont, string> = {
  playfair: "var(--font-playfair)",
  inter: "var(--font-inter)",
  cormorant: "var(--font-cormorant)",
  "dm-serif": "var(--font-dm-serif)",
  "space-grotesk": "var(--font-space-grotesk)",
};

const BODY_FONT_CSS: Record<BodyFont, string> = {
  inter: "var(--font-inter)",
  "source-serif": "var(--font-source-serif)",
  lora: "var(--font-lora)",
  "dm-sans": "var(--font-dm-sans)",
};

const HEADING_SAMPLE = "The Quiet Beauty of Light";
const BODY_SAMPLE =
  "Every photograph tells a story — a fleeting moment preserved in time.";

interface TypographyTabProps {
  headingFont: HeadingFont;
  bodyFont: BodyFont;
  onChangeHeading: (font: HeadingFont) => void;
  onChangeBody: (font: BodyFont) => void;
}

/**
 * TypographyTab — Font selectors for heading and body text.
 * Each option renders sample text in the actual loaded font.
 */
export function TypographyTab({
  headingFont,
  bodyFont,
  onChangeHeading,
  onChangeBody,
}: TypographyTabProps) {
  return (
    <div className="space-y-8">
      {/* Heading font */}
      <div>
        <h3 className="text-[15px] font-medium text-stone-900 mb-1">
          Heading Font
        </h3>
        <p className="text-[12px] text-stone-400 mb-4">
          Used for event titles and section headers.
        </p>
        <div className="space-y-2">
          {HEADING_FONTS.map((font) => {
            const isActive = headingFont === font.value;
            return (
              <button
                key={font.value}
                onClick={() => onChangeHeading(font.value)}
                className={cn(
                  "w-full text-left px-4 py-3.5 border transition-all duration-200",
                  isActive
                    ? "border-stone-900 bg-stone-50 shadow-sm"
                    : "border-stone-200 hover:border-stone-400"
                )}
              >
                <div className="flex items-baseline justify-between gap-3 mb-1.5">
                  <span
                    className={cn(
                      "text-[11px] uppercase tracking-[0.12em] font-medium",
                      isActive ? "text-stone-900" : "text-stone-400"
                    )}
                  >
                    {font.label}
                  </span>
                </div>
                <p
                  className={cn(
                    "text-[22px] leading-tight",
                    isActive ? "text-stone-900" : "text-stone-600"
                  )}
                  style={{ fontFamily: HEADING_FONT_CSS[font.value] }}
                >
                  {HEADING_SAMPLE}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Body font */}
      <div>
        <h3 className="text-[15px] font-medium text-stone-900 mb-1">
          Body Font
        </h3>
        <p className="text-[12px] text-stone-400 mb-4">
          Used for descriptions, captions, and metadata.
        </p>
        <div className="space-y-2">
          {BODY_FONTS.map((font) => {
            const isActive = bodyFont === font.value;
            return (
              <button
                key={font.value}
                onClick={() => onChangeBody(font.value)}
                className={cn(
                  "w-full text-left px-4 py-3.5 border transition-all duration-200",
                  isActive
                    ? "border-stone-900 bg-stone-50 shadow-sm"
                    : "border-stone-200 hover:border-stone-400"
                )}
              >
                <div className="flex items-baseline justify-between gap-3 mb-1.5">
                  <span
                    className={cn(
                      "text-[11px] uppercase tracking-[0.12em] font-medium",
                      isActive ? "text-stone-900" : "text-stone-400"
                    )}
                  >
                    {font.label}
                  </span>
                </div>
                <p
                  className={cn(
                    "text-[14px] leading-relaxed",
                    isActive ? "text-stone-900" : "text-stone-600"
                  )}
                  style={{ fontFamily: BODY_FONT_CSS[font.value] }}
                >
                  {BODY_SAMPLE}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
