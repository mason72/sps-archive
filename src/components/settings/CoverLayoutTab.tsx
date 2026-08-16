"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, ImageIcon, Shuffle, Plus, X, ScanFace } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type {
  CoverSettings,
  CoverType,
  FocalPoint,
  MosaicLogoMode,
  TitlePosition,
  TitleAlignment,
} from "@/types/event-settings";
import {
  DEFAULT_MOSAIC_SETTINGS,
  DEFAULT_SOLID_SETTINGS,
  DEFAULT_CROSSFADE_SETTINGS,
} from "@/types/event-settings";

interface SectionOption {
  id: string;
  name: string;
  imageCount: number;
}

interface CoverLayoutTabProps {
  /** Normalized cover settings (pass through normalizeCoverSettings first). */
  cover: CoverSettings;
  /** Partial merge into the cover object; parent persists. */
  onChange: (partial: Partial<CoverSettings>) => void;
  /** Resolved preview URL for the current cover imageId. */
  coverImageUrl?: string;
  /**
   * The cover image's own subject anchor (face-derived or picked in the
   * grid), 0–1 — where the crop actually sits while no manual pin is set.
   */
  autoFocal?: FocalPoint;
  sections?: SectionOption[];
  eventId?: string;
  onUploadComplete?: () => void;
}

