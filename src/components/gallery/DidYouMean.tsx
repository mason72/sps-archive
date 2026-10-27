"use client";

import { cn } from "@/lib/utils";

/** How many names the line spells out when the photos below carry the rest. */
const MAX_NAMES = 3;

/**
 * "No exact match for “stacey”. Did you mean Stacy Chen?" — the line above a
 * typo-tolerant name match (src/lib/gallery/name-search.ts). Clicking a name
 * searches it exactly. "Search the photos instead" hands the query to the
 * visual search, for the time a description lands one letter from a name.
 *
 * Shared by the guest gallery (branded colors) and the editor (stone).
 */
export function DidYouMean({
  query,
  names,
  onPick,
  onSearchPhotos,
  colors = { primary: "#1c1917", secondary: "#78716c" },
  showAll = false,
  className,
}: {
  /** The query as typed; omit to drop the "No exact match" lead-in. */
  query?: string;
  names: string[];
  onPick: (name: string) => void;
  onSearchPhotos?: () => void;
  colors?: { primary: string; secondary: string };
  /** Spell out every name: for an empty state, where no photos show them. */
  showAll?: boolean;
  className?: string;
}) {
  if (names.length === 0) return null;
  const shown = showAll ? names : names.slice(0, MAX_NAMES);
  const more = names.length - shown.length;

  return (
    <div
      className={cn("text-center mb-6 text-[13px] leading-relaxed", className)}
      style={{ color: colors.secondary }}
      role="status"
    >
      <p>
        {query && (
          <span className="italic">No exact match for &ldquo;{query}&rdquo;. </span>
        )}
        Did you mean{" "}
        {shown.map((name, i) => (
          <span key={name}>
            {i > 0 && (i === shown.length - 1 && more === 0 ? " or " : ", ")}
            <button
              type="button"
              onClick={() => onPick(name)}
              // On touch, the ::after widens the tap target past the line
              // without moving the text (padding on an inline-block would).
              className="relative underline underline-offset-[3px] decoration-1 transition-opacity hover:opacity-60 cursor-pointer pointer-coarse:after:absolute pointer-coarse:after:-inset-y-2.5 pointer-coarse:after:-inset-x-1 pointer-coarse:after:content-['']"
              style={{
                color: colors.primary,
                // color-mix, not a hex suffix: a brand color may be rgb() or named.
                textDecorationColor: `color-mix(in srgb, ${colors.primary} 35%, transparent)`,
              }}
            >
              {name}
            </button>
          </span>
        ))}
        {more > 0 && ` or ${more} other${more === 1 ? "" : "s"}`}?
      </p>
      {onSearchPhotos && (
        <button
          type="button"
          onClick={onSearchPhotos}
          className="mt-1.5 text-[11px] uppercase tracking-[0.14em] transition-opacity hover:opacity-60 cursor-pointer pointer-coarse:py-2"
          style={{ color: colors.secondary }}
        >
          Search the photos instead
        </button>
      )}
    </div>
  );
}
