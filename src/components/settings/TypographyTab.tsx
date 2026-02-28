"use client";

import { cn } from "@/lib/utils";
import {
  HEADING_FONTS,
  BODY_FONTS,
  type HeadingFont,
  type BodyFont,
} from "@/types/event-settings";

interface TypographyTabProps {
  headingFont: HeadingFont;
  bodyFont: BodyFont;
  onChangeHeading: (font: HeadingFont) => void;
  onChangeBody: (font: BodyFont) => void;
}

/**
 * TypographyTab — Font selectors for heading and body text.
 * Each option renders the font name in the actual font for preview.
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
          {HEADING_FONTS.map((font) => (
            <button
              key={font.value}
              onClick={() => onChangeHeading(font.value)}
              className={cn(
                "w-full text-left px-4 py-3 border transition-all duration-200",
                headingFont === font.value
                  ? "border-stone-900 bg-stone-50"
                  : "border-stone-200 hover:border-stone-400"
              )}
            >
              <span
                className={cn(
                  "text-[18px] leading-tight",
                  headingFont === font.value
                    ? "text-stone-900"
                    : "text-stone-600",
                  // Approximate font families for preview
                  font.value === "playfair" && "font-serif",
                  font.value === "inter" && "font-sans",
                  font.value === "cormorant" && "font-serif italic",
                  font.value === "dm-serif" && "font-serif",
                  font.value === "space-grotesk" && "font-sans tracking-tight"
                )}
              >
                {font.label}
              </span>
            </button>
          ))}
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
          {BODY_FONTS.map((font) => (
            <button
              key={font.value}
              onClick={() => onChangeBody(font.value)}
              className={cn(
                "w-full text-left px-4 py-3 border transition-all duration-200",
                bodyFont === font.value
                  ? "border-stone-900 bg-stone-50"
                  : "border-stone-200 hover:border-stone-400"
              )}
            >
              <span
                className={cn(
                  "text-[14px]",
                  bodyFont === font.value
                    ? "text-stone-900"
                    : "text-stone-600",
                  font.value === "inter" && "font-sans",
                  font.value === "source-serif" && "font-serif",
                  font.value === "lora" && "font-serif italic",
                  font.value === "dm-sans" && "font-sans tracking-tight"
                )}
              >
                {font.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
