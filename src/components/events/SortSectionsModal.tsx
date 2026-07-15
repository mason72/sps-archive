"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, FolderTree, Users, LayoutGrid, Layers } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  planAutoSections,
  type PlanImage,
  type PlanMode,
  type DetectionSummary,
} from "@/lib/sections/auto-plan";

interface SectionLite {
  id: string;
  name: string;
  isAuto: boolean;
  imageCount: number;
}

interface SortSectionsModalProps {
  eventId: string;
  onClose: () => void;
  /** Called with the updated section list after a successful apply. */
  onApplied: (sections: SectionLite[]) => void;
  /**
   * Live upload-session state, when the modal is open mid-upload. Rows are
   * presign-created before their binaries land, so the plan already counts
   * every dropped file — previewing during an upload is accurate. Apply stays
   * gated until the session drains (applying mid-flight could race a retry
   * against the deleted Unsorted section).
   */
  uploading?: { active: boolean; uploaded: number; total: number };
}

const MODE_META: { mode: PlanMode; label: string; icon: typeof FolderTree; hint: string }[] = [
  { mode: "letter", label: "Letter ranges", icon: FolderTree, hint: "A–C, D–F… balanced & scannable" },
  { mode: "per-person", label: "One per person", icon: Users, hint: "a section per name — small jobs" },
  { mode: "even", label: "Even sets", icon: LayoutGrid, hint: "just split into equal groups" },
];

/**
 * SortSectionsModal — the "Sort into sections" preview. Loads the event's
 * images once, then runs the SAME pure planner the server uses so the section
 * list updates live as you drag the slider. Apply POSTs the chosen config.
 */
