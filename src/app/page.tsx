import Link from "next/link";
import { Plus, Search, Archive, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <Archive className="h-6 w-6 text-stone-900" />
            <span className="text-lg font-semibold tracking-tight">
              SPS Archive
            </span>
          </div>
          <nav className="flex items-center gap-2">
            <Link href="/search">
              <Button variant="ghost" size="sm">
                <Search className="h-4 w-4" />
                Search
              </Button>
            </Link>
            <Link href="/events/new">
              <Button size="sm">
                <Plus className="h-4 w-4" />
                New Event
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero / Empty state */}
      <main className="mx-auto max-w-7xl px-6 py-16">
        <div className="flex flex-col items-center text-center">
          <div className="mb-6 rounded-2xl bg-stone-50 p-4">
            <Sparkles className="h-10 w-10 text-stone-400" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-stone-900">
            Your intelligent photo archive
          </h1>
          <p className="mt-3 max-w-md text-stone-500">
            Upload thousands of images and let AI organize them into smart
            stacks, searchable sections, and shareable galleries.
          </p>
          <div className="mt-8 flex gap-3">
            <Link href="/events/new">
              <Button size="lg">
                <Plus className="h-5 w-5" />
                Create your first event
              </Button>
            </Link>
          </div>

          {/* Feature highlights */}
          <div className="mt-20 grid max-w-3xl gap-8 sm:grid-cols-3">
            {[
              {
                title: "Smart Stacks",
                description:
                  "12 headshots of the same person? See the best one on top, expand to compare.",
              },
              {
                title: "AI Search",
                description:
                  'Search by description — "first dance", "speeches", or even upload a selfie.',
              },
              {
                title: "Auto Sections",
                description:
                  "AI detects scenes and creates overlapping sections. One photo, multiple contexts.",
              },
            ].map((feature) => (
              <div key={feature.title} className="text-left">
                <h3 className="font-semibold text-stone-900">
                  {feature.title}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-stone-500">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
