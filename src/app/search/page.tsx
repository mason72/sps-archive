"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Archive } from "lucide-react";
import { SearchBar } from "@/components/search/SearchBar";

interface SearchResult {
  id: string;
  eventId: string;
  filename: string;
  parsedName?: string | null;
  r2Key: string;
  score: number;
}

/**
 * Global search page — searches across ALL events in the archive.
 * This is the "find anything" power feature.
 */
export default function GlobalSearchPage() {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchType, setSearchType] = useState<string>("");
  const [hasSearched, setHasSearched] = useState(false);

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex h-16 max-w-4xl items-center gap-4 px-6">
          <Link href="/" className="text-stone-400 hover:text-stone-600">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex items-center gap-2">
            <Archive className="h-5 w-5 text-stone-900" />
            <span className="font-semibold">Search Archive</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        <SearchBar
          onResults={(r, type) => {
            setResults(r as SearchResult[]);
            setSearchType(type);
            setHasSearched(true);
          }}
          onClear={() => {
            setResults([]);
            setHasSearched(false);
          }}
          placeholder='Search your entire archive... "Johnson wedding first dance"'
        />

        {/* Results */}
        <div className="mt-8">
          {hasSearched && results.length === 0 && (
            <p className="text-center text-stone-400">
              No images found. Try a different search term.
            </p>
          )}

          {results.length > 0 && (
            <div>
              <p className="mb-4 text-sm text-stone-400">
                {results.length} results via {searchType} search
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {results.map((result) => (
                  <div
                    key={result.id}
                    className="group relative aspect-[3/4] overflow-hidden rounded-lg bg-stone-100"
                  >
                    {/* Placeholder — will show actual thumbnails when R2 is connected */}
                    <div className="flex h-full flex-col items-center justify-center p-2 text-center">
                      <p className="text-xs text-stone-500 truncate w-full">
                        {result.filename}
                      </p>
                      {result.parsedName && (
                        <p className="mt-1 text-xs font-medium text-stone-700">
                          {result.parsedName}
                        </p>
                      )}
                      <p className="mt-1 text-[10px] text-stone-400">
                        {Math.round(result.score * 100)}% match
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
