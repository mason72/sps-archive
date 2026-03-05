import { EventCardSkeleton } from "@/components/ui/Skeleton";

/**
 * Root loading state — shows event card skeletons
 * matching the homepage dashboard layout.
 */
export default function HomeLoading() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav placeholder */}
      <header className="flex items-center justify-between px-8 md:px-16 py-6 border-b border-stone-100">
        <div className="h-5 w-32 bg-stone-100 animate-pulse" />
        <div className="flex gap-6">
          <div className="h-4 w-16 bg-stone-100 animate-pulse" />
          <div className="h-4 w-16 bg-stone-100 animate-pulse" />
        </div>
      </header>

      {/* Content skeleton */}
      <main className="flex-1 px-8 md:px-16 pt-16 pb-24">
        <div className="h-4 w-24 bg-stone-100 animate-pulse mb-4" />
        <div className="h-12 w-64 bg-stone-100 animate-pulse mb-16" />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <EventCardSkeleton key={i} />
          ))}
        </div>
      </main>
    </div>
  );
}
