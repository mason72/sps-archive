"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Search, X, Camera, Sparkles } from "lucide-react";
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

  // Debounced search as user types
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim()) {
      debounceRef.current = setTimeout(() => performSearch(query), 300);
    } else {
      onClear?.();
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, performSearch, onClear]);

  const handleClear = () => {
    setQuery("");
    onClear?.();
    inputRef.current?.focus();
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          className={cn(
            "absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 transition-colors",
            isSearching ? "animate-pulse text-stone-500" : "text-stone-400"
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
          className="h-12 w-full rounded-xl border border-stone-200 bg-white pl-11 pr-24 text-stone-900 shadow-sm transition-all placeholder:text-stone-400 focus:border-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-200"
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {query && (
            <button
              onClick={handleClear}
              className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Search type toggles */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-stone-400">Search by:</span>
        {(
          [
            { key: "auto", label: "Auto", icon: Sparkles },
            { key: "semantic", label: "Description", icon: Sparkles },
            { key: "filename", label: "Filename", icon: Search },
          ] as const
        ).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setSearchType(key)}
            className={cn(
              "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              searchType === key
                ? "bg-stone-900 text-white"
                : "bg-stone-100 text-stone-500 hover:bg-stone-200 hover:text-stone-700"
            )}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
        <button
          onClick={() => {
            // TODO: Open selfie upload modal for face search
          }}
          className="flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-500 hover:bg-stone-200 hover:text-stone-700"
        >
          <Camera className="h-3 w-3" />
          Find by selfie
        </button>
      </div>
    </div>
  );
}
