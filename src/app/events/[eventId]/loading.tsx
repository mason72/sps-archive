import { ImageGridSkeleton } from "@/components/ui/Skeleton";

/**
 * Event detail page loading skeleton.
 * Matches the sidebar + main content layout.
 */
export default function EventDetailLoading() {
  return (
    <div className="flex min-h-screen">
      {/* ─── Sidebar skeleton ─── */}
      <aside className="hidden lg:flex w-64 flex-col border-r border-stone-100 px-6 py-8">
        {/* Back link */}
        <div className="h-3 w-16 bg-stone-100 animate-pulse mb-8" />
        {/* Event name */}
        <div className="h-6 w-40 bg-stone-100 animate-pulse mb-2" />
        {/* Meta line */}
        <div className="h-3 w-28 bg-stone-100 animate-pulse mb-8" />
        {/* Section items */}
        <div className="space-y-3 mt-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-4 bg-stone-100 animate-pulse" style={{ width: `${70 - i * 10}%` }} />
          ))}
        </div>
      </aside>

      {/* ─── Main content ─── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Nav placeholder */}
        <header className="flex items-center justify-between px-8 md:px-16 py-6 border-b border-stone-100">
          <div className="h-5 w-32 bg-stone-100 animate-pulse" />
          <div className="flex gap-4">
            <div className="h-4 w-16 bg-stone-100 animate-pulse" />
            <div className="h-4 w-16 bg-stone-100 animate-pulse" />
            <div className="h-8 w-20 bg-stone-100 animate-pulse rounded" />
          </div>
        </header>

        {/* Gallery area */}
        <main className="flex-1 px-8 md:px-16 pt-8 pb-24">
          {/* View controls */}
          <div className="flex items-center justify-between mb-8">
            <div className="h-4 w-32 bg-stone-100 animate-pulse" />
            <div className="flex gap-2">
              <div className="h-8 w-8 bg-stone-100 animate-pulse" />
              <div className="h-8 w-8 bg-stone-100 animate-pulse" />
            </div>
          </div>

          <ImageGridSkeleton count={12} />
        </main>
      </div>
    </div>
  );
}
