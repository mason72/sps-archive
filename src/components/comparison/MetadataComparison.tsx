"use client";

import { Eye, EyeOff, Camera, Clock, Aperture } from "lucide-react";
import type { ImageData, ImageDetail } from "@/types/image";
import { cn } from "@/lib/utils";

interface MetadataComparisonProps {
  leftImage: ImageData;
  rightImage: ImageData;
  leftDetail: ImageDetail | null;
  rightDetail: ImageDetail | null;
  isLoadingLeft: boolean;
  isLoadingRight: boolean;
}

/** Skeleton line for loading state */
function Skeleton({ width = "w-16" }: { width?: string }) {
  return <div className={`h-2.5 ${width} animate-pulse bg-stone-200`} />;
}

/** Compare two numeric values — higher is better, winner gets emerald */
function CompareScoreBar({
  leftValue,
  rightValue,
  label,
}: {
  leftValue: number | null;
  rightValue: number | null;
  label: string;
}) {
  const leftPct = leftValue != null ? Math.round(leftValue * 100) : null;
  const rightPct = rightValue != null ? Math.round(rightValue * 100) : null;
  const leftWins = leftPct != null && rightPct != null && leftPct > rightPct;
  const rightWins = rightPct != null && leftPct != null && rightPct > leftPct;

  return (
    <div className="flex items-center gap-3">
      {/* Left score */}
      <div className="flex-1 flex items-center gap-2 justify-end">
        {leftPct != null ? (
          <>
            <div className="w-16 h-1.5 bg-stone-200 overflow-hidden">
              <div
                className={cn(
                  "h-full transition-all duration-500 float-right",
                  leftWins ? "bg-emerald-500" : "bg-stone-400"
                )}
                style={{ width: `${leftPct}%` }}
              />
            </div>
            <span
              className={cn(
                "w-7 text-right text-[11px] tabular-nums",
                leftWins ? "text-emerald-600 font-medium" : "text-stone-400"
              )}
            >
              {leftPct}
            </span>
          </>
        ) : (
          <span className="text-[10px] text-stone-300">—</span>
        )}
      </div>

      {/* Label */}
      <span className="w-14 text-center text-[10px] uppercase tracking-[0.12em] text-stone-400 shrink-0">
        {label}
      </span>

      {/* Right score */}
      <div className="flex-1 flex items-center gap-2">
        {rightPct != null ? (
          <>
            <span
              className={cn(
                "w-7 text-left text-[11px] tabular-nums",
                rightWins ? "text-emerald-600 font-medium" : "text-stone-400"
              )}
            >
              {rightPct}
            </span>
            <div className="w-16 h-1.5 bg-stone-200 overflow-hidden">
              <div
                className={cn(
                  "h-full transition-all duration-500",
                  rightWins ? "bg-emerald-500" : "bg-stone-400"
                )}
                style={{ width: `${rightPct}%` }}
              />
            </div>
          </>
        ) : (
          <span className="text-[10px] text-stone-300">—</span>
        )}
      </div>
    </div>
  );
}

/** Compare a text value — display side by side */
function CompareText({
  left,
  right,
  label,
}: {
  left: string | null | undefined;
  right: string | null | undefined;
  label: string;
}) {
  if (!left && !right) return null;

  return (
    <div className="flex items-center gap-3">
      <span className="flex-1 text-right text-[11px] text-stone-500 truncate">
        {left || "—"}
      </span>
      <span className="w-14 text-center text-[10px] uppercase tracking-[0.12em] text-stone-400 shrink-0">
        {label}
      </span>
      <span className="flex-1 text-left text-[11px] text-stone-500 truncate">
        {right || "—"}
      </span>
    </div>
  );
}

/**
 * MetadataComparison — Bottom strip comparing camera settings and AI scores.
 * Highlights the "winner" in emerald for numeric scores.
 */
