"use client";

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { ArrowLeft, Share2, Settings, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UploadZone } from "@/components/upload/UploadZone";
import { SearchBar } from "@/components/search/SearchBar";
import { ImageGrid } from "@/components/gallery/ImageGrid";

interface EventData {
  id: string;
  name: string;
  slug: string;
  event_type: string | null;
  event_date: string | null;
  description: string | null;
}

interface ImageData {
  id: string;
  r2Key: string;
  thumbnailUrl: string;
  originalFilename: string;
  aestheticScore: number | null;
  stackId: string | null;
  stackRank: number | null;
  parsedName: string | null;
}

interface StackData {
  id: string;
  stackType: "face" | "burst" | "similar";
  imageCount: number;
  personName: string | null;
  images: ImageData[];
}

interface SectionData {
  id: string;
  name: string;
  isAuto: boolean;
  imageCount: number;
}

export default function EventPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = use(params);
  const [event, setEvent] = useState<EventData | null>(null);
  const [images, setImages] = useState<ImageData[]>([]);
  const [stacks, setStacks] = useState<StackData[]>([]);
  const [sections, setSections] = useState<SectionData[]>([]);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch event data
  useEffect(() => {
    async function loadEvent() {
      try {
        // For now, just set loading false — will wire to Supabase
        setIsLoading(false);
        setShowUpload(true); // Show upload by default for now
      } catch (error) {
        console.error("Failed to load event:", error);
      }
    }
    loadEvent();
  }, [eventId]);

  const handleUploadComplete = useCallback((imageIds: string[]) => {
    console.log("Uploaded:", imageIds.length, "images");
    // TODO: Refresh gallery after upload + processing
  }, []);

  const handleSearchResults = useCallback(
    (results: Array<{ id: string; filename: string; r2Key: string; score: number }>, type: string) => {
      console.log("Search results:", results.length, type);
      // TODO: Filter displayed images to search results
    },
    []
  );

  const handleSearchClear = useCallback(() => {
    // TODO: Reset to showing all images
  }, []);

  // Separate stacked and standalone images
  const standalone = images.filter((img) => !img.stackId);

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="text-stone-400 hover:text-stone-600"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="font-semibold text-stone-900">
                {event?.name || "Event"}
              </h1>
              {event?.event_date && (
                <p className="text-xs text-stone-400">{event.event_date}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowUpload((v) => !v)}
            >
              {showUpload ? "Hide upload" : "Upload"}
            </Button>
            <Button variant="ghost" size="sm">
              <Share2 className="h-4 w-4" />
              Share
            </Button>
            <Button variant="ghost" size="sm">
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        {/* Upload zone (collapsible) */}
        {showUpload && (
          <div className="mb-8">
            <UploadZone
              eventId={eventId}
              onUploadComplete={handleUploadComplete}
            />
          </div>
        )}

        {/* Search */}
        <div className="mb-6">
          <SearchBar
            eventId={eventId}
            onResults={handleSearchResults}
            onClear={handleSearchClear}
          />
        </div>

        {/* Section tabs */}
        {sections.length > 0 && (
          <div className="mb-6 flex items-center gap-2 overflow-x-auto">
            <button
              onClick={() => setActiveSection(null)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                !activeSection
                  ? "bg-stone-900 text-white"
                  : "bg-stone-100 text-stone-600 hover:bg-stone-200"
              }`}
            >
              All
            </button>
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  activeSection === section.id
                    ? "bg-stone-900 text-white"
                    : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                }`}
              >
                {section.name}
                {section.isAuto && (
                  <Layers className="ml-1 inline-block h-3 w-3 opacity-50" />
                )}
              </button>
            ))}
          </div>
        )}

        {/* Image grid with smart stacks */}
        <ImageGrid
          images={images}
          stacks={stacks}
          standalone={standalone}
          onImageClick={(id) => console.log("View image:", id)}
          onSetCover={(stackId, imageId) =>
            console.log("Set cover:", stackId, imageId)
          }
        />
      </main>
    </div>
  );
}
