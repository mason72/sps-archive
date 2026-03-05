/**
 * Search page loading skeleton.
 * Matches the editorial search layout with headline + search bar.
 */
export default function SearchLoading() {
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

      <main className="px-8 md:px-16 pt-16 pb-24">
        <div className="max-w-4xl">
          {/* Label */}
          <div className="h-3 w-24 bg-stone-100 animate-pulse mb-4" />
          {/* Headline */}
          <div className="h-12 w-80 bg-stone-100 animate-pulse mb-8" />
          {/* Subtitle */}
          <div className="h-4 w-64 bg-stone-100 animate-pulse mb-12" />
          {/* Search bar */}
          <div className="h-12 w-full bg-stone-100 animate-pulse rounded" />
        </div>
      </main>
    </div>
  );
}
