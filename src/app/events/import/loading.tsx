/**
 * Import screen skeleton — headline plus the event list's rows, since the list
 * is what the first paint resolves to.
 */
export default function ImportLoading() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-8 md:px-16 py-6 border-b border-stone-100">
        <div className="h-5 w-32 bg-stone-100 animate-pulse" />
        <div className="flex gap-6">
          <div className="h-4 w-16 bg-stone-100 animate-pulse" />
          <div className="h-4 w-14 bg-stone-100 animate-pulse" />
        </div>
      </header>

      <main className="px-8 md:px-16 pt-12 pb-24 max-w-6xl w-full">
        <div className="h-3 w-24 bg-stone-100 animate-pulse mb-4" />
        <div className="h-12 w-96 max-w-full bg-stone-100 animate-pulse mb-4" />
        <div className="h-4 w-72 bg-stone-100 animate-pulse mb-12" />

        <div className="border-t border-b border-stone-100 divide-y divide-stone-100">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="py-5 flex items-center justify-between gap-6">
              <div className="min-w-0 flex-1">
                <div
                  className="h-4 bg-stone-100 animate-pulse mb-2"
                  style={{ width: `${45 + (i % 3) * 15}%` }}
                />
                <div className="h-3 w-40 bg-stone-100 animate-pulse" />
              </div>
              <div className="h-9 w-36 bg-stone-100 animate-pulse shrink-0" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
