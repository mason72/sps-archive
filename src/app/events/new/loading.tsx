/**
 * New event page loading skeleton.
 * Matches the form layout with headline + input fields.
 */
export default function NewEventLoading() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav placeholder */}
      <header className="flex items-center justify-between px-8 md:px-16 py-6 border-b border-stone-100">
        <div className="h-5 w-32 bg-stone-100 animate-pulse" />
        <div className="flex gap-6">
          <div className="h-4 w-16 bg-stone-100 animate-pulse" />
          <div className="h-4 w-20 bg-stone-100 animate-pulse" />
        </div>
      </header>

      <main className="px-8 md:px-16 pt-16 pb-24 max-w-2xl">
        {/* Label */}
        <div className="h-3 w-20 bg-stone-100 animate-pulse mb-4" />
        {/* Headline */}
        <div className="h-12 w-72 bg-stone-100 animate-pulse mb-4" />
        {/* Subtitle */}
        <div className="h-4 w-80 bg-stone-100 animate-pulse mb-16" />

        {/* Form fields */}
        <div className="space-y-12">
          {/* Event name */}
          <div>
            <div className="h-3 w-24 bg-stone-100 animate-pulse mb-3" />
            <div className="h-12 w-full border-b border-stone-100" />
          </div>

          {/* Event type pills */}
          <div>
            <div className="h-3 w-20 bg-stone-100 animate-pulse mb-4" />
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="h-9 bg-stone-100 animate-pulse" style={{ width: `${60 + (i % 3) * 20}px` }} />
              ))}
            </div>
          </div>

          {/* Date */}
          <div>
            <div className="h-3 w-12 bg-stone-100 animate-pulse mb-3" />
            <div className="h-10 w-48 bg-stone-100 animate-pulse" />
          </div>

          {/* Submit button */}
          <div className="h-12 w-72 bg-stone-100 animate-pulse rounded" />
        </div>
      </main>
    </div>
  );
}
