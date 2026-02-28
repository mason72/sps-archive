"use client";

import { cn } from "@/lib/utils";
import { COVER_LAYOUTS, type CoverLayout } from "@/types/event-settings";

interface CoverLayoutTabProps {
  value: CoverLayout;
  onChange: (layout: CoverLayout) => void;
}

/**
 * CoverLayoutTab — Grid of 12 cover layout options.
 * Each option shows a small rectangular thumbnail representing the layout.
 */
export function CoverLayoutTab({ value, onChange }: CoverLayoutTabProps) {
  return (
    <div>
      <h3 className="text-[15px] font-medium text-stone-900 mb-1">Cover</h3>
      <p className="text-[12px] text-stone-400 mb-6">
        Choose how the cover image is displayed on the gallery page.
      </p>

      <div className="grid grid-cols-2 gap-4">
        {COVER_LAYOUTS.map((layout) => (
          <button
            key={layout.value}
            onClick={() => onChange(layout.value)}
            className={cn(
              "group flex flex-col items-center gap-2 p-3 border transition-all duration-200",
              value === layout.value
                ? "border-stone-900 bg-stone-50"
                : "border-stone-200 hover:border-stone-400"
            )}
          >
            {/* Layout thumbnail preview */}
            <div className="w-full aspect-[4/3] bg-stone-100 relative overflow-hidden">
              <LayoutPreview layout={layout.value} isActive={value === layout.value} />
            </div>
            <span
              className={cn(
                "text-[11px] font-medium tracking-wide",
                value === layout.value ? "text-stone-900" : "text-stone-500"
              )}
            >
              {layout.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Simple abstract representation of each cover layout */
function LayoutPreview({ layout, isActive }: { layout: CoverLayout; isActive: boolean }) {
  const bg = isActive ? "bg-stone-400" : "bg-stone-300";
  const text = isActive ? "bg-stone-600" : "bg-stone-400";

  switch (layout) {
    case "center":
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-3">
          <div className={`w-full h-full ${bg}`} />
          <div className={`h-1 w-8 ${text}`} />
        </div>
      );
    case "love":
      return (
        <div className="absolute inset-0 flex gap-1 p-2">
          <div className={`flex-1 ${bg}`} />
          <div className={`flex-1 ${bg}`} />
        </div>
      );
    case "left":
      return (
        <div className="absolute inset-0 flex gap-1 p-2">
          <div className={`flex-[2] ${bg}`} />
          <div className="flex-1 flex flex-col justify-end gap-1">
            <div className={`h-1 w-full ${text}`} />
            <div className={`h-1 w-3/4 ${text}`} />
          </div>
        </div>
      );
    case "novel":
      return (
        <div className="absolute inset-0 flex p-2">
          <div className="flex-1 flex flex-col items-center justify-center gap-1">
            <div className={`h-1 w-12 ${text}`} />
          </div>
          <div className={`flex-1 ${bg}`} />
        </div>
      );
    case "vintage":
      return (
        <div className="absolute inset-0 flex items-center justify-center p-3">
          <div className={`w-3/4 h-3/4 ${bg} border-2 border-stone-200`} />
        </div>
      );
    case "frame":
      return (
        <div className={`absolute inset-0 ${bg} flex items-center justify-center`}>
          <div className={`h-1 w-10 bg-white`} />
        </div>
      );
    case "stripe":
      return (
        <div className="absolute inset-0 flex flex-col p-2 gap-1">
          <div className={`h-0.5 w-full ${text}`} />
          <div className={`flex-1 ${bg}`} />
          <div className={`h-0.5 w-full ${text}`} />
        </div>
      );
    case "divider":
      return (
        <div className="absolute inset-0 flex gap-0.5 p-2">
          <div className={`flex-1 ${bg}`} />
          <div className={`w-0.5 ${text}`} />
          <div className={`flex-1 ${bg}`} />
        </div>
      );
    case "journal":
      return (
        <div className="absolute inset-0 flex flex-col p-2 gap-1">
          <div className={`flex-[2] ${bg}`} />
          <div className="flex items-center gap-1">
            <div className={`h-1 w-8 ${text}`} />
          </div>
        </div>
      );
    case "stamp":
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-3 gap-1">
          <div className={`w-10 h-10 ${bg}`} />
          <div className={`h-1 w-8 ${text}`} />
        </div>
      );
    case "outline":
      return (
        <div className="absolute inset-2 border-2 border-stone-300 flex items-center justify-center">
          <div className={`h-1 w-8 ${text}`} />
        </div>
      );
    case "classic":
      return (
        <div className={`absolute inset-0 ${bg} flex items-end p-2`}>
          <div className={`h-1 w-10 bg-white`} />
        </div>
      );
    default:
      return <div className={`absolute inset-0 ${bg}`} />;
  }
}
