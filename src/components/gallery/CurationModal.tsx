"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Star, X } from "lucide-react";
import { toast } from "sonner";
import { SITE_SCENES, SITE_SERVICES } from "@/lib/site/scenes";
import type { ImageData } from "@/types/image";

/** What the modal saved, so the page can patch its local image state. */
export interface CurationSaveResult {
  imageIds: string[];
  /** Present only if applied to the selection. */
  service?: string | null;
  featured?: boolean;
  /** Source-event edits (name/city flow to every image from that event). */
  eventUpdates: Array<{ eventId: string; name?: string; city?: string | null }>;
}

interface CurationModalProps {
  /** The selected images (1+; multi-select applies fields to all). */
  images: ImageData[];
  onClose: () => void;
  onSaved: (result: CurationSaveResult) => void;
}

/** Mixed-value sentinel for multi-select fields. */
const MIXED = "__mixed__";

/** Service dropdown options — slug + the registry's clean pool label. */
const SERVICE_OPTIONS = SITE_SERVICES.map((slug) => ({
  slug,
  label: SITE_SCENES.find((s) => s.service === slug)?.label ?? slug,
}));

/**
 * CurationModal — edit the website curation metadata behind the site's
 * captions and ordering: source-event name + city (event-level), service,
 * and the featured flag. Opens from the selection toolbar in website
 * sections; handles single images and bulk selections alike.
 */
