"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { SearchBar } from "@/components/search/SearchBar";
import { useColumnCount } from "@/hooks/useColumnCount";
import { AppNav } from "@/components/layout/AppNav";
import { Footer } from "@/components/layout/Footer";
import { PixelMosaic } from "@/components/ui/PixelMosaic";

interface SearchResult {
  id: string;
  eventId: string;
  filename: string;
  parsedName?: string | null;
  r2Key: string;
  thumbnailUrl?: string;
  originalUrl?: string;
  score: number;
}

/**
 * Global search page — searches across ALL events in the archive.
 * Editorial design: minimal chrome, serif headings, generous space.
 */
export default function GlobalSearchPage() {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchType, setSearchType] = useState<string>("");
  const [hasSearched, setHasSearched] = useState(false);
  const columnCount = useColumnCount();

  return (
    <div className="min-h-screen flex flex-col">
      <AppNav active="search" />

      <main className="px-8 md:px-16 pt-16 pb-24">
        <div className="max-w-4xl">
          <p
            className="label-caps mb-4 reveal"
            style={{ animationDelay: "0.1s" }}
          >
            Find anything
          </p>
          <h1
            className="font-editorial text-[clamp(36px,5vw,56px)] leading-[0.95] text-stone-900 mb-8 reveal"
            style={{ animationDelay: "0.15s" }}
          >
            Search your{" "}
            <span className="italic text-accent font-serif font-normal">
              entire
            </span>{" "}
            archive
          </h1>
          <p
            className="text-stone-400 text-[15px] max-w-md leading-[1.8] mb-12 reveal"
            style={{ animationDelay: "0.2s" }}
          >
            Search by filename or parsed name across every event. Smart
            visual search is on the way.
          </p>

          <div className="reveal" style={{ animationDelay: "0.25s" }}>
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
              placeholder='Search by filename… "SmithJohn" or "IMG_4532"'
            />
          </div>
        </div>

        {/* ─── Results ─── */}
        <div className="mt-12">
          {hasSearched && results.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center py-20">
              <div className="text-stone-300 mb-5">
                <PixelMosaic size={28} className="opacity-100" />
              </div>
              <p className="font-editorial text-[22px] text-stone-400 italic mb-2">
                Nothing matched
              </p>
              <p className="text-[13px] text-stone-400 max-w-xs leading-relaxed">
                Try a different filename or part of a parsed name. Search
                runs across every event in your archive.
              </p>
            </div>
          )}

          {results.length > 0 && (
            <div>
              <div className="editorial-divider mb-8">
                <span className="label-caps shrink-0">
                  {results.length} results via {searchType}
                </span>
              </div>

              <div className="flex gap-1.5">
                {distributeToColumns(results, columnCount).map((col, colIdx) => (
                  <div key={colIdx} className="flex-1 flex flex-col gap-1.5">
                    {col.map((result) => (
                      <SearchResultCard key={result.id} result={result} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}

/** Distribute items into N columns round-robin */
function distributeToColumns<T>(items: T[], colCount: number): T[][] {
  const columns: T[][] = Array.from({ length: colCount }, () => []);
  items.forEach((item, i) => columns[i % colCount].push(item));
  return columns;
}

/** Single search result card with thumbnail */
function SearchResultCard({ result }: { result: SearchResult }) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  return (
    <Link
      href={`/events/${result.eventId}?image=${result.id}`}
      className="group relative block w-full overflow-hidden bg-stone-100 photo-lift"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={result.thumbnailUrl || result.originalUrl || ""}
        alt={result.parsedName || result.filename || ""}
        className={`w-full h-auto object-cover transition-all duration-500 group-hover:scale-[1.03] ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => {
          if (imgRef.current && result.originalUrl && imgRef.current.src !== result.originalUrl) {
            imgRef.current.src = result.originalUrl;
          }
        }}
      />
      {!loaded && <div className="aspect-square" />}

      {/* Hover overlay with filename */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-3 pt-8 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
        <p className="text-[11px] text-white/90 truncate">
          {result.parsedName || result.filename}
        </p>
        <p className="text-[10px] text-white/50 mt-0.5">
          {Math.round(result.score * 100)}% match
        </p>
      </div>
    </Link>
  );
}
