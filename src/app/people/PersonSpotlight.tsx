"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronLeft, ChevronRight, X } from "lucide-react";

/**
 * The archive-wide person spotlight: every photo of one person, everywhere,
 * grouped by shoot.
 *
 * A modal rather than a page on purpose — the whole point of /people is
 * scanning faces, and ← / → step to the next person without losing that
 * grid (Mason, 2026-08-10: "a modal would let me browse different people
 * more easily"). Photos load on open, because the index already carries
 * 1,500+ people and pre-loading every set would be absurd.
 */

export interface SpotlightImage {
  id: string;
  filename: string;
  thumbnailUrl: string;
}

export interface SpotlightEvent {
  eventId: string;
  eventName: string;
  eventDate: string | null;
  imageCount: number;
  images: SpotlightImage[];
}

interface SpotlightData {
  key: string;
  name: string;
  imageCount: number;
  events: SpotlightEvent[];
}

/** DATE columns are calendar dates — format them in UTC or they slip a day. */
export function formatEventDate(date: string | null): string | null {
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Deep link into one event, filtered to this person. The event page resolves
 * the name with the SAME helper the index used, so the count on the chip is
 * the count you land on — including in events that were never face-clustered.
 */
export function personEventHref(eventId: string, name: string): string {
  return `/events/${eventId}?person=${encodeURIComponent(name)}`;
}

/**
 * An event appearance, as a chip you can read: the shoot's own frame of this
 * person, the event name, and how many of them are in there. Plain thumbnails
 * under a face read as "more photos of her", not as "these are events"
 * (Mason's note, 2026-08-10).
 */
export function EventChip({
  event,
  personName,
  compact,
}: {
  event: { eventId: string; eventName: string; eventDate: string | null; imageCount: number; heroUrl?: string | null };
  personName: string;
  compact?: boolean;
}) {
  const when = formatEventDate(event.eventDate);
  return (
    <Link
      href={personEventHref(event.eventId, personName)}
      className="group/chip flex items-center gap-2.5 border border-stone-200 bg-white py-1 pl-1 pr-3 transition-colors hover:border-stone-400"
      title={`${event.eventName} — ${event.imageCount} photo${event.imageCount === 1 ? "" : "s"} of ${personName}`}
    >
      <span
        className={`relative block shrink-0 overflow-hidden bg-stone-100 ${
          compact ? "h-8 w-8" : "h-10 w-10"
        }`}
      >
        {event.heroUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={event.heroUrl}
            alt=""
            className="h-full w-full object-cover"
            style={{ objectPosition: "center 25%" }}
          />
        )}
      </span>
      <span className="min-w-0">
        <span
          className={`block truncate text-stone-900 ${compact ? "text-[12px]" : "text-[13px]"}`}
        >
          {event.eventName}
        </span>
        <span className="block text-[11px] tabular-nums text-stone-400">
          {event.imageCount} photo{event.imageCount === 1 ? "" : "s"}
          {when && ` · ${when}`}
        </span>
      </span>
    </Link>
  );
}

