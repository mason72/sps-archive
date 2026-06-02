import { Nav } from "@/components/layout/Nav";
import {
  ImageGridSkeleton,
  EventSidebarSkeleton,
  Skeleton,
} from "@/components/ui/Skeleton";

/**
 * Route-level loading fallback for the event editor.
 *
 * Mirrors the client page's own loading state (page.tsx) exactly — real Nav,
 * sidebar placeholder at the real 320px width, a shimmer where the event name
 * goes (never the fake word "Event"), and a grid skeleton — so the handoff from
 * this server fallback to the hydrated page has no visible flicker or shift.
 */
export default function EventDetailLoading() {
  return (
    <div className="flex min-h-screen">
      <EventSidebarSkeleton />

      <div className="flex-1 flex flex-col min-w-0">
        <Nav>
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-9 w-24 rounded-full" />
        </Nav>

        <main className="px-8 md:px-16 pt-12 pb-24">
          <div className="mb-12">
            <Skeleton className="h-3 w-28 mb-4" />
            <Skeleton className="h-[clamp(36px,5vw,64px)] w-[min(420px,70%)]" />
          </div>
          <ImageGridSkeleton count={12} />
        </main>
      </div>
    </div>
  );
}
