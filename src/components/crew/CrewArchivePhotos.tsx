"use client";

/**
 * The crew spotlight — every archive photo this crew member is IN, grouped by
 * shoot, inside their card on /people.
 *
 * Crew have no filename identities, so this reads their crew_persons links:
 * each tray confirm ("Is this Christie?") makes this section richer. That is
 * the answer to Mason's "why aren't people like Joey or Justin here? They
 * have far more images than me" — their photos live HERE, on the crew's own
 * surface, never on the guest wall.
 */
import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";

interface CrewPhotoEvent {
  eventId: string;
  eventName: string;
  eventDate: string | null;
  /** Their cluster in this event — the ?face= deep link opens its card. */
  clusterId: string;
  imageCount: number;
  images: { id: string; filename: string; thumbnailUrl: string }[];
}

interface CrewPhotos {
  name: string;
  imageCount: number;
  events: CrewPhotoEvent[];
}

function formatEventDate(date: string | null): string | null {
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function CrewArchivePhotos({ crewId }: { crewId: string }) {
  const [data, setData] = useState<CrewPhotos | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState<{ thumbnailUrl: string; filename: string } | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setFailed(false);
    fetch(`/api/crew/${crewId}/photos`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((j: CrewPhotos) => {
        if (live) setData(j);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [crewId]);

  if (failed) return null; // the faces kit above still works — degrade quietly

  return (
    <div className="mt-6 border-t border-stone-100 pt-5">
      <p className="label-caps mb-3">
        In the archive
        {data && (
          <span className="ml-2 normal-case tracking-normal text-stone-300">
            {data.imageCount === 0
              ? "no linked photos yet — confirm their face suggestions and this fills in"
              : `${data.imageCount.toLocaleString()} photo${data.imageCount === 1 ? "" : "s"} across ${data.events.length} ${data.events.length === 1 ? "shoot" : "shoots"}`}
          </span>
        )}
      </p>

      {!data && (
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse bg-stone-100" />
          ))}
        </div>
      )}

      {data?.events.map((event) => (
        <section key={event.eventId} className="mb-6 last:mb-0">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <p className="min-w-0 truncate text-[12px] text-stone-600">
              {event.eventName}
              {formatEventDate(event.eventDate) && (
                <span className="ml-1.5 text-stone-300">{formatEventDate(event.eventDate)}</span>
              )}
              <span className="ml-1.5 tabular-nums text-stone-400">
                · {event.imageCount}
                {event.images.length < event.imageCount && ` (showing ${event.images.length})`}
              </span>
            </p>
            <a
              href={`/events/${event.eventId}?face=${event.clusterId}`}
              className="flex shrink-0 items-center gap-1 text-[11px] text-stone-400 transition-colors hover:text-emerald-700"
            >
              Open in event
              <ArrowUpRight className="h-3 w-3" />
            </a>
          </div>
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
            {event.images.map((img) => (
              <button
                key={img.id}
                onClick={() => setZoomed(img)}
                className="block overflow-hidden bg-stone-100"
                title={img.filename}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.thumbnailUrl}
                  alt=""
                  loading="lazy"
                  className="aspect-square w-full object-cover transition-transform duration-300 hover:scale-[1.05]"
                  style={{ objectPosition: "center 25%" }}
                />
              </button>
            ))}
          </div>
        </section>
      ))}

      {zoomed && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-8"
          onClick={(e) => {
            e.stopPropagation();
            setZoomed(null);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoomed.thumbnailUrl} alt="" className="max-h-full max-w-full object-contain" />
          <p className="absolute bottom-6 left-1/2 -translate-x-1/2 text-[11px] text-white/50">
            {zoomed.filename}
          </p>
        </div>
      )}
    </div>
  );
}
