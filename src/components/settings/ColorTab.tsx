"use client";

import { useState } from "react";

interface ColorTabProps {
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
  };
  onChange: (colors: ColorTabProps["colors"]) => void;
}

const COLOR_FIELDS: {
  key: keyof ColorTabProps["colors"];
  label: string;
  description: string;
}[] = [
  { key: "primary", label: "Primary", description: "Headings and main text" },
  { key: "secondary", label: "Secondary", description: "Body text and captions" },
  { key: "accent", label: "Accent", description: "Links, buttons, and highlights" },
  { key: "background", label: "Background", description: "Page background color" },
];

/**
 * ColorTab — Four color pickers for the gallery color scheme.
 * Uses native color inputs styled to match the editorial design.
 */
export function ColorTab({ colors, onChange }: ColorTabProps) {
  return (
    <div>
      <h3 className="text-[15px] font-medium text-stone-900 mb-1">Colors</h3>
      <p className="text-[12px] text-stone-400 mb-6">
        Customize the color scheme for the public gallery.
      </p>

      <div className="space-y-5">
        {COLOR_FIELDS.map((field) => (
          <ColorField
            key={field.key}
            label={field.label}
            description={field.description}
            value={colors[field.key]}
            onChange={(value) =>
              onChange({ ...colors, [field.key]: value })
            }
          />
        ))}
      </div>

      {/* Preview */}
      <div className="mt-8">
        <p className="label-caps mb-3">Preview</p>
        <div
          className="border border-stone-200 overflow-hidden"
          style={{ backgroundColor: colors.background }}
        >
          {/* Mini gallery header */}
          <div className="px-5 pt-5 pb-4">
            <h4
              className="font-serif text-lg leading-tight mb-1"
              style={{ color: colors.primary }}
            >
              Sarah & James
            </h4>
            <p
              className="text-[12px] mb-3"
              style={{ color: colors.secondary }}
            >
              A summer wedding in the countryside
            </p>
            <div className="flex items-center gap-3">
              <span
                className="text-[11px] font-medium uppercase tracking-[0.1em]"
                style={{ color: colors.accent }}
              >
                View Gallery
              </span>
              <span
                className="text-[11px]"
                style={{ color: colors.secondary, opacity: 0.6 }}
              >
                48 photos
              </span>
            </div>
          </div>

          {/* Mini photo grid placeholder */}
          <div className="px-5 pb-5">
            <div className="grid grid-cols-4 gap-1">
              {[0.85, 0.7, 0.75, 0.65, 0.9, 0.6, 0.8, 0.7].map((opacity, i) => (
                <div
                  key={i}
                  className="aspect-square"
                  style={{
                    backgroundColor: colors.primary,
                    opacity: opacity * 0.15,
                  }}
                />
              ))}
            </div>
          </div>

          {/* Accent bar */}
          <div
            className="h-1"
            style={{ backgroundColor: colors.accent }}
          />
        </div>
      </div>
    </div>
  );
}

function ColorField({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [hexInput, setHexInput] = useState(value);

  return (
    <div className="flex items-center gap-4">
      {/* Color swatch + native picker */}
      <label className="relative cursor-pointer shrink-0">
        <div
          className="w-10 h-10 border border-stone-200"
          style={{ backgroundColor: value }}
        />
        <input
          type="color"
          value={value}
          onChange={(e) => {
            const hex = e.target.value;
            setHexInput(hex);
            onChange(hex);
          }}
          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
        />
      </label>

      {/* Label + hex input */}
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-stone-900">{label}</div>
        <div className="text-[11px] text-stone-400">{description}</div>
      </div>

      {/* Hex value */}
      <input
        type="text"
        value={hexInput}
        onChange={(e) => {
          setHexInput(e.target.value);
          if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) {
            onChange(e.target.value);
          }
        }}
        className="w-20 text-[12px] text-stone-600 font-mono px-2 py-1.5 border-b border-stone-200 bg-transparent focus:outline-none focus:border-stone-900 transition-colors"
        maxLength={7}
      />
    </div>
  );
}