export function PersonSpotlight({
  name,
  onClose,
  onPrev,
  onNext,
}: {
  name: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const [data, setData] = useState<SpotlightData | null>(null);
  const [failed, setFailed] = useState(false);
  const [showFilenames, setShowFilenames] = useState(false);
  const [zoomed, setZoomed] = useState<SpotlightImage | null>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Refetch whenever the person changes — arrowing through the index reuses
  // this component rather than remounting it.
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setFailed(false);
    setZoomed(null);
    fetch(`/api/people/detail?name=${encodeURIComponent(name)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json: SpotlightData) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") return zoomed ? setZoomed(null) : onClose();
      if (zoomed) return;
      if (e.key === "ArrowLeft") onPrev?.();
      if (e.key === "ArrowRight") onNext?.();
    },
    [onClose, onPrev, onNext, zoomed]
  );
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-6"
      onClick={onClose}
    >
      {/* Person-to-person arrows sit OUTSIDE the sheet so they read as
          "next person", not "next photo". */}
      {onPrev && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          className="absolute left-2 top-1/2 hidden -translate-y-1/2 p-2 text-white/50 transition-colors hover:text-white sm:block"
          aria-label="Previous person"
        >
          <ChevronLeft className="h-7 w-7" />
        </button>
      )}
      {onNext && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          className="absolute right-2 top-1/2 hidden -translate-y-1/2 p-2 text-white/50 transition-colors hover:text-white sm:block"
          aria-label="Next person"
        >
          <ChevronRight className="h-7 w-7" />
        </button>
      )}

      <div
        className="flex max-h-[88vh] w-full max-w-5xl flex-col bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start gap-6 border-b border-stone-100 px-8 pb-5 pt-7">
          <div className="min-w-0 flex-1">
            <h2 className="font-editorial truncate text-[28px] leading-tight text-stone-900">
              {data?.name ?? name}
            </h2>
            <p className="mt-1 text-[13px] text-stone-500">
              {data
                ? `${data.imageCount.toLocaleString()} photo${data.imageCount === 1 ? "" : "s"} across ${data.events.length} ${data.events.length === 1 ? "shoot" : "shoots"}`
                : failed
                  ? "Couldn't load these photos."
                  : "Gathering their photos…"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button
              onClick={() => setShowFilenames((v) => !v)}
              className={`text-[11px] transition-colors ${
                showFilenames ? "text-stone-600" : "text-stone-300 hover:text-stone-500"
              }`}
            >
              Filenames
            </button>
            <button
              onClick={onClose}
              className="p-1 text-stone-300 transition-colors hover:text-stone-600"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Event chips — the same affordance the index uses under a face. */}
        {data && data.events.length > 0 && (
          <div className="flex shrink-0 flex-wrap gap-2 border-b border-stone-100 px-8 py-4">
            {data.events.map((e) => (
              <EventChip key={e.eventId} event={e} personName={data.name} compact />
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          {!data && !failed && (
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-7">
              {Array.from({ length: 14 }).map((_, i) => (
                <div key={i} className="aspect-square animate-pulse bg-stone-100" />
              ))}
            </div>
          )}

          {data?.events.map((event) => (
            <section key={event.eventId} className="mb-9 last:mb-0">
              <div className="mb-3 flex items-baseline justify-between gap-4">
                <p className="label-caps truncate">
                  {event.eventName}
                  {formatEventDate(event.eventDate) && (
                    <span className="ml-2 normal-case tracking-normal text-stone-300">
                      {formatEventDate(event.eventDate)}
                    </span>
                  )}
                </p>
                <Link
                  href={personEventHref(event.eventId, data.name)}
                  className="flex shrink-0 items-center gap-1 text-[12px] text-stone-400 transition-colors hover:text-emerald-700"
                >
                  Open in event
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              <div className="grid grid-cols-3 gap-x-1.5 gap-y-2 sm:grid-cols-5 lg:grid-cols-7">
                {event.images.map((img) => (
                  <figure key={img.id}>
                    <button
                      onClick={() => setZoomed(img)}
                      className="block w-full overflow-hidden bg-stone-100"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.thumbnailUrl}
                        alt={img.filename}
                        loading="lazy"
                        className="aspect-square w-full object-cover transition-transform duration-500 hover:scale-[1.04]"
                      />
                    </button>
                    {showFilenames && (
                      <figcaption
                        className="mt-1 truncate text-[10px] text-stone-400"
                        title={img.filename}
                      >
                        {img.filename}
                      </figcaption>
                    )}
                  </figure>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      {/* A photo, big. Thumbnail-resolution by design — the full frame lives
          in the event, one click away via "Open in event". */}
      {zoomed && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-8"
          onClick={(e) => {
            e.stopPropagation();
            setZoomed(null);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomed.thumbnailUrl}
            alt={zoomed.filename}
            className="max-h-full max-w-full object-contain"
          />
          <p className="absolute bottom-6 left-1/2 -translate-x-1/2 text-[11px] text-white/50">
            {zoomed.filename}
          </p>
        </div>
      )}
    </div>
  );
}
