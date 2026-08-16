"use client";

import { cn } from "@/lib/utils";

/**
 * One segmented pill — the house control for "pick exactly one of these".
 *
 * Mason, 2026-08-15: "replace with a combined pill so only the two ends are
 * rounded and they're one segmented pill", pointing at the discipline and
 * rehire pickers, which already had this shape. Loose rounded-full chips read
 * as several independent toggles; one track with hairline dividers reads as
 * what it is — a single question with several answers, where picking one
 * necessarily un-picks the others.
 *
 * Extracted rather than copied a fourth time: the filter existed as separate
 * chips on the Crew axis and the Roster tab, and as bare text links on the
 * /people wall, so the SAME question ("which cut of the roster?") had three
 * different appearances. One component, one appearance.
 *
 * Selection is stone-900, never the accent — emerald is state for the brand
 * (active tab, progress, focus), and a filter is a view, not a decision about
 * a person. `counts` are optional and render dimmed inside the segment.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  counts,
  label,
  size = "sm",
}: {
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (v: T) => void;
  /** Optional per-option tally, dimmed beside its label. */
  counts?: Partial<Record<T, number>>;
  /** Screen-reader name for the group. */
  label?: string;
  size?: "sm" | "xs";
}) {
  const pad = size === "xs" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-[12px]";
  const cap = size === "xs" ? "first:pl-3 last:pr-3" : "first:pl-3.5 last:pr-3.5";
  return (
    <span
      role="radiogroup"
      aria-label={label}
      className="inline-flex overflow-hidden rounded-full border border-stone-200 bg-white"
    >
      {options.map(([v, text], i) => {
        const on = v === value;
        const n = counts?.[v];
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(v)}
            className={cn(
              "transition-colors duration-150",
              pad,
              cap,
              i > 0 && "border-l border-stone-200",
              on
                ? "bg-stone-900 text-white"
                : "text-stone-500 hover:bg-stone-50 hover:text-stone-800"
            )}
          >
            {text}
            {n != null && (
              <span className={cn("ml-1.5 tabular-nums", on ? "opacity-60" : "text-stone-400")}>
                {n}
              </span>
            )}
          </button>
        );
      })}
    </span>
  );
}