export function SortSectionsModal({ eventId, onClose, onApplied, uploading }: SortSectionsModalProps) {
  const [loading, setLoading] = useState(true);
  const [images, setImages] = useState<PlanImage[]>([]);
  const [detection, setDetection] = useState<DetectionSummary | null>(null);
  const [mode, setMode] = useState<PlanMode>("letter");
  const [target, setTarget] = useState(300);
  const [stacks, setStacks] = useState(false);
  const [applying, setApplying] = useState(false);

  const uploadActive = !!uploading?.active;

  // Load the plan inputs + detection. Mode/stacks/target defaults are set on
  // the FIRST load only — refreshes mid-upload must never yank the user's
  // slider out from under them.
  const initializedRef = useRef(false);
  const loadPlan = useCallback(
    async (opts?: { silent?: boolean }): Promise<boolean> => {
      try {
        const res = await fetch(`/api/events/${eventId}/section-plan`);
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { images: PlanImage[]; detection: DetectionSummary };
        const d = data.detection;
        setImages(data.images);
        setDetection(d);
        if (!initializedRef.current) {
          initializedRef.current = true;
          // Default stacking on for big person-named jobs — collapses the count.
          const willStack = d.personNamed && d.distinctPeople > 20 && d.suggestedMode === "letter";
          setMode(d.suggestedMode);
          setStacks(willStack);
          // Target's UNIT depends on stacks (people vs photos) — pick a matching
          // default so the slider and the plan agree from the first render.
          setTarget(d.suggestedMode === "per-person" ? 1 : willStack ? 65 : 300);
        }
        return true;
      } catch {
        if (!opts?.silent) {
          toast.error("Couldn't load the section preview");
          onClose();
        }
        return false;
      }
    },
    [eventId, onClose]
  );

  useEffect(() => {
    let alive = true;
    loadPlan().finally(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [loadPlan]);

  // While an upload session runs, keep the plan fresh: rows are presign-created
  // ahead of their binaries, so each poll picks up newly registered files
  // (names only — a cheap query). A final refresh fires when the session
  // drains, so Apply always acts on the complete, authoritative set.
  const wasUploadingRef = useRef(false);
  useEffect(() => {
    if (loading) return;
    if (uploadActive) {
      wasUploadingRef.current = true;
      const id = setInterval(() => loadPlan({ silent: true }), 10_000);
      return () => clearInterval(id);
    }
    if (wasUploadingRef.current) {
      // Session just drained: one authoritative refresh before Apply unlocks.
      wasUploadingRef.current = false;
      loadPlan({ silent: true });
    }
  }, [uploadActive, loading, loadPlan]);

  // Escape to close.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !applying) onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, applying]);

  // Slider counts people when stacks is on, photos otherwise.
  const stacksApplies = mode === "letter";
  const countPeople = stacksApplies && stacks;
  const sliderMin = countPeople ? 10 : 50;
  const sliderMax = countPeople ? 200 : 1000;
  const sliderStep = countPeople ? 5 : 25;

  // When the mode or unit changes, snap an out-of-range target back to a sane
  // default so the slider and the plan never disagree (e.g. leaving per-person
  // where target=1, or flipping the stacks unit). Excludes `target` from deps
  // on purpose — this only reacts to unit changes, never to the user dragging.
  useEffect(() => {
    if (mode === "per-person") return;
    if (target < sliderMin || target > sliderMax) {
      setTarget(countPeople ? 65 : 300);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, countPeople]);

  // Live plan — the same function the server applies.
  const planned = useMemo(() => {
    if (!images.length) return [];
    return planAutoSections(images, { mode, target, stacks: countPeople });
  }, [images, mode, target, countPeople]);

  const tooMany = planned.length > 60;

  const apply = useCallback(async () => {
    if (tooMany) return;
    setApplying(true);
    try {
      const res = await fetch(`/api/events/${eventId}/auto-sections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, target, stacks: countPeople }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to create sections");
      }
      const data = (await res.json()) as { sections: SectionLite[]; created: number };
      onApplied(data.sections);
      toast.success(`Created ${data.created} section${data.created === 1 ? "" : "s"}`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create sections");
    } finally {
      setApplying(false);
    }
  }, [eventId, mode, target, countPeople, tooMany, onApplied, onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={applying ? undefined : onClose} />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-stone-100 px-6 py-5">
          <div>
            <h2 className="font-editorial text-[22px] leading-tight text-stone-900">
              Sort into sections
            </h2>
            <p className="mt-0.5 text-[12px] text-stone-400">
              We&apos;ll create the sections — no math, no dragging.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={applying}
            className="rounded-full p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 px-6 py-16 text-[13px] text-stone-400">
            <Loader2 size={16} className="animate-spin" /> Reading your photos…
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {/* Mid-upload: the plan is already complete (rows register ahead
                  of their binaries) — say so, and explain the gated Apply. */}
              {uploadActive && uploading && (
                <div className="mb-4 flex items-center gap-2.5 rounded-lg bg-emerald-50/70 px-3 py-2.5 text-[12px] text-emerald-800">
                  <Loader2 size={13} className="shrink-0 animate-spin text-emerald-500" />
                  <span>
                    <span className="font-medium tabular-nums">
                      {uploading.uploaded.toLocaleString()} of{" "}
                      {uploading.total.toLocaleString()}
                    </span>{" "}
                    uploaded — every file is already counted below. Sorting
                    unlocks when the upload finishes.
                  </span>
                </div>
              )}

              {/* Detection summary */}
              {detection && (
                <p className="mb-4 text-[12px] text-stone-500">
                  <span className="font-medium text-stone-700">
                    {detection.totalImages.toLocaleString()} photos
                  </span>
                  {detection.personNamed ? (
                    <>
                      {" · "}
                      <span className="font-medium text-stone-700">
                        {detection.distinctPeople.toLocaleString()} people
                      </span>{" "}
                      · looks person-named
                    </>
                  ) : (
                    <> · these don&apos;t look person-named, so we&apos;ll split evenly</>
                  )}
                </p>
              )}

              {/* Mode */}
              <div className="grid grid-cols-3 gap-2">
                {MODE_META.map(({ mode: m, label, icon: Icon, hint }) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
                      mode === m
                        ? "border-emerald-500 bg-emerald-50/60"
                        : "border-stone-200 hover:border-stone-300"
                    )}
                  >
                    <Icon size={15} className={mode === m ? "text-emerald-600" : "text-stone-400"} />
                    <span className="text-[12px] font-medium text-stone-800">{label}</span>
                    <span className="text-[10px] leading-tight text-stone-400">{hint}</span>
                  </button>
                ))}
              </div>

              {/* Stacks toggle — letter mode only */}
              {stacksApplies && (
                <button
                  onClick={() => setStacks((s) => !s)}
                  className="mt-4 flex w-full items-center gap-3 rounded-lg border border-stone-200 px-3 py-2.5 text-left hover:border-stone-300"
                >
                  <Layers size={15} className={stacks ? "text-emerald-600" : "text-stone-400"} />
                  <span className="flex-1">
                    <span className="block text-[12px] font-medium text-stone-800">
                      Stack each person&apos;s shots
                    </span>
                    <span className="block text-[10px] text-stone-400">
                      Balance by people, not photos — one card per person
                    </span>
                  </span>
                  <span
                    className={cn(
                      "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                      stacks ? "bg-emerald-500" : "bg-stone-200"
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all",
                        stacks ? "left-4" : "left-0.5"
                      )}
                    />
                  </span>
                </button>
              )}

              {/* Slider — not for per-person */}
              {mode !== "per-person" && (
                <div className="mt-5">
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <label className="text-[12px] font-medium text-stone-700">
                      Up to {target.toLocaleString()} {countPeople ? "people" : "photos"} per section
                    </label>
                  </div>
                  <input
                    type="range"
                    min={sliderMin}
                    max={sliderMax}
                    step={sliderStep}
                    value={Math.min(Math.max(target, sliderMin), sliderMax)}
                    onChange={(e) => setTarget(Number(e.target.value))}
                    className="w-full accent-emerald-500"
                  />
                </div>
              )}

              {/* Live preview of the resulting sections */}
              <div className="mt-5">
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-stone-400">
                  {planned.length} section{planned.length === 1 ? "" : "s"}
                </p>
                {tooMany ? (
                  <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-[12px] text-amber-700">
                    That&apos;s {planned.length} sections — too many. Raise the limit, or
                    switch off &quot;one per person&quot;.
                  </p>
                ) : (
                  <div className="max-h-52 space-y-1 overflow-y-auto">
                    {planned.map((s, i) => (
                      <div
                        key={`${s.name}-${i}`}
                        className="flex items-center justify-between rounded-md bg-stone-50 px-3 py-2 text-[12px]"
                      >
                        <span className="font-medium text-stone-800">{s.name}</span>
                        <span className="text-stone-400">
                          {s.imageIds.length.toLocaleString()} photos
                          {countPeople && ` · ${s.people} ppl`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-stone-100 px-6 py-4">
              <p className="max-w-[55%] text-[11px] leading-tight text-stone-400">
                Creates these sections and clears out Unsorted. Highlights and your
                own sections stay put.
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={onClose}
                  disabled={applying}
                  className="text-[13px] text-stone-500 hover:text-stone-800 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={apply}
                  disabled={applying || tooMany || planned.length === 0 || uploadActive}
                  className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {applying && <Loader2 size={14} className="animate-spin" />}
                  {applying
                    ? "Sorting…"
                    : uploadActive
                    ? "Waiting for upload…"
                    : `Sort into ${planned.length} section${planned.length === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