export function MetadataComparison({
  leftImage,
  rightImage,
  leftDetail,
  rightDetail,
  isLoadingLeft,
  isLoadingRight,
}: MetadataComparisonProps) {
  const isLoading = isLoadingLeft || isLoadingRight;

  if (isLoading) {
    return (
      <div className="border-t border-stone-200 bg-white px-8 py-4">
        <div className="flex items-center justify-center gap-6">
          <Skeleton width="w-20" />
          <Skeleton width="w-12" />
          <Skeleton width="w-20" />
        </div>
      </div>
    );
  }

  const leftExposure = leftDetail
    ? [
        leftDetail.aperture ? `f/${leftDetail.aperture}` : null,
        leftDetail.shutterSpeed,
        leftDetail.iso ? `ISO ${leftDetail.iso}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  const rightExposure = rightDetail
    ? [
        rightDetail.aperture ? `f/${rightDetail.aperture}` : null,
        rightDetail.shutterSpeed,
        rightDetail.iso ? `ISO ${rightDetail.iso}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  const leftCamera = leftDetail
    ? [leftDetail.cameraMake, leftDetail.cameraModel].filter(Boolean).join(" ")
    : null;
  const rightCamera = rightDetail
    ? [rightDetail.cameraMake, rightDetail.cameraModel].filter(Boolean).join(" ")
    : null;

  return (
    <div className="border-t border-stone-200 bg-white px-8 py-4">
      <div className="max-w-2xl mx-auto space-y-2.5">
        {/* Quality scores */}
        <CompareScoreBar
          leftValue={leftImage.aestheticScore}
          rightValue={rightImage.aestheticScore}
          label="Overall"
        />
        <CompareScoreBar
          leftValue={leftImage.sharpnessScore}
          rightValue={rightImage.sharpnessScore}
          label="Sharp"
        />

        {/* Eyes open */}
        {(leftDetail?.isEyesOpen != null || rightDetail?.isEyesOpen != null) && (
          <div className="flex items-center gap-3">
            <div className="flex-1 flex items-center gap-1.5 justify-end">
              {leftDetail?.isEyesOpen != null && (
                <div className="flex items-center gap-1 text-[11px]">
                  {leftDetail.isEyesOpen ? (
                    <>
                      <Eye className="h-3 w-3 text-emerald-500" />
                      <span className="text-stone-500">Open</span>
                    </>
                  ) : (
                    <>
                      <EyeOff className="h-3 w-3 text-stone-400" />
                      <span className="text-stone-400">Closed</span>
                    </>
                  )}
                </div>
              )}
            </div>
            <span className="w-14 text-center text-[10px] uppercase tracking-[0.12em] text-stone-400 shrink-0">
              Eyes
            </span>
            <div className="flex-1 flex items-center gap-1.5">
              {rightDetail?.isEyesOpen != null && (
                <div className="flex items-center gap-1 text-[11px]">
                  {rightDetail.isEyesOpen ? (
                    <>
                      <Eye className="h-3 w-3 text-emerald-500" />
                      <span className="text-stone-500">Open</span>
                    </>
                  ) : (
                    <>
                      <EyeOff className="h-3 w-3 text-stone-400" />
                      <span className="text-stone-400">Closed</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Divider */}
        {(leftCamera || rightCamera || leftExposure || rightExposure) && (
          <div className="h-px bg-stone-100 my-1" />
        )}

        {/* Camera info */}
        <CompareText left={leftCamera} right={rightCamera} label="Camera" />
        <CompareText left={leftExposure} right={rightExposure} label="Exposure" />
        <CompareText
          left={leftDetail?.focalLength ? `${leftDetail.focalLength}mm` : null}
          right={rightDetail?.focalLength ? `${rightDetail.focalLength}mm` : null}
          label="Focal"
        />
        <CompareText left={leftDetail?.lens} right={rightDetail?.lens} label="Lens" />
      </div>
    </div>
  );
}
