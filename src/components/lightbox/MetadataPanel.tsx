"use client";

import { Eye, EyeOff } from "lucide-react";
import type { ImageData, ImageDetail } from "@/types/image";

interface MetadataPanelProps {
  image: ImageData;
  detail: ImageDetail | null;
  isLoading: boolean;
  isOpen: boolean;
}

/** Skeleton line for loading state */
function Skeleton({ width = "w-32" }: { width?: string }) {
  return <div className={`h-3 ${width} animate-pulse bg-stone-800`} />;
}

/** Thin horizontal score bar */
function ScoreBar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-[11px] text-stone-500">{label}</span>
      <div className="flex-1 h-1.5 bg-stone-800 overflow-hidden">
        <div
          className="h-full bg-accent transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-right text-[12px] tabular-nums text-stone-400">
        {pct}
      </span>
    </div>
  );
}

/**
 * MetadataPanel — Right sidebar showing full image metadata.
 * Slides in from the right. Sections only render when data exists.
 */
export function MetadataPanel({
  image,
  detail,
  isLoading,
  isOpen,
}: MetadataPanelProps) {
  if (!isOpen) return null;

  const hasExif = detail && (detail.cameraMake || detail.cameraModel || detail.lens);
  const hasCapture = detail?.takenAt;
  const hasQuality =
    image.aestheticScore != null || image.sharpnessScore != null;
  const hasTags = detail?.sceneTags && detail.sceneTags.length > 0;

  return (
    <div className="w-[360px] shrink-0 overflow-y-auto border-l border-stone-800 bg-stone-950 lightbox-panel-enter">
      <div className="p-6 space-y-6">
        {/* ── Details ── */}
        <section>
          <h3 className="text-[11px] font-medium uppercase tracking-[0.25em] text-stone-500 mb-3">
            Details
          </h3>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton width="w-40" />
              <Skeleton width="w-56" />
              <Skeleton width="w-24" />
            </div>
          ) : (
            <div className="space-y-1.5">
              {image.parsedName && (
                <p className="font-serif text-[18px] font-bold tracking-[-0.03em] text-stone-200 leading-tight">
                  {image.parsedName}
                </p>
              )}
              <p className="text-[13px] italic text-stone-400">
                {image.originalFilename}
              </p>
              {image.width && image.height && (
                <p className="text-[12px] text-stone-500">
                  {image.width} &times; {image.height}
                </p>
              )}
            </div>
          )}
        </section>

        <div className="h-px bg-stone-800" />

        {/* ── Camera ── */}
        {isLoading ? (
          <section>
            <h3 className="text-[11px] font-medium uppercase tracking-[0.25em] text-stone-500 mb-3">
              Camera
            </h3>
            <div className="space-y-2">
              <Skeleton width="w-36" />
              <Skeleton width="w-44" />
              <Skeleton width="w-32" />
            </div>
          </section>
        ) : hasExif ? (
          <section>
            <h3 className="text-[11px] font-medium uppercase tracking-[0.25em] text-stone-500 mb-3">
              Camera
            </h3>
            <div className="space-y-1.5">
              {(detail.cameraMake || detail.cameraModel) && (
                <p className="text-[13px] text-stone-300">
                  {[detail.cameraMake, detail.cameraModel]
                    .filter(Boolean)
                    .join(" ")}
                </p>
              )}
              {detail.lens && (
                <p className="text-[13px] text-stone-400">{detail.lens}</p>
              )}
              {(detail.aperture || detail.shutterSpeed || detail.iso) && (
                <p className="text-[12px] text-stone-500">
                  {[
                    detail.aperture ? `f/${detail.aperture}` : null,
                    detail.shutterSpeed,
                    detail.iso ? `ISO ${detail.iso}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
              {detail.focalLength && (
                <p className="text-[12px] text-stone-500">
                  {detail.focalLength}mm
                </p>
              )}
            </div>
          </section>
        ) : null}

        {hasExif && <div className="h-px bg-stone-800" />}

        {/* ── Captured ── */}
        {isLoading ? (
          <section>
            <h3 className="text-[11px] font-medium uppercase tracking-[0.25em] text-stone-500 mb-3">
              Captured
            </h3>
            <Skeleton width="w-48" />
          </section>
        ) : hasCapture ? (
          <section>
            <h3 className="text-[11px] font-medium uppercase tracking-[0.25em] text-stone-500 mb-3">
              Captured
            </h3>
            <p className="text-[13px] text-stone-300">
              {new Date(detail.takenAt!).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
              {" · "}
              {new Date(detail.takenAt!).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          </section>
        ) : null}

        {hasCapture && <div className="h-px bg-stone-800" />}

        {/* ── Quality ── */}
        {hasQuality && (
          <>
            <section>
              <h3 className="text-[11px] font-medium uppercase tracking-[0.25em] text-stone-500 mb-3">
                Quality
              </h3>
              <div className="space-y-3">
                {image.aestheticScore != null && (
                  <ScoreBar value={image.aestheticScore} label="Overall" />
                )}
                {image.sharpnessScore != null && (
                  <ScoreBar value={image.sharpnessScore} label="Sharp" />
                )}
                {detail?.isEyesOpen != null && (
                  <div className="flex items-center gap-2 text-[12px] text-stone-400 mt-2">
                    {detail.isEyesOpen ? (
                      <>
                        <Eye className="h-3.5 w-3.5 text-accent" />
                        <span>Eyes open</span>
                      </>
                    ) : (
                      <>
                        <EyeOff className="h-3.5 w-3.5 text-stone-500" />
                        <span>Eyes closed</span>
                      </>
                    )}
                  </div>
                )}
              </div>
            </section>
            <div className="h-px bg-stone-800" />
          </>
        )}

        {/* ── Scene Tags ── */}
        {isLoading ? (
          <section>
            <h3 className="text-[11px] font-medium uppercase tracking-[0.25em] text-stone-500 mb-3">
              Scene
            </h3>
            <div className="flex gap-2">
              <Skeleton width="w-16" />
              <Skeleton width="w-20" />
              <Skeleton width="w-14" />
            </div>
          </section>
        ) : hasTags ? (
          <section>
            <h3 className="text-[11px] font-medium uppercase tracking-[0.25em] text-stone-500 mb-3">
              Scene
            </h3>
            <div className="flex flex-wrap gap-2">
              {detail.sceneTags!.map((tag) => (
                <span
                  key={tag}
                  className="inline-block px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.15em] text-stone-400 border border-stone-700"
                >
                  {tag}
                </span>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
