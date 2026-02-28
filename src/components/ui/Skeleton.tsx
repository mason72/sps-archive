"use client";

/**
 * Shimmer skeleton loader.
 * Uses stone palette with subtle animation.
 */

interface SkeletonProps {
  className?: string;
  style?: React.CSSProperties;
}

export function Skeleton({ className = "", style }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse bg-stone-200 ${className}`}
      style={style}
    />
  );
}

/**
 * Pre-composed skeleton layouts for common patterns.
 */

const MASONRY_RATIOS = ["3 / 4", "4 / 3", "1 / 1", "16 / 9"];

export function EventCardSkeleton() {
  return (
    <div className="group border border-stone-200 p-6">
      <Skeleton className="h-6 w-3/4 mb-4" />
      <div className="flex items-center gap-4 mt-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-16" />
      </div>
      <Skeleton className="h-3 w-20 mt-4" />
    </div>
  );
}

export function ImageGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="columns-2 sm:columns-3 lg:columns-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="break-inside-avoid mb-4">
          <Skeleton
            className="w-full"
            style={{ aspectRatio: MASONRY_RATIOS[i % 4] }}
          />
        </div>
      ))}
    </div>
  );
}

export function SettingsPanelSkeleton() {
  return (
    <div className="space-y-8">
      {/* Section divider skeleton */}
      <Skeleton className="h-px w-full" />

      {/* Form fields */}
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i}>
          <Skeleton className="h-3 w-24 mb-2" />
          <Skeleton className="h-8 w-full" />
        </div>
      ))}

      {/* Second section divider */}
      <Skeleton className="h-px w-full mt-10" />

      {/* More form fields */}
      <div>
        <Skeleton className="h-3 w-20 mb-2" />
        <Skeleton className="h-8 w-full" />
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div>
          <Skeleton className="h-3 w-16 mb-2" />
          <Skeleton className="h-8 w-full" />
        </div>
        <div>
          <Skeleton className="h-3 w-20 mb-2" />
          <Skeleton className="h-8 w-full" />
        </div>
      </div>
    </div>
  );
}

export function ActivityPanelSkeleton() {
  return (
    <div className="p-4 space-y-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3">
          <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
