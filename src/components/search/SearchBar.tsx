"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Search, X, Camera } from "lucide-react";
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
}

export function SearchBar({
  eventId,
  onResults,
  onClear,
  placeholder,
}: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchType, setSearchType] = useState<"auto" | "semantic" | "filename">("auto");
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const performSearch = useCallback(
    async (searchQuery: string) => {
      if (!searchQuery.trim()) {
        onClear?.();
        return;
      }

      setIsSearching(true);
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
        setIsSearching(false);
      }
    },
    [eventId, searchType, onResults, onClear]
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim()) {
      // Filename search is fast (DB only) — near-instant
      // Semantic search hits AI endpoint — debounce more
      const delay = searchType === "semantic" ? 400 : 100;
      debounceRef.current = setTimeout(() => performSearch(query), delay);
    } else {
      onClear?.();
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, performSearch, onClear, searchType]);

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
          placeholder={
            placeholder ||
            (searchType === "semantic"
              ? 'Search by description... "first dance", "group photo"'
              : searchType === "filename"
                ? "Search by filename..."
                : 'Search images... try "Smith" or "first dance"')
          }
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

      {/* ─── Search type toggles ─── */}
      <div className="flex items-center gap-3">
        <span className="label-caps text-[10px]">Search by</span>
        {(
          [
            { key: "auto", label: "Auto" },
            { key: "semantic", label: "Description" },
            { key: "filename", label: "Filename" },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setSearchType(key)}
            className={cn(
              "px-3 py-1.5 text-[11px] uppercase tracking-[0.15em] font-medium border transition-all duration-300",
              searchType === key
                ? "border-stone-900 bg-stone-900 text-white"
                : "border-stone-200 text-stone-400 hover:border-stone-400 hover:text-stone-600"
            )}
          >
            {label}
          </button>
        ))}
        <button
          onClick={() => {
            // TODO: Open selfie upload modal for face search
          }}
          className="px-3 py-1.5 text-[11px] uppercase tracking-[0.15em] font-medium border border-stone-200 text-stone-400 hover:border-accent hover:text-accent transition-all duration-300 flex items-center gap-1.5"
        >
          <Camera className="h-3 w-3" />
          Selfie
        </button>
      </div>
    </div>
  );
}