export function CurationModal({ images, onClose, onSaved }: CurationModalProps) {
  // Source events represented in the selection. One event → name + city are
  // editable; several → city-only bulk (renaming N events to one name is
  // almost certainly a mistake).
  const events = useMemo(() => {
    const map = new Map<string, { name: string; city: string }>();
    for (const img of images) {
      if (img.eventId && !map.has(img.eventId)) {
        map.set(img.eventId, {
          name: img.eventName ?? "",
          city: img.eventCity ?? "",
        });
      }
    }
    return map;
  }, [images]);
  const singleEvent = events.size === 1 ? [...events.entries()][0] : null;

  const initialService = useMemo(() => {
    const values = new Set(images.map((img) => img.service ?? ""));
    return values.size === 1 ? [...values][0] : MIXED;
  }, [images]);
  const initialFeatured = useMemo(() => {
    const values = new Set(images.map((img) => img.featured ?? false));
    return values.size === 1 ? [...values][0] : MIXED;
  }, [images]);

  const [eventName, setEventName] = useState(singleEvent?.[1].name ?? "");
  const [city, setCity] = useState(singleEvent?.[1].city ?? "");
  const [service, setService] = useState<string>(initialService);
  const [featured, setFeatured] = useState<boolean | typeof MIXED>(
    initialFeatured
  );
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const requests: Promise<Response>[] = [];
      const result: CurationSaveResult = {
        imageIds: images.map((img) => img.id),
        eventUpdates: [],
      };

      // Per-image fields — only what actually changed, applied to all selected.
      const imageBody: { service?: string | null; featured?: boolean } = {};
      if (service !== MIXED && service !== initialService) {
        imageBody.service = service || null;
        result.service = service || null;
      }
      if (featured !== MIXED && featured !== initialFeatured) {
        imageBody.featured = featured;
        result.featured = featured;
      }
      if (Object.keys(imageBody).length > 0) {
        for (const img of images) {
          requests.push(
            fetch(`/api/images/${img.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(imageBody),
            })
          );
        }
      }

      // Event-level fields. Single source event → name + city; several →
      // city applies to each of them (bulk relabel).
      if (singleEvent) {
        const [eventId, initial] = singleEvent;
        const eventBody: { name?: string; city?: string } = {};
        if (eventName.trim() && eventName.trim() !== initial.name) {
          eventBody.name = eventName.trim();
        }
        if (city.trim() !== initial.city) eventBody.city = city.trim();
        if (Object.keys(eventBody).length > 0) {
          requests.push(
            fetch(`/api/events/${eventId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(eventBody),
            })
          );
          result.eventUpdates.push({
            eventId,
            name: eventBody.name,
            city: "city" in eventBody ? city.trim() || null : undefined,
          });
        }
      } else if (city.trim()) {
        for (const eventId of events.keys()) {
          requests.push(
            fetch(`/api/events/${eventId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ city: city.trim() }),
            })
          );
          result.eventUpdates.push({ eventId, city: city.trim() });
        }
      }

      if (requests.length === 0) {
        onClose();
        return;
      }

      const responses = await Promise.all(requests);
      const failed = responses.filter((res) => !res.ok);
      if (failed.length > 0) {
        throw new Error(`${failed.length} of ${responses.length} updates failed`);
      }

      toast.success(
        images.length === 1
          ? "Website details saved"
          : `Website details saved for ${images.length} images`
      );
      onSaved(result);
      onClose();
    } catch (err) {
      console.error("Curation save failed:", err);
      toast.error("Failed to save website details");
    } finally {
      setIsSaving(false);
    }
  };

  if (typeof window === "undefined") return null;

  const inputClass =
    "w-full bg-transparent border-b border-stone-200 pb-1.5 text-[14px] text-stone-900 placeholder:text-stone-300 focus:border-stone-900 focus:outline-none transition-colors";
  const labelClass =
    "text-[10px] uppercase tracking-[0.2em] text-stone-400 font-medium";

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm fade-in"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-md bg-white border border-stone-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100">
          <div>
            <p className={labelClass}>Website details</p>
            <p className="text-[13px] text-stone-600">
              {images.length === 1
                ? "Captions and ordering on the marketing site"
                : `Applies to ${images.length} selected images`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-900 transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Source event — name + city when one event, city-only in bulk */}
          {singleEvent ? (
            <>
              <div className="space-y-1.5">
                <label className={labelClass}>Event name</label>
                <input
                  type="text"
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                  placeholder="e.g. Stripe Holiday Party"
                  className={inputClass}
                />
              </div>
              <div className="space-y-1.5">
                <label className={labelClass}>City</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. Seattle"
                  className={inputClass}
                />
              </div>
              <p className="text-[11px] text-stone-400 leading-relaxed">
                Event name and city come from the source event — edits apply to
                every photo from it.
              </p>
            </>
          ) : (
            <div className="space-y-1.5">
              <label className={labelClass}>City — {events.size} source events</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Set a city for all source events"
                className={inputClass}
              />
              <p className="text-[11px] text-stone-400 leading-relaxed">
                Selection spans {events.size} events, so the event name stays
                per-event. A city entered here applies to all of them.
              </p>
            </div>
          )}

          {/* Service */}
          <div className="space-y-1.5">
            <label className={labelClass}>Service</label>
            <select
              value={service}
              onChange={(e) => setService(e.target.value)}
              className={`${inputClass} cursor-pointer appearance-none`}
            >
              {service === MIXED && <option value={MIXED}>Mixed — keep as is</option>}
              <option value="">None</option>
              {SERVICE_OPTIONS.map((opt) => (
                <option key={opt.slug} value={opt.slug}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Featured */}
          <button
            type="button"
            onClick={() =>
              setFeatured((prev) => (prev === MIXED ? true : !prev))
            }
            className="w-full flex items-center justify-between group"
          >
            <span className="text-left">
              <span className="block text-[14px] text-stone-900">Featured</span>
              <span className="block text-[11px] text-stone-400">
                Pool scenes show featured images first
              </span>
            </span>
            <span
              className={`flex h-7 w-7 items-center justify-center border transition-colors ${
                featured === true
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-stone-200 text-stone-300 group-hover:border-stone-400"
              }`}
            >
              {featured === MIXED ? (
                <span className="text-[12px] text-stone-400">—</span>
              ) : (
                <Star
                  className="h-3.5 w-3.5"
                  fill={featured === true ? "currentColor" : "none"}
                />
              )}
            </span>
          </button>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-stone-100">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[12px] text-stone-500 hover:text-stone-900 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-1.5 bg-stone-900 text-white text-[12px] uppercase tracking-[0.15em] font-medium hover:bg-stone-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
