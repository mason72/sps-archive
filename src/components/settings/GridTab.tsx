"use client";

import { cn } from "@/lib/utils";
import type { GridGap, GridStyle } from "@/types/event-settings";

interface GridTabProps {
  columns: number;
  gap: GridGap;
  style: GridStyle;
  showFilenames?: boolean;
  onChange: (updates: Partial<{ columns: number; gap: GridGap; style: GridStyle; showFilenames: boolean }>) => void;
}

const COLUMN_OPTIONS = [3, 4, 5, 6, 7];

const GAP_OPTIONS: { value: GridGap; label: string; description: string }[] = [
  { value: "tight", label: "Tight", description: "Minimal spacing" },
  { value: "normal", label: "Normal", description: "Balanced spacing" },
  { value: "loose", label: "Loose", description: "Generous spacing" },
];

const STYLE_OPTIONS: { value: GridStyle; label: string; description: string }[] = [
  { value: "masonry", label: "Masonry", description: "Natural aspect ratios, Pinterest-style" },
  { value: "uniform", label: "Uniform", description: "Cropped to equal heights" },
];

/**
 * GridTab — Configure grid column count, gap, and layout style.
 */
export function GridTab({ columns, gap, style, showFilenames, onChange }: GridTabProps) {
  return (
    <div className="space-y-8">
      {/* Column count */}
      <div>
        <h3 className="text-[15px] font-medium text-stone-900 mb-1">
          Columns
        </h3>
        <p className="text-[12px] text-stone-400 mb-4">
          Number of columns in the image grid.
        </p>
        <div className="flex gap-2">
          {COLUMN_OPTIONS.map((n) => (
            <button
              key={n}
              onClick={() => onChange({ columns: n })}
              className={cn(
                "w-11 h-11 flex items-center justify-center text-[14px] font-medium border transition-all duration-200",
                columns === n
                  ? "border-stone-900 bg-stone-900 text-white"
                  : "border-stone-200 text-stone-500 hover:border-stone-400"
              )}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Gap */}
      <div>
        <h3 className="text-[15px] font-medium text-stone-900 mb-1">
          Spacing
        </h3>
        <p className="text-[12px] text-stone-400 mb-4">
          Gap between images in the grid.
        </p>
        <div className="space-y-2">
          {GAP_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onChange({ gap: opt.value })}
              className={cn(
                "w-full text-left px-4 py-3 border transition-all duration-200",
                gap === opt.value
                  ? "border-stone-900 bg-stone-50"
                  : "border-stone-200 hover:border-stone-400"
              )}
            >
              <div className="text-[13px] font-medium text-stone-900">
                {opt.label}
              </div>
              <div className="text-[11px] text-stone-400">{opt.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Layout style */}
      <div>
        <h3 className="text-[15px] font-medium text-stone-900 mb-1">
          Layout Style
        </h3>
        <p className="text-[12px] text-stone-400 mb-4">
          How images are arranged in the grid.
        </p>
        <div className="space-y-2">
          {STYLE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onChange({ style: opt.value })}
              className={cn(
                "w-full text-left px-4 py-3 border transition-all duration-200",
                style === opt.value
                  ? "border-stone-900 bg-stone-50"
                  : "border-stone-200 hover:border-stone-400"
              )}
            >
              <div className="text-[13px] font-medium text-stone-900">
                {opt.label}
              </div>
              <div className="text-[11px] text-stone-400">{opt.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Show filenames toggle */}
      <div>
        <h3 className="text-[15px] font-medium text-stone-900 mb-1">
          Filenames
        </h3>
        <p className="text-[12px] text-stone-400 mb-4">
          Show original filenames below images in the editor.
        </p>
        <button
          onClick={() => onChange({ showFilenames: !showFilenames })}
          className={cn(
            "w-full text-left px-4 py-3 border transition-all duration-200 flex items-center justify-between",
            showFilenames
              ? "border-stone-900 bg-stone-50"
              : "border-stone-200 hover:border-stone-400"
          )}
        >
          <span className="text-[13px] font-medium text-stone-900">
            Show filenames
          </span>
          <div
            className={cn(
              "w-8 h-5 rounded-full transition-colors duration-200 relative",
              showFilenames ? "bg-stone-900" : "bg-stone-300"
            )}
          >
            <div
              className={cn(
                "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 shadow-sm",
                showFilenames ? "translate-x-3.5" : "translate-x-0.5"
              )}
            />
          </div>
        </button>
      </div>

      {/* Preview */}
      <div>
        <p className="label-caps mb-3">Preview</p>
        <GridPreview columns={columns} gap={gap} style={style} />
      </div>
    </div>
  );
}

function GridPreview({
  columns,
  gap,
  style,
}: {
  columns: number;
  gap: GridGap;
  style: GridStyle;
}) {
  const gapPx = gap === "tight" ? 2 : gap === "normal" ? 4 : 8;

  return (
    <div
      className="border border-stone-200 p-3"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: `${gapPx}px`,
      }}
    >
      {Array.from({ length: columns * 2 }).map((_, i) => (
        <div
          key={i}
          className="bg-stone-200"
          style={{
            height: style === "uniform" ? 24 : 16 + (i % 3) * 8,
          }}
        />
      ))}
    </div>
  );
}
