"use client";

import { Suspense, useCallback, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { SearchBar } from "@/components/search/SearchBar";
import { useColumnCount } from "@/hooks/useColumnCount";
import { Nav } from "@/components/layout/Nav";
import { AppNav } from "@/components/layout/AppNav";
import { ElephantWalk } from "@/components/brand/ElephantWalk";
import { Footer } from "@/components/layout/Footer";

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
 * Accepts ?q= to seed a search (cross-links from the dashboard).
 * useSearchParams requires the Suspense boundary (Next 15).
 */
export default function GlobalSearchPage() {
  return (
    <Suspense fallback={null}>
      <GlobalSearchInner />
    </Suspense>
  );
}

function GlobalSearchInner() {
  const seedQuery = useSearchParams().get("q") ?? "";
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchType, setSearchType] = useState<string>("");
  const [hasSearched, setHasSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const columnCount = useColumnCount();

  // Stable identities: these are effect dependencies inside SearchBar, so
  // fresh closures per render would re-trigger its search effect in a loop.
  const handleResults = useCallback((r: unknown[], type: string) => {
    setResults(r as SearchResult[]);
    setSearchType(type);
    setHasSearched(true);
  }, []);
  const handleClear = useCallback(() => {
    setResults([]);
    setHasSearched(false);
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <Nav>
        <AppNav current="search" />
      </Nav>

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
            By description, filename, or visual similarity. Every image, every event — instantly searchable.
          </p>

          <div className="reveal" style={{ animationDelay: "0.25s" }}>
            <SearchBar
              onResults={handleResults}
              onClear={handleClear}
              onSearchingChange={setSearching}
              initialQuery={seedQuery}
              placeholder='Try "people laughing", "signage", or a filename…'
            />
          </div>
        </div>

        {/* ─── Results ─── */}
        <div className="mt-12">
          {/* This page used to render NOTHING while a semantic query ran — the
              embed is a GPU round-trip and a cold start is several seconds, so
              the page just sat there looking broken. */}
          {searching && results.length === 0 && (
            <ElephantWalk
              className="mx-auto max-w-[400px] py-8"
              message="Searching your archive…"
              detail="Reading the photos themselves — this can take a few seconds."
            />
          )}

          {hasSearched && !searching && results.length === 0 && (
            <div className="text-center py-16">
              <p className="caption-italic">
                No images found. Try a different search term.
              </p>
            </div>
          )}

          {results.length > 0 && (
            <div>
              <div className="editorial-divider mb-8">
                <span className="label-caps shrink-0">
                  {results.length}{" "}
                  {searchType === "semantic" ? "visual matches" : "filename matches"}
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
      href={`/events/${result.eventId}`}
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
      </div>
    </Link>
  );
}
