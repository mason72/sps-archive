"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * One typeahead for venues and clients.
 *
 * Groups, not a flat list: "Your venues" first, because the thing you are
 * looking for is almost always one you have been to; then "Google Maps" for a
 * new room; then "Create" for a plain name with no map behind it. The groups
 * are the same control with different sources, so the keyboard behaviour —
 * arrows, Enter, Escape, tap on a phone — is written once.
 */

export interface ComboOption {
  key: string;
  label: string;
  sub?: string;
  group: string;
}

export interface ComboValue {
  id: string;
  name: string;
  sub?: string;
  /** Venues only — what the photo overlay prints after the name. */
  city?: string | null;
  region?: string | null;
}

export function Combobox({
  value,
  placeholder,
  query,
  onQuery,
  options,
  onPick,
  onClear,
  loading,
  hint,
  disabled,
  autoFocus,
}: {
  value: ComboValue | null;
  placeholder: string;
  query: string;
  onQuery: (q: string) => void;
  options: ComboOption[];
  onPick: (o: ComboOption) => void | Promise<void>;
  onClear: () => void;
  loading?: boolean;
  /** One quiet line under the list — "Maps search is off", "3 near this photo". */
  hint?: string | null;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => setActive(0), [options.length, query]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = async (o: ComboOption) => {
    setBusy(true);
    try {
      await onPick(o);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  if (value) {
    return (
      <div className="flex min-h-[40px] items-center justify-between gap-3 rounded-md border border-stone-200 bg-white px-3 py-2">
        <span className="min-w-0">
          <span className="block truncate text-[14px] text-stone-900">{value.name}</span>
          {value.sub && <span className="block truncate text-[12px] text-stone-400">{value.sub}</span>}
        </span>
        {!disabled && (
          <button
            type="button"
            onClick={onClear}
            className="shrink-0 text-[12px] text-stone-400 underline-offset-4 hover:text-stone-800 hover:underline"
          >
            Change
          </button>
        )}
      </div>
    );
  }

  const groups = [...new Set(options.map((o) => o.group))];
  let idx = -1;

  return (
    <div ref={root} className="relative">
      <input
        value={query}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        onChange={(e) => { onQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(options.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter") { e.preventDefault(); const o = options[active]; if (o) void pick(o); }
          else if (e.key === "Escape") setOpen(false);
        }}
        className="min-h-[40px] w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-[14px] text-stone-900 placeholder:text-stone-300 focus:border-stone-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 disabled:bg-stone-50"
      />
      {open && (options.length > 0 || loading || hint) && (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-auto rounded-md border border-stone-200 bg-white py-1 shadow-lg shadow-stone-900/5"
        >
          {groups.map((g) => (
            <div key={g}>
              <div className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-[0.14em] text-stone-400">{g}</div>
              {options.filter((o) => o.group === g).map((o) => {
                idx += 1;
                const i = idx;
                return (
                  <button
                    key={o.key}
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    disabled={busy}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => void pick(o)}
                    className={`flex w-full flex-col items-start px-3 py-2 text-left ${
                      i === active ? "bg-stone-100" : ""
                    }`}
                  >
                    <span className="text-[14px] text-stone-900">{o.label}</span>
                    {o.sub && <span className="text-[12px] text-stone-400">{o.sub}</span>}
                  </button>
                );
              })}
            </div>
          ))}
          {loading && <div className="px-3 py-2 text-[12px] text-stone-400">Searching…</div>}
          {hint && !loading && <div className="px-3 py-2 text-[12px] text-stone-400">{hint}</div>}
        </div>
      )}
    </div>
  );
}