export function CoverLayoutTab({
  cover,
  onChange,
  coverImageUrl,
  autoFocal,
  sections,
  eventId,
  onUploadComplete,
}: CoverLayoutTabProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedPreviewUrl, setUploadedPreviewUrl] = useState<string | null>(null);

  const type = cover.type;
  const mosaic = cover.mosaic ?? DEFAULT_MOSAIC_SETTINGS;
  const solid = cover.solid ?? DEFAULT_SOLID_SETTINGS;
  const crossfade = cover.crossfade ?? DEFAULT_CROSSFADE_SETTINGS;
  const resolvedCoverUrl = coverImageUrl || uploadedPreviewUrl || undefined;

  const activeLogoKey =
    type === "mosaic" && mosaic.logoMode !== "none"
      ? mosaic.logoKey
      : type === "solid"
        ? solid.logoKey
        : undefined;

  const handleCoverUpload = async (file: File) => {
    if (!eventId) return;
    if (file.size > 20 * 1024 * 1024) {
      toast.error("File too large. Maximum 20MB.");
      return;
    }
    setIsUploading(true);
    try {
      const metaRes = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          files: [{ name: file.name, type: file.type, size: file.size }],
          // Cover-only: don't add this image to a section / the gallery grid.
          skipSection: true,
        }),
      });
      if (!metaRes.ok) throw new Error("Failed to create upload");
      const { uploads } = await metaRes.json();
      const { imageId, uploadUrl } = uploads[0];

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadRes.ok) throw new Error("Failed to upload file");

      await fetch("/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId }),
      });

      const previewUrl = URL.createObjectURL(file);
      setUploadedPreviewUrl(previewUrl);
      onChange({ imageId });
      toast.success("Cover image uploaded");

      setTimeout(() => {
        onUploadComplete?.();
      }, 3000);
    } catch {
      toast.error("Failed to upload cover image");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div>
      <h3 className="text-[15px] font-medium text-stone-900 mb-1">Cover</h3>
      <p className="text-[12px] text-stone-400 mb-5">
        Add a hero to the top of your gallery.
      </p>

      {/* ─── Enable toggle ─── */}
      <label className="flex items-center justify-between mb-6 cursor-pointer group">
        <span className="text-[13px] font-medium text-stone-700 group-hover:text-stone-900 transition-colors">
          Use cover
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={cover.enabled}
          onClick={() => onChange({ enabled: !cover.enabled })}
          className={cn(
            "relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 cursor-pointer",
            cover.enabled ? "bg-stone-900" : "bg-stone-300"
          )}
        >
          <span
            className={cn(
              "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform duration-200",
              cover.enabled ? "translate-x-[18px]" : "translate-x-[3px]"
            )}
          />
        </button>
      </label>

      {cover.enabled && (
        <div className="space-y-6 animate-in fade-in slide-in-from-top-1 duration-200">
          {/* ─── Cover type ─── */}
          <Seg<CoverType>
            label="Cover type"
            value={type}
            onChange={(t) => onChange({ type: t })}
            options={[
              { value: "image", label: "Photo" },
              { value: "mosaic", label: "Mosaic" },
              { value: "solid", label: "Color" },
              { value: "crossfade", label: "Fade" },
            ]}
          />

          {/* ─── Photo ─── */}
          {type === "image" && (
            <div>
              <p className="text-[12px] font-medium text-stone-600 mb-2">Cover image</p>
              {resolvedCoverUrl ? (
                <FocalPicker
                  imageUrl={resolvedCoverUrl}
                  focalPoint={cover.focalPoint}
                  autoFocal={autoFocal}
                  onChange={(focalPoint) => onChange({ focalPoint })}
                  isUploading={isUploading}
                  onReplace={handleCoverUpload}
                />
              ) : (
                <label className="flex flex-col items-center justify-center gap-2 py-8 border-2 border-dashed border-stone-200 hover:border-stone-400 cursor-pointer transition-colors">
                  <ImageIcon size={24} className="text-stone-300" />
                  <span className="text-[12px] text-stone-400">
                    {isUploading ? "Uploading…" : "Click to upload a cover image"}
                  </span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    disabled={isUploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleCoverUpload(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}

              {/* Fit mode: photos crop to fill; logos/icons must never crop
                  (Justin, 2026-08-10). Contain ignores the focal pin. */}
              {resolvedCoverUrl && (
                <div className="mt-4 space-y-4">
                  <Seg<"cover" | "contain">
                    label="Image fit"
                    value={cover.image?.fit ?? "cover"}
                    onChange={(fit) =>
                      onChange({
                        image: { padding: 10, ...cover.image, fit },
                      })
                    }
                    options={[
                      { value: "cover", label: "Fill (crop)" },
                      { value: "contain", label: "Fit whole image" },
                    ]}
                  />
                  {cover.image?.fit === "contain" && (
                    <SliderRow
                      label="Space around image"
                      valueLabel={`${cover.image?.padding ?? 10}%`}
                      min={0}
                      max={40}
                      step={1}
                      value={cover.image?.padding ?? 10}
                      onChange={(padding) =>
                        onChange({
                          image: { fit: "contain", padding },
                        })
                      }
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {/* ─── Mosaic ─── */}
          {type === "mosaic" && (
            <>
              <SectionSelect
                label="Photos from"
                sections={sections}
                value={mosaic.sectionId}
                onChange={(sectionId) => onChange({ mosaic: { ...mosaic, sectionId } })}
              />
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <Seg<"2" | "3" | "4">
                    label="Density"
                    value={String(mosaic.rows) as "2" | "3" | "4"}
                    onChange={(r) =>
                      onChange({ mosaic: { ...mosaic, rows: Number(r) as 2 | 3 | 4 } })
                    }
                    options={[
                      { value: "2", label: "2 rows" },
                      { value: "3", label: "3 rows" },
                      { value: "4", label: "4 rows" },
                    ]}
                  />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      mosaic: { ...mosaic, seed: Math.floor(Math.random() * 1e9) },
                    })
                  }
                  className="flex items-center gap-1.5 px-3 py-[7px] text-[11px] font-medium text-stone-600 bg-stone-100 rounded hover:bg-stone-200 hover:text-stone-900 transition-colors cursor-pointer"
                  title="Re-arrange the tiles"
                >
                  <Shuffle size={12} />
                  Shuffle
                </button>
              </div>

              <Seg<MosaicLogoMode>
                label="Logo"
                value={mosaic.logoMode}
                onChange={(logoMode) => onChange({ mosaic: { ...mosaic, logoMode } })}
                options={[
                  { value: "none", label: "None" },
                  { value: "overlay", label: "Overlay" },
                  { value: "insert", label: "Insert" },
                ]}
              />

              {mosaic.logoMode !== "none" && (
                <LogoUploader
                  eventId={eventId}
                  logoKey={mosaic.logoKey}
                  onUploaded={(logoKey) => onChange({ mosaic: { ...mosaic, logoKey } })}
                />
              )}

              {mosaic.logoMode === "overlay" && (
                <div className="space-y-4">
                  <div>
                    <p className="text-[12px] font-medium text-stone-600 mb-2">
                      Overlay color
                    </p>
                    <div className="space-y-2">
                      {mosaic.overlay.colors.map((c, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <ColorRow
                            value={c}
                            onChange={(next) => {
                              const colors = mosaic.overlay.colors.slice();
                              colors[i] = next;
                              onChange({
                                mosaic: {
                                  ...mosaic,
                                  overlay: { ...mosaic.overlay, colors },
                                },
                              });
                            }}
                          />
                          {mosaic.overlay.colors.length > 1 && (
                            <button
                              type="button"
                              onClick={() =>
                                onChange({
                                  mosaic: {
                                    ...mosaic,
                                    overlay: {
                                      ...mosaic.overlay,
                                      colors: mosaic.overlay.colors.filter(
                                        (_, j) => j !== i
                                      ),
                                    },
                                  },
                                })
                              }
                              className="p-1 text-stone-300 hover:text-stone-600 transition-colors cursor-pointer"
                              aria-label="Remove color"
                            >
                              <X size={13} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    {mosaic.overlay.colors.length < 5 && (
                      <button
                        type="button"
                        onClick={() =>
                          onChange({
                            mosaic: {
                              ...mosaic,
                              overlay: {
                                ...mosaic.overlay,
                                colors: [
                                  ...mosaic.overlay.colors,
                                  mosaic.overlay.colors[
                                    mosaic.overlay.colors.length - 1
                                  ],
                                ],
                              },
                            },
                          })
                        }
                        className="mt-2 flex items-center gap-1 text-[11px] font-medium text-stone-500 hover:text-stone-900 transition-colors cursor-pointer"
                      >
                        <Plus size={12} />
                        Add color
                        {mosaic.overlay.colors.length === 1 ? " for a gradient" : ""}
                      </button>
                    )}
                  </div>

                  {mosaic.overlay.colors.length > 1 && (
                    <SliderRow
                      label="Gradient angle"
                      valueLabel={`${mosaic.overlay.angle}°`}
                      min={0}
                      max={360}
                      step={15}
                      value={mosaic.overlay.angle}
                      onChange={(angle) =>
                        onChange({
                          mosaic: {
                            ...mosaic,
                            overlay: { ...mosaic.overlay, angle },
                          },
                        })
                      }
                    />
                  )}

                  <SliderRow
                    label="Overlay strength"
                    valueLabel={`${Math.round(mosaic.overlay.opacity * 100)}%`}
                    min={20}
                    max={100}
                    step={5}
                    value={Math.round(mosaic.overlay.opacity * 100)}
                    onChange={(v) =>
                      onChange({
                        mosaic: {
                          ...mosaic,
                          overlay: { ...mosaic.overlay, opacity: v / 100 },
                        },
                      })
                    }
                  />
                  <MiniToggle
                    label="Blur photos behind the color"
                    checked={mosaic.overlay.blur}
                    onChange={(blur) =>
                      onChange({
                        mosaic: { ...mosaic, overlay: { ...mosaic.overlay, blur } },
                      })
                    }
                  />
                  {mosaic.overlay.blur && (
                    <SliderRow
                      label="Blur amount"
                      valueLabel={`${mosaic.overlay.blurAmount}px`}
                      min={1}
                      max={40}
                      step={1}
                      value={mosaic.overlay.blurAmount}
                      onChange={(blurAmount) =>
                        onChange({
                          mosaic: {
                            ...mosaic,
                            overlay: { ...mosaic.overlay, blurAmount },
                          },
                        })
                      }
                    />
                  )}
                </div>
              )}

              {mosaic.logoMode === "insert" && (
                <div className="space-y-4">
                  <SliderRow
                    label="Space around logo"
                    valueLabel={`${mosaic.insert.padding}%`}
                    min={0}
                    max={45}
                    step={5}
                    value={mosaic.insert.padding}
                    onChange={(padding) =>
                      onChange({
                        mosaic: { ...mosaic, insert: { ...mosaic.insert, padding } },
                      })
                    }
                  />
                </div>
              )}

              {/**
               * Fill is a MOSAIC property, not a logo property.
               *
               * It paints the gaps between tiles as well as the logo panel, so
               * it applies whether or not there is an insert — and it therefore
               * cannot live inside the insert-only block, where two of the three
               * logo modes could never reach it.
               *
               * Safe to widen: the default is #FFFFFF, which is exactly the
               * gutter colour every existing mosaic already renders, so nothing
               * that was never configured changes appearance.
               */}
              <div className="space-y-1">
                <ColorRow
                  label="Fill color"
                  value={mosaic.insert.fill}
                  onChange={(fill) =>
                    onChange({
                      mosaic: { ...mosaic, insert: { ...mosaic.insert, fill } },
                    })
                  }
                />
                <p className="text-[12px] text-stone-400">
                  Shows in the gaps between photos
                  {mosaic.logoMode === "insert" ? " and behind the logo" : ""}.
                </p>
              </div>
            </>
          )}

          {/* ─── Solid color / gradient ─── */}
          {type === "solid" && (
            <>
              {/* Live swatch preview */}
              <div
                className="w-full aspect-[16/6] border border-stone-200 flex items-center justify-center"
                style={{
                  background:
                    solid.colors.length > 1
                      ? `linear-gradient(${solid.angle}deg, ${solid.colors.join(", ")})`
                      : solid.colors[0],
                }}
              >
                <LogoPreview eventId={eventId} logoKey={solid.logoKey} padding={solid.padding} />
              </div>

              <div>
                <p className="text-[12px] font-medium text-stone-600 mb-2">Colors</p>
                <div className="space-y-2">
                  {solid.colors.map((c, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <ColorRow
                        value={c}
                        onChange={(next) => {
                          const colors = solid.colors.slice();
                          colors[i] = next;
                          onChange({ solid: { ...solid, colors } });
                        }}
                      />
                      {solid.colors.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            onChange({
                              solid: {
                                ...solid,
                                colors: solid.colors.filter((_, j) => j !== i),
                              },
                            })
                          }
                          className="p-1 text-stone-300 hover:text-stone-600 transition-colors cursor-pointer"
                          aria-label="Remove color"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {solid.colors.length < 5 && (
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        solid: {
                          ...solid,
                          colors: [...solid.colors, solid.colors[solid.colors.length - 1]],
                        },
                      })
                    }
                    className="mt-2 flex items-center gap-1 text-[11px] font-medium text-stone-500 hover:text-stone-900 transition-colors cursor-pointer"
                  >
                    <Plus size={12} />
                    Add color{solid.colors.length === 1 ? " for a gradient" : ""}
                  </button>
                )}
              </div>

              {solid.colors.length > 1 && (
                <SliderRow
                  label="Gradient angle"
                  valueLabel={`${solid.angle}°`}
                  min={0}
                  max={360}
                  step={15}
                  value={solid.angle}
                  onChange={(angle) => onChange({ solid: { ...solid, angle } })}
                />
              )}

              <LogoUploader
                eventId={eventId}
                logoKey={solid.logoKey}
                onUploaded={(logoKey) => onChange({ solid: { ...solid, logoKey } })}
              />

              <SliderRow
                label="Space around logo"
                valueLabel={`${solid.padding}%`}
                min={0}
                max={45}
                step={5}
                value={solid.padding}
                onChange={(padding) => onChange({ solid: { ...solid, padding } })}
              />
            </>
          )}

          {/* ─── Crossfade ─── */}
          {type === "crossfade" && (
            <>
              <SectionSelect
                label="Photos from"
                sections={sections}
                value={crossfade.sectionId}
                onChange={(sectionId) =>
                  onChange({ crossfade: { ...crossfade, sectionId } })
                }
              />
              <SliderRow
                label="Photos in rotation"
                valueLabel={String(crossfade.count)}
                min={2}
                max={10}
                step={1}
                value={crossfade.count}
                onChange={(count) => onChange({ crossfade: { ...crossfade, count } })}
              />
              <SliderRow
                label="Seconds per photo"
                valueLabel={`${Math.round(crossfade.intervalMs / 1000)}s`}
                min={3}
                max={15}
                step={1}
                value={Math.round(crossfade.intervalMs / 1000)}
                onChange={(s) =>
                  onChange({ crossfade: { ...crossfade, intervalMs: s * 1000 } })
                }
              />
            </>
          )}

          {/* ─── Title ─── */}
          <div className="pt-2 border-t border-stone-100 space-y-6">
            {activeLogoKey && (
              <MiniToggle
                label="Show event title too"
                // Unset = auto: the client logo replaces the title.
                checked={cover.hideTitle === undefined ? false : !cover.hideTitle}
                onChange={(show) => onChange({ hideTitle: !show })}
              />
            )}

            {!(activeLogoKey && (cover.hideTitle ?? true)) && (
              <>
                <Seg<TitlePosition>
                  label="Title position"
                  value={cover.titlePosition}
                  onChange={(titlePosition) => onChange({ titlePosition })}
                  options={[
                    { value: "above", label: "Above" },
                    { value: "over", label: "On Cover" },
                    { value: "below", label: "Below" },
                  ]}
                />

                {(cover.titlePosition === "above" || cover.titlePosition === "below") && (
                  <Seg<TitleAlignment>
                    label="Title alignment"
                    value={cover.titleAlignment}
                    onChange={(titleAlignment) => onChange({ titleAlignment })}
                    options={[
                      { value: "left", label: "Left" },
                      { value: "center", label: "Center" },
                      { value: "right", label: "Right" },
                    ]}
                  />
                )}

                {cover.titlePosition === "over" && (
                  <div>
                    <p className="text-[12px] font-medium text-stone-600 mb-2">
                      Title placement
                    </p>
                    <div className="grid grid-cols-3 gap-1 p-2 bg-stone-100 rounded aspect-[16/9]">
                      {(["top", "center", "bottom"] as const).map((v) =>
                        (["left", "center", "right"] as const).map((h) => {
                          const isSelected =
                            (cover.titlePlacement?.vertical || "center") === v &&
                            (cover.titlePlacement?.horizontal || "center") === h;
                          return (
                            <button
                              key={`${v}-${h}`}
                              onClick={() =>
                                onChange({
                                  titlePlacement: { vertical: v, horizontal: h },
                                })
                              }
                              className={cn(
                                "flex items-center justify-center rounded transition-all duration-150 cursor-pointer",
                                isSelected
                                  ? "bg-stone-900"
                                  : "bg-stone-200/60 hover:bg-stone-300/80"
                              )}
                            >
                              <div
                                className={cn(
                                  "w-2 h-2 rounded-full transition-colors",
                                  isSelected ? "bg-white" : "bg-stone-400"
                                )}
                              />
                            </button>
                          );
                        })
                      )}
                    </div>
                    <p className="text-[10px] text-stone-400 mt-1.5 text-center">
                      Choose where the title appears on the cover
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Focal point picker ─── */

/**
 * The cover preview doubles as the crop-focus control: drag (or click) to
 * pin the part of the photo that must survive every crop — hero band, OG
 * card, email. Replace moved to a corner chip so the surface stays a canvas.
 *
 * Three legible states: a manual pin (white, "Manual" chip + reset), the
 * image's face-derived anchor doing the work (emerald pin, "Auto · face"),
 * or the plain center default. The pin always sits where the crop actually
 * anchors, so the preview never lies about what ships.
 */
function FocalPicker({
  imageUrl,
  focalPoint,
  autoFocal,
  onChange,
  isUploading,
  onReplace,
}: {
  imageUrl: string;
  focalPoint?: FocalPoint;
  autoFocal?: FocalPoint;
  onChange: (fp: FocalPoint | undefined) => void;
  isUploading: boolean;
  onReplace: (file: File) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const isManual = !!focalPoint;
  const isAuto = !isManual && !!autoFocal;
  const fp = focalPoint ?? autoFocal ?? { x: 0.5, y: 0.5 };

  const setFromPointer = (clientX: number, clientY: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    onChange({
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    });
  };

  return (
    <div>
      <div
        ref={ref}
        className="relative select-none touch-none cursor-crosshair"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
          setFromPointer(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (dragging) setFromPointer(e.clientX, e.clientY);
        }}
        onPointerUp={() => setDragging(false)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="Cover"
          draggable={false}
          className="w-full aspect-[16/9] object-cover bg-stone-100 border border-stone-200"
          style={{ objectPosition: `${fp.x * 100}% ${fp.y * 100}%` }}
        />
        {/* Focal pin — emerald while the face anchor is steering */}
        <div
          className={cn(
            "absolute w-5 h-5 -ml-2.5 -mt-2.5 rounded-full border-2 pointer-events-none",
            isAuto
              ? "border-emerald-400 shadow-[0_0_0_1.5px_rgba(0,0,0,0.35)]"
              : "border-white shadow-[0_0_0_1.5px_rgba(0,0,0,0.4)]"
          )}
          style={{ left: `${fp.x * 100}%`, top: `${fp.y * 100}%` }}
        >
          <div
            className={cn(
              "absolute inset-[3px] rounded-full",
              isAuto ? "bg-emerald-400/50" : "bg-white/40"
            )}
          />
        </div>

        {/* State chip */}
        {isAuto && (
          <span className="absolute bottom-2 left-2 flex items-center gap-1 px-2 py-1 bg-emerald-600/85 text-white text-[10px] font-medium rounded pointer-events-none">
            <ScanFace size={10} />
            Auto · face
          </span>
        )}
        {isManual && (
          <span
            className="absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-1 bg-black/55 text-white text-[10px] font-medium rounded"
            onPointerDown={(e) => e.stopPropagation()}
          >
            Manual
            <button
              type="button"
              onClick={() => onChange(undefined)}
              className="underline decoration-white/40 underline-offset-2 hover:decoration-white cursor-pointer"
              title={autoFocal ? "Back to the detected face" : "Back to center"}
            >
              {autoFocal ? "Reset to face" : "Reset"}
            </button>
          </span>
        )}

        {/* Replace chip */}
        <label
          className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 bg-black/55 hover:bg-black/75 text-white text-[10px] font-medium rounded cursor-pointer transition-colors"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Upload size={10} />
          {isUploading ? "Uploading…" : "Replace"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            disabled={isUploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onReplace(file);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <p className="text-[10px] text-stone-400 mt-1.5 text-center">
        {isManual
          ? "Pinned by hand — every crop follows your pin"
          : isAuto
            ? "Following the detected face — drag to override"
            : "Drag the pin to what must stay in frame — the crop follows it everywhere"}
      </p>
    </div>
  );
}

/* ─── Client logo uploader (mosaic / solid) ─── */

function LogoUploader({
  eventId,
  logoKey,
  onUploaded,
}: {
  eventId?: string;
  logoKey?: string;
  onUploaded: (logoKey: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const savedUrl = useSavedLogoUrl(eventId, logoKey, localUrl != null);
  const preview = localUrl ?? savedUrl;

  const upload = async (file: File) => {
    if (!eventId) return;
    setBusy(true);
    try {
      /**
       * READ THE BYTES FIRST — same doctrine as the photo uploader
       * (2026-08-16). A dropped/picked file can be an unreadable handle
       * (Dropbox/iCloud online-only placeholder, or a stale reference), and
       * PUTting the raw File then fails as Safari's bare "Load failed" toast
       * with nothing actionable in it — Mason burned several files against
       * this exact wall. Reading up front pins the bytes, forces macOS to
       * materialize a cloud file, and turns "unreadable" into its own
       * sentence. A logo is ≤5 MB, so memory is a non-issue.
       */
      let bytes: ArrayBuffer;
      try {
        bytes = await file.arrayBuffer();
      } catch {
        throw new Error(
          "Couldn't read that file — if it lives in Dropbox or iCloud, download it first, then pick it again"
        );
      }
      const res = await fetch(`/api/events/${eventId}/cover-logo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileType: file.type, fileSize: file.size }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: null }));
        throw new Error(error || "Failed to prepare upload");
      }
      const { uploadUrl, logoKey: key } = await res.json();
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: new Blob([bytes], { type: file.type }),
      });
      if (!put.ok) throw new Error("Failed to upload logo");
      setLocalUrl(URL.createObjectURL(file));
      onUploaded(key);
      toast.success("Logo uploaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to upload logo");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="text-[12px] font-medium text-stone-600 mb-2">Client logo</p>
      <label
        className={cn(
          "flex items-center justify-center gap-2 border-2 border-dashed border-stone-200 hover:border-stone-400 cursor-pointer transition-colors",
          preview ? "py-3 px-4" : "py-6"
        )}
      >
        {preview ? (
          <>
            {/* Checkerboard so white/transparent logos stay visible */}
            <span
              className="inline-flex items-center justify-center px-3 py-2 rounded"
              style={{
                backgroundImage:
                  "linear-gradient(45deg, #e7e5e4 25%, transparent 25%, transparent 75%, #e7e5e4 75%), linear-gradient(45deg, #e7e5e4 25%, transparent 25%, transparent 75%, #e7e5e4 75%)",
                backgroundSize: "12px 12px",
                backgroundPosition: "0 0, 6px 6px",
                backgroundColor: "#f5f5f4",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="Logo" className="h-9 max-w-[160px] object-contain" />
            </span>
            <span className="text-[11px] text-stone-400">
              {busy ? "Uploading…" : "Click to replace"}
            </span>
          </>
        ) : (
          <span className="text-[12px] text-stone-400 flex items-center gap-2">
            <Upload size={14} className="text-stone-300" />
            {busy ? "Uploading…" : "Upload logo (PNG with transparency works best)"}
          </span>
        )}
        <input
          type="file"
          accept="image/png,image/webp,image/jpeg,image/svg+xml"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
            e.target.value = "";
          }}
        />
      </label>
    </div>
  );
}

/** Resolve a saved logo key to a viewable URL (skipped once a local preview exists). */
function useSavedLogoUrl(eventId?: string, logoKey?: string, skip?: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!eventId || !logoKey || skip) return;
    let cancelled = false;
    fetch(`/api/events/${eventId}/cover-logo?key=${encodeURIComponent(logoKey)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.url) setUrl(d.url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [eventId, logoKey, skip]);
  return url;
}

/** Logo centered in the solid preview strip, honoring the padding setting. */
function LogoPreview({
  eventId,
  logoKey,
  padding,
}: {
  eventId?: string;
  logoKey?: string;
  padding: number;
}) {
  const url = useSavedLogoUrl(eventId, logoKey);
  if (!logoKey) {
    return <span className="text-[10px] text-white/50">Logo appears here</span>;
  }
  if (!url) return null;
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={url}
      alt=""
      className="object-contain"
      style={{ height: `${Math.max(10, 100 - 2 * padding)}%`, maxWidth: "80%" }}
    />
  );
}

/* ─── Small controls ─── */

function Seg<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label?: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div>
      {label && <p className="text-[12px] font-medium text-stone-600 mb-2">{label}</p>}
      <div
        className="grid gap-1 p-1 bg-stone-100 rounded"
        style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
      >
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "py-1.5 text-[11px] font-medium rounded transition-all duration-150 cursor-pointer",
              value === o.value
                ? "bg-white text-stone-900 shadow-sm"
                : "text-stone-500 hover:text-stone-700"
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SliderRow({
  label,
  valueLabel,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  valueLabel: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label className="text-[12px] font-medium text-stone-600">{label}</label>
        <span className="text-[11px] text-stone-400 tabular-nums">{valueLabel}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-emerald-500"
      />
    </div>
  );
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [hexInput, setHexInput] = useState(value);
  useEffect(() => setHexInput(value), [value]);
  return (
    <div className="flex items-center gap-3 flex-1">
      <label className="relative cursor-pointer shrink-0">
        <div className="w-8 h-8 border border-stone-200" style={{ backgroundColor: value }} />
        <input
          type="color"
          value={value}
          onChange={(e) => {
            setHexInput(e.target.value);
            onChange(e.target.value);
          }}
          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
        />
      </label>
      {label && (
        <span className="flex-1 text-[12px] font-medium text-stone-600">{label}</span>
      )}
      <input
        type="text"
        value={hexInput}
        onChange={(e) => {
          setHexInput(e.target.value);
          if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value);
        }}
        className={cn(
          "text-[12px] text-stone-600 font-mono px-2 py-1 border-b border-stone-200 bg-transparent focus:outline-none focus:border-stone-900 transition-colors",
          label ? "w-20" : "flex-1"
        )}
      />
    </div>
  );
}

function MiniToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between cursor-pointer group">
      <span className="text-[12px] font-medium text-stone-600 group-hover:text-stone-900 transition-colors">
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-4 w-7 items-center rounded-full transition-colors duration-200 cursor-pointer",
          checked ? "bg-stone-900" : "bg-stone-300"
        )}
      >
        <span
          className={cn(
            "inline-block h-2.5 w-2.5 rounded-full bg-white transition-transform duration-200",
            checked ? "translate-x-[15px]" : "translate-x-[3px]"
          )}
        />
      </button>
    </label>
  );
}

function SectionSelect({
  label,
  sections,
  value,
  onChange,
}: {
  label: string;
  sections?: SectionOption[];
  value?: string;
  onChange: (id: string | undefined) => void;
}) {
  const usable = (sections ?? []).filter((s) => s.imageCount > 0);
  return (
    <div>
      <p className="text-[12px] font-medium text-stone-600 mb-2">{label}</p>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="w-full text-[12px] text-stone-700 px-2 py-2 border border-stone-200 rounded bg-white focus:outline-none focus:border-stone-900 transition-colors cursor-pointer"
      >
        <option value="">First section (automatic)</option>
        {usable.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.imageCount})
          </option>
        ))}
      </select>
    </div>
  );
}
