"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchResult {
  id: string;
  filename: string;
  parsedName?: string | null;
  r2Key: string;
  score: number;
  thumbnailUrl?: string;
}

interface SearchBarProps {
  /** Optional: scope search to a specific event */
  eventId?: string;
  /** Callback when results are returned */
  onResults?: (results: SearchResult[], type: string) => void;
  /** Callback when search is cleared */
  onClear?: () => void;
  /** Placeholder override */
  placeholder?: string;
  /** Seed the (uncontrolled) input and run that search on mount — used by
   *  cross-links like /search?q=bride */
  initialQuery?: string;
  /**
   * Controlled mode: when `onChange` is provided the input is driven by
   * `value` and the parent owns the search (the internal server fetch/debounce
   * is skipped). The uncontrolled mode (no onChange) keeps the original
   * server-backed behavior used by the global search page.
   */
  value?: string;
  onChange?: (query: string) => void;
}

/**
 * Discovery chips: shown when the box is empty so photographers learn the
 * search speaks plain English, not just filenames. Each query is phrased the
 * way SigLIP likes it — a short natural description of a photo.
 */
const SEARCH_SUGGESTIONS = [
  { label: "Laughing", query: "people laughing together" },
  { label: "Photo booth", query: "friends posing at a photo booth with props" },
  { label: "Golden hour", query: "golden hour warm light portrait" },
  { label: "Group photos", query: "a large group posing together" },
  { label: "Details", query: "close-up detail shot" },
  { label: "Speeches", query: "a person speaking at a podium" },
];

export function SearchBar({
  eventId,
  onResults,
  onClear,
  placeholder,
  initialQuery,
  value,
  onChange,
}: SearchBarProps) {
  // Controlled when the parent passes onChange — it owns the query + search.
  const controlled = onChange !== undefined;
  const [internalQuery, setInternalQuery] = useState(initialQuery ?? "");
  const query = controlled ? value ?? "" : internalQuery;
  const setQuery = controlled ? onChange! : setInternalQuery;
  const [isSearching, setIsSearching] = useState(false);
  // True once a search has been in flight for a while — the first semantic
  // query after idle cold-starts the text encoder (~15-20s); say so instead
  // of looking hung.
  const [isSlow, setIsSlow] = useState(false);
  // Auto: filename hits win, anything else falls through to semantic. The
  // controlled (editor filter) mode never fetches, so this only drives the
  // global search page.
  const searchType = "auto";
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const slowRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const performSearch = useCallback(
    async (searchQuery: string) => {
      if (!searchQuery.trim()) {
        onClear?.();
        return;
      }

      setIsSearching(true);
      slowRef.current = setTimeout(() => setIsSlow(true), 2500);
      try {
        const params = new URLSearchParams({
          q: searchQuery,
          type: searchType,
          limit: "50",
        });
        if (eventId) params.set("eventId", eventId);

        const response = await fetch(`/api/search?${params}`);
        if (!response.ok) throw new Error("Search failed");

        const data = await response.json();
        onResults?.(data.results, data.type);
      } catch (error) {
        console.error("Search error:", error);
      } finally {
        clearTimeout(slowRef.current);
        setIsSlow(false);
        setIsSearching(false);
      }
    },
    [eventId, searchType, onResults, onClear]
  );

  // Tracks the previous query so onClear fires only on the non-empty → empty
  // transition. Calling it on every empty-query effect run looped: onClear →
  // parent setState → new prop identities → effect re-runs → onClear → …
  const hadQueryRef = useRef(false);

  useEffect(() => {
    // Controlled mode: the parent does the searching off `value`; this input
    // only reports keystrokes. Skip the server fetch entirely.
    if (controlled) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim()) {
      hadQueryRef.current = true;
      // Auto mode can fall through to the AI endpoint — debounce generously
      // so keystrokes don't queue semantic searches.
      debounceRef.current = setTimeout(() => performSearch(query), 400);
    } else if (hadQueryRef.current) {
      hadQueryRef.current = false;
      onClear?.();
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [controlled, query, performSearch, onClear, searchType]);

  const handleClear = () => {
    setQuery("");
    onClear?.();
    inputRef.current?.focus();
  };

  return (
    <div className="space-y-4">
      {/* ─── Search input ─── */}
      <div className="relative">
        <Search
          className={cn(
            "absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 transition-colors duration-300",
            isSearching ? "text-accent animate-pulse" : "text-stone-300"
          )}
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder || "Search by filename..."}
          className="h-12 w-full border-b border-stone-200 bg-transparent pl-7 pr-10 text-[16px] text-stone-900 placeholder:text-stone-300 focus:border-stone-900 focus:outline-none transition-colors duration-300"
        />
        {query && (
          <button
            onClick={handleClear}
            className="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-stone-300 hover:text-stone-600 transition-colors duration-300"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* First-search-of-the-day cold start: honest, calm, temporary. */}
      {isSlow && (
        <p className="caption-italic text-stone-400 animate-pulse">
          Warming up visual search — the first search takes a little longer…
        </p>
      )}

      {/* Discovery chips (global search only): teach that plain English works. */}
      {!controlled && !query && (
        <div className="flex flex-wrap gap-2">
          {SEARCH_SUGGESTIONS.map((s) => (
            <button
              key={s.label}
              onClick={() => setQuery(s.query)}
              className="px-3 py-1 text-[11px] uppercase tracking-[0.12em] font-medium border border-stone-200 text-stone-400 hover:border-stone-400 hover:text-stone-600 transition-all duration-300"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
