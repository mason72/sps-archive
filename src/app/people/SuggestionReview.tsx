"use client";

/**
 * The review behind a "Who is this?" card: every frame of the anonymous face
 * group beside every frame of the person the engine matched it to, decided
 * from the photos rather than two 80px crops.
 *
 * Same shape as the event page's "Is this X?" modal (PeopleView's
 * CompareModal): actions pinned in the header, two independently scrolling
 * panes, the claimed face ringed on group shots so a six-person frame says
 * WHICH face is being asked about. It exists because a card offered a hand as
 * "Vijaya Kumar Vegi" and nothing on it could be opened (2026-09-30).
 *
 * Keyboard: ← → move between cards, Esc closes (the zoom first, if open).
 */
import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { FaceRings, usePersonFaces, type PersonFaces } from "@/components/events/FaceOutline";

export interface ReviewCard {
  id: string;
  kind: "guest" | "crew";
  suggestedName: string;
  currentName?: string | null;
  eventName: string;
  confidence: number;
}

type Photo = { imageId: string; filename: string; thumbnailUrl: string; largeUrl: string };
type Side = { personId: string; total: number; photos: Photo[] };

export function SuggestionReview({
  card,
  busy,
  onConfirm,
  onReject,
  onNotAPerson,
  onPrev,
  onNext,
  onClose,
}: {
  card: ReviewCard;
  busy: boolean;
  onConfirm: () => void;
  onReject: () => void;
  onNotAPerson?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<{ cluster: Side; reference: Side | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState<Photo | null>(null);
  const [showFilenames, setShowFilenames] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setFailed(false);
    fetch(`/api/people/identity-suggestions/${card.id}/photos`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body) => alive && setData(body))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [card.id]);

  const clusterFaces = usePersonFaces(data?.cluster.personId);
  const referenceFaces = usePersonFaces(data?.reference?.personId);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (zoomed) setZoomed(null);
        else onClose();
      } else if (!zoomed && !busy && e.key === "ArrowLeft") onPrev?.();
      else if (!zoomed && !busy && e.key === "ArrowRight") onNext?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [zoomed, busy, onClose, onPrev, onNext]);

  const pane = (label: string, side: Side | null | undefined, faces: PersonFaces | null) => (
    <div className="flex min-h-0 flex-col">
      <p className="mb-3 shrink-0 text-[10px] font-medium uppercase tracking-[0.2em] text-stone-400">
        {label}
        {side && (
          <>
            {" "}
            · {side.total} photo{side.total === 1 ? "" : "s"}
            {side.total > side.photos.length && `, best ${side.photos.length} shown`}
          </>
        )}
      </p>
      <div className="min-h-0 overflow-y-auto pr-1">
        {!side ? (
          <div className="grid grid-cols-3 gap-1.5">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="aspect-square animate-pulse bg-stone-100" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-x-1.5 gap-y-2">
            {side.photos.map((p) => (
              <figure key={p.imageId}>
                <button
                  type="button"
                  onClick={() => setZoomed(p)}
                  title="Open larger"
                  className="relative block aspect-square w-full cursor-zoom-in overflow-hidden bg-stone-100"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.thumbnailUrl}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover object-top"
                  />
                  <FaceRings
                    faces={faces?.multiFace.has(p.imageId) ? faces.byImage.get(p.imageId) : undefined}
                    fit="cover-top"
                  />
                </button>
                {showFilenames && (
                  <figcaption className="mt-0.5 truncate text-[9px] leading-tight text-stone-400" title={p.filename}>
                    {p.filename}
                  </figcaption>
                )}
              </figure>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const zoomedFaces =
    zoomed &&
    (clusterFaces?.multiFace.has(zoomed.imageId)
      ? clusterFaces.byImage.get(zoomed.imageId)
      : referenceFaces?.multiFace.has(zoomed.imageId)
        ? referenceFaces.byImage.get(zoomed.imageId)
        : undefined);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={`Is this ${card.suggestedName}?`}
        className="flex max-h-[88vh] w-full max-w-5xl flex-col bg-white p-5 sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Actions pinned in the header — never scrolled away. */}
        <div className="mb-6 flex shrink-0 flex-wrap items-start gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-editorial text-2xl text-stone-900">
              Is this {card.suggestedName}?
            </h2>
            <p className="mt-1 text-[13px] text-stone-500">
              A face group at {card.eventName}
              {card.currentName && <> filed as &ldquo;{card.currentName}&rdquo;</>}, matched at{" "}
              {Math.round(card.confidence * 100)}%.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => setShowFilenames((v) => !v)}
              className={`px-1 text-[11px] transition-colors ${
                showFilenames ? "text-stone-600" : "text-stone-300 hover:text-stone-500"
              }`}
            >
              Filenames
            </button>
            {onNotAPerson && (
              <button
                onClick={onNotAPerson}
                disabled={busy}
                title={`"${card.suggestedName}" is a label, not a human. Removes the name everywhere. Undoable.`}
                className="px-3 py-2 text-[13px] text-stone-400 transition-colors hover:text-stone-600 disabled:opacity-40"
              >
                Not a person
              </button>
            )}
            <button
              onClick={onReject}
              disabled={busy}
              className="px-3 py-2 text-[13px] text-stone-400 transition-colors hover:text-stone-600 disabled:opacity-40"
            >
              Not them
            </button>
            <button
              onClick={onConfirm}
              disabled={busy}
              className="bg-stone-900 px-5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-stone-700 disabled:opacity-40"
            >
              Confirm
            </button>
            <button
              onClick={onClose}
              aria-label="Close"
              className="ml-1 p-1 text-stone-300 transition-colors hover:text-stone-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {failed ? (
          <p className="py-16 text-center text-[13px] text-stone-400">
            Couldn&apos;t load the photos. The card&apos;s buttons still work.
          </p>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-8 md:grid-cols-2">
            {pane("This face group", data?.cluster, clusterFaces)}
            {data && !data.reference ? (
              <div className="flex min-h-0 flex-col">
                <p className="mb-3 text-[10px] font-medium uppercase tracking-[0.2em] text-stone-400">
                  {card.suggestedName}
                </p>
                <p className="text-[13px] text-stone-500">
                  Matched against {card.suggestedName}&apos;s crew reference faces.
                </p>
              </div>
            ) : (
              pane(card.suggestedName, data?.reference, referenceFaces)
            )}
          </div>
        )}
      </div>

      {zoomed && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-8"
          onClick={(e) => {
            e.stopPropagation();
            setZoomed(null);
          }}
        >
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={zoomed.largeUrl}
              alt={zoomed.filename}
              className="block max-h-[85vh] max-w-full object-contain"
            />
            <FaceRings faces={zoomedFaces || undefined} fit="natural" />
          </div>
          <p className="absolute bottom-6 left-1/2 -translate-x-1/2 text-[11px] text-white/50">
            {zoomed.filename}
          </p>
        </div>
      )}
    </div>
  );
}
