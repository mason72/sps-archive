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
  /** Other spellings merged into this identity — a merge stays visible. */
  aliases?: string[];
}

/** A tile the merge picker can offer — the board's own card data. */
export interface MergeCandidate {
  key: string;
  name: string;
  heroUrl: string | null;
  imageCount: number;
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
  mergeCandidates,
  onMerged,
  onUnmerged,
}: {
  name: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  /** Everyone else on the wall — what "same person as…" can pick from. */
  mergeCandidates?: MergeCandidate[];
  /** A merge was recorded — the board refreshes and offers undo. */
  onMerged?: (aliasName: string, canonicalName: string) => void;
  /** An alias was detached — the board refreshes. */
  onUnmerged?: () => void;
}) {
  const [data, setData] = useState<SpotlightData | null>(null);
  const [failed, setFailed] = useState(false);
  const [showFilenames, setShowFilenames] = useState(false);
  const [zoomed, setZoomed] = useState<SpotlightImage | null>(null);
  // The merge flow: closed → picking (search) → confirming (faces side by side).
  const [merging, setMerging] = useState(false);
  const [mergeQuery, setMergeQuery] = useState("");
  const [mergeTarget, setMergeTarget] = useState<MergeCandidate | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);

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
    setMerging(false);
    setMergeQuery("");
    setMergeTarget(null);
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

  const [mergeError, setMergeError] = useState<string | null>(null);
  const confirmMerge = async () => {
    if (!mergeTarget || !data || mergeBusy) return;
    setMergeBusy(true);
    setMergeError(null);
    try {
      const res = await fetch("/api/people/aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The open person folds INTO the picked one — "this person IS that
        // person". Display name still resolves by preferredSpelling over the
        // combined photos, so direction never changes what the tile says.
        body: JSON.stringify({ aliasName: data.name, canonicalName: mergeTarget.name }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Failed to merge");
      }
      onMerged?.(data.name, mergeTarget.name);
    } catch (e) {
      setMergeError(e instanceof Error ? e.message : "Failed to merge");
      setMergeBusy(false);
    }
  };
  const unmerge = async (alias: string) => {
    const res = await fetch(`/api/people/aliases?aliasName=${encodeURIComponent(alias)}`, {
      method: "DELETE",
    });
    if (res.ok) onUnmerged?.();
  };

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (zoomed) return setZoomed(null);
        if (merging) {
          setMerging(false);
          setMergeTarget(null);
          return;
        }
        return onClose();
      }
      if (zoomed || merging) return;
      if (e.key === "ArrowLeft") onPrev?.();
      if (e.key === "ArrowRight") onNext?.();
    },
    [onClose, onPrev, onNext, zoomed, merging]
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
            {/* A merge stays visible — silent identity surgery is how trust
                in the wall dies. Each spelling detaches with one click. */}
            {data && (data.aliases?.length ?? 0) > 0 && (
              <p className="mt-1 text-[12px] text-stone-400">
                also filed as{" "}
                {data.aliases!.map((a, i) => (
                  <span key={a}>
                    {i > 0 && " · "}
                    <span className="text-stone-600">&ldquo;{a}&rdquo;</span>{" "}
                    <button
                      onClick={() => unmerge(a)}
                      className="underline hover:text-stone-600"
                      title={`Undo the merge — "${a}" becomes its own card again`}
                    >
                      unmerge
                    </button>
                  </span>
                ))}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {mergeCandidates && data && (
              <button
                onClick={() => {
                  setMerging((v) => !v);
                  setMergeTarget(null);
                  setMergeQuery("");
                  setMergeError(null);
                }}
                className={`text-[11px] transition-colors ${
                  merging ? "text-stone-600" : "text-stone-300 hover:text-stone-500"
                }`}
                title="Two cards for one human? Fold this one into the other."
              >
                Same person as…
              </button>
            )}
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

        {/* ─── The merge flow: pick who they really are, confirm on faces ─── */}
        {merging && data && mergeCandidates && (
          <div className="shrink-0 border-b border-stone-100 bg-stone-50/70 px-8 py-4">
            {!mergeTarget ? (
              <>
                <p className="text-[13px] text-stone-600">
                  Fold <span className="text-stone-900">{data.name}</span> into another
                  card — their photos combine, and the merge is undoable.
                </p>
                <input
                  autoFocus
                  value={mergeQuery}
                  onChange={(e) => setMergeQuery(e.target.value)}
                  placeholder="Search for the other spelling…"
                  className="mt-2 w-full max-w-sm border-b border-stone-300 bg-transparent py-1.5 text-[14px] text-stone-900 placeholder:text-stone-300 focus:border-stone-900 focus:outline-none"
                />
                {mergeQuery.trim() && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {mergeCandidates
                      .filter(
                        (c) =>
                          c.key !== data.key &&
                          c.name.toLowerCase().includes(mergeQuery.trim().toLowerCase())
                      )
                      .slice(0, 8)
                      .map((c) => (
                        <button
                          key={c.key}
                          onClick={() => setMergeTarget(c)}
                          className="flex items-center gap-2.5 border border-stone-200 bg-white py-1 pl-1 pr-3 transition-colors hover:border-stone-400"
                        >
                          <span className="relative block h-8 w-8 shrink-0 overflow-hidden bg-stone-100">
                            {c.heroUrl && (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img
                                src={c.heroUrl}
                                alt=""
                                className="h-full w-full object-cover"
                                style={{ objectPosition: "center 25%" }}
                              />
                            )}
                          </span>
                          <span className="text-left">
                            <span className="block text-[12px] text-stone-900">{c.name}</span>
                            <span className="block text-[11px] tabular-nums text-stone-400">
                              {c.imageCount} photo{c.imageCount === 1 ? "" : "s"}
                            </span>
                          </span>
                        </button>
                      ))}
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-5">
                {/* The decision is made on FACES, not strings — both cards'
                    heroes side by side, exactly what the wall shows. */}
                {[
                  {
                    name: data.name,
                    heroUrl:
                      mergeCandidates.find((c) => c.key === data.key)?.heroUrl ?? null,
                    imageCount: data.imageCount,
                  },
                  mergeTarget,
                ].map((p, i) => (
                  <figure key={i} className="w-24 text-center">
                    <div className="relative aspect-square w-24 overflow-hidden bg-stone-100">
                      {p.heroUrl && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={p.heroUrl}
                          alt=""
                          className="h-full w-full object-cover"
                          style={{ objectPosition: "center 25%" }}
                        />
                      )}
                    </div>
                    <figcaption className="mt-1.5 truncate text-[11px] text-stone-700">
                      {p.name}
                      <span className="block tabular-nums text-stone-400">
                        {p.imageCount} photo{p.imageCount === 1 ? "" : "s"}
                      </span>
                    </figcaption>
                  </figure>
                ))}
                <div className="min-w-[180px] flex-1">
                  <p className="text-[13px] leading-snug text-stone-600">
                    Same person? The two cards become one with{" "}
                    <span className="tabular-nums text-stone-900">
                      {(data.imageCount + mergeTarget.imageCount).toLocaleString()}
                    </span>{" "}
                    photos — undo any time from the merged card.
                  </p>
                  {mergeError && (
                    <p className="mt-1 text-[12px] text-red-700">{mergeError}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={confirmMerge}
                    disabled={mergeBusy}
                    className="border border-emerald-200 px-4 py-1.5 text-[12px] font-medium text-emerald-700 transition-colors hover:border-emerald-500 disabled:opacity-40"
                  >
                    {mergeBusy ? "Merging…" : "Same person — merge"}
                  </button>
                  <button
                    onClick={() => setMergeTarget(null)}
                    className="px-3 py-1.5 text-[12px] text-stone-400 transition-colors hover:text-stone-600"
                  >
                    Back
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Event chips — the same affordance the index uses under a face. */}
        {data && data.events.length > 0 && (
          <div className="flex shrink-0 flex-wrap gap-2 border-b border-stone-100 px-8 py-4">
            {data.events.map((e) => (
              <EventChip
                key={e.eventId}
                // The chip's face is this shoot's best frame of THEM — the
                // payload sorts each group best-first, so it's already at
                // hand. Without it the chip renders an empty grey square.
                event={{ ...e, heroUrl: e.images[0]?.thumbnailUrl ?? null }}
                personName={data.name}
                compact
              />
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
