"use client";

/**
 * "Auto-matched · Review" — what the naming engine applied on its own.
 *
 * Since 2026-10-04 a match at or above AUTO_CONFIDENCE with a clear runner-up
 * is confirmed by the scan itself (identity-suggestions.ts). The name is
 * already live on the wall when a card lands here; this strip is the human's
 * glance afterwards, not a gate. "Looks right" clears a card (or the whole
 * strip); "Undo" takes the engine's name back off the face group, blocks it
 * from being suggested again, and un-teaches the reference it fed.
 *
 * Same card as the queue, deliberately — the same two faces, the same photo
 * review behind them — so the eye learns one shape. Renders nothing when
 * there is nothing unreviewed.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";

import {
  FaceCircleCrop,
  type FaceCropGeometry,
} from "@/components/faces/FaceCircleCrop";

import { SuggestionReview } from "./SuggestionReview";

interface AutoCard {
  id: string;
  personId: string;
  eventId: string;
  eventName: string;
  kind: "guest" | "crew";
  suggestedName: string;
  confidence: number;
  photoCount: number;
  decidedAt: string | null;
  clusterFace: FaceCropGeometry | null;
  referenceFace: FaceCropGeometry | null;
}

export function AutoMatched() {
  const router = useRouter();
  const [cards, setCards] = useState<AutoCard[] | null>(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [allBusy, setAllBusy] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [touchedWall, setTouchedWall] = useState(false);
  const [notice, setNotice] = useState<{ name: string; kind: "guest" | "crew" } | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/people/identity-suggestions/auto?limit=12");
      if (!res.ok) return;
      const body = (await res.json()) as { cards: AutoCard[]; total: number };
      setCards(body.cards);
      setTotal(body.total);
    } catch {
      // The wall works fine without the strip.
    }
  };
  useEffect(() => {
    load();
  }, []);

  // Same advance rule as the queue: deciding inside the review moves to the
  // next card, read through a ref so a slow request never acts on a stale list.
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const advanceReview = (decidedId: string) => {
    setReviewId((cur) => {
      if (cur !== decidedId) return cur;
      const list = cardsRef.current ?? [];
      const at = list.findIndex((c) => c.id === decidedId);
      const after = list.slice(at + 1).find((c) => c.id !== decidedId);
      const before = list.slice(0, Math.max(at, 0)).reverse().find((c) => c.id !== decidedId);
      return (after ?? before)?.id ?? null;
    });
  };
  useEffect(() => {
    if (reviewId && cards && !cards.some((c) => c.id === reviewId)) setReviewId(null);
  }, [cards, reviewId]);

  const remove = (id: string) => {
    advanceReview(id);
    setCards((prev) => (prev ? prev.filter((c) => c.id !== id) : prev));
    setTotal((n) => Math.max(0, n - 1));
    if ((cardsRef.current?.length ?? 0) <= 4) load();
  };

  const looksRight = async (card: AutoCard) => {
    setBusy(card.id);
    try {
      const res = await fetch("/api/people/identity-suggestions/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reviewed", ids: [card.id] }),
      });
      if (!res.ok) throw new Error();
      remove(card.id);
    } catch {
      // Leave the card in place — a card that vanishes on a 500 is a lie.
    } finally {
      setBusy(null);
    }
  };

  const undo = async (card: AutoCard) => {
    setBusy(card.id);
    try {
      const res = await fetch("/api/people/identity-suggestions/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "undo", id: card.id }),
      });
      if (!res.ok) throw new Error();
      setNotice({ name: card.suggestedName, kind: card.kind });
      setTouchedWall(true);
      remove(card.id);
    } catch {
      // Same rule: the card stays until the server says it is gone.
    } finally {
      setBusy(null);
    }
  };

  const allLookRight = async () => {
    if (!confirm(`Mark all ${total.toLocaleString()} auto-matches as reviewed?`)) return;
    setAllBusy(true);
    try {
      const res = await fetch("/api/people/identity-suggestions/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reviewed" }),
      });
      if (res.ok) {
        setReviewId(null);
        await load();
      }
    } finally {
      setAllBusy(false);
    }
  };

  if (!cards || cards.length === 0) {
    // An undo changed the wall's counts — refresh once on the way out.
    if (touchedWall && cards && cards.length === 0) {
      router.refresh();
      setTouchedWall(false);
    }
    if (!notice) return null;
  }

  const reviewAt = reviewId ? (cards ?? []).findIndex((c) => c.id === reviewId) : -1;
  const reviewCard = reviewAt >= 0 ? cards![reviewAt] : null;

  return (
    <section className="mb-14">
      <div className="mb-5 flex items-baseline justify-between">
        <p className="label-caps">
          Auto-matched
          <span className="ml-2 normal-case tracking-normal text-stone-300">
            the archive applied these itself · {total.toLocaleString()} to
            glance at
          </span>
        </p>
        <div className="flex items-baseline gap-4">
          {total > 1 && (
            <button
              onClick={allLookRight}
              disabled={allBusy}
              title="Clears the strip. The names are already live; this only records that you looked."
              className="text-[12px] text-emerald-700 underline underline-offset-2 transition-colors hover:text-emerald-800 disabled:text-stone-300 disabled:no-underline"
            >
              {allBusy ? "Clearing…" : `All ${total.toLocaleString()} look right`}
            </button>
          )}
          {touchedWall && (
            <button
              onClick={() => {
                setTouchedWall(false);
                router.refresh();
              }}
              className="text-[12px] text-stone-400 underline transition-colors hover:text-stone-600"
            >
              Refresh the wall
            </button>
          )}
        </div>
      </div>
      {notice && (
        <p role="status" className="mb-4 text-[12px] text-stone-500">
          Took <span className="text-stone-900">{notice.name}</span> back off
          that face group
          {notice.kind === "crew" ? " and out of the crew set" : ""}. It will
          not be suggested for it again.
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss"
            className="ml-2 text-stone-400 hover:text-stone-700"
          >
            ×
          </button>
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(cards ?? []).map((card) => (
          <div key={card.id} className="border border-stone-200 bg-white p-4">
            <button
              type="button"
              onClick={() => setReviewId(card.id)}
              title="See the photos"
              className="group block w-full cursor-zoom-in text-center"
            >
              <div className="flex items-center justify-center gap-3">
                <figure className="text-center">
                  <div className="relative mx-auto h-20 w-20 overflow-hidden rounded-full bg-stone-100 ring-emerald-500/60 ring-offset-2 transition-shadow group-hover:ring-2">
                    {card.clusterFace && <FaceCircleCrop face={card.clusterFace} />}
                  </div>
                  <figcaption className="mt-1.5 max-w-[96px] truncate text-[10px] uppercase tracking-[0.14em] text-stone-400">
                    face group
                  </figcaption>
                </figure>
                <ArrowRight className="h-4 w-4 shrink-0 text-stone-300" />
                <figure className="text-center">
                  <div className="relative mx-auto h-20 w-20 overflow-hidden rounded-full bg-stone-100 ring-emerald-500/60 ring-offset-2 transition-shadow group-hover:ring-2">
                    {card.referenceFace && <FaceCircleCrop face={card.referenceFace} />}
                  </div>
                  <figcaption className="mt-1.5 max-w-[96px] truncate text-[10px] uppercase tracking-[0.14em] text-stone-400">
                    {card.suggestedName}
                  </figcaption>
                </figure>
              </div>
              <p className="mt-3 text-center text-[13px] leading-snug text-stone-700">
                Named <span className="text-stone-900">{card.suggestedName}</span>
                {card.kind === "crew" && (
                  <span
                    className="ml-1.5 align-middle rounded-full border border-stone-200 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] text-stone-500"
                    title="Linked to your crew roster — crew never join the guest index"
                  >
                    crew
                  </span>
                )}
              </p>
              <p className="mt-0.5 truncate text-center text-[11px] text-stone-400">
                {card.photoCount} photo{card.photoCount === 1 ? "" : "s"} at{" "}
                {card.eventName}
                <span className="tabular-nums"> · {Math.round(card.confidence * 100)}%</span>
              </p>
            </button>
            <div className="mt-3 flex items-center justify-center gap-x-2">
              <button
                onClick={() => looksRight(card)}
                disabled={busy === card.id}
                className="border border-emerald-200 px-3 py-1.5 text-[12px] font-medium text-emerald-700 transition-colors hover:border-emerald-500 disabled:opacity-40"
              >
                Looks right
              </button>
              <button
                onClick={() => undo(card)}
                disabled={busy === card.id}
                title="Takes the name back off this face group and blocks it from being suggested again."
                className="px-3 py-1.5 text-[12px] text-stone-400 transition-colors hover:text-stone-600 disabled:opacity-40"
              >
                Undo
              </button>
            </div>
          </div>
        ))}
      </div>
      {reviewCard && (
        <SuggestionReview
          card={reviewCard}
          busy={busy === reviewCard.id}
          copy={{
            question: `Auto-matched to ${reviewCard.suggestedName}`,
            confirm: "Looks right",
            reject: "Undo",
          }}
          onConfirm={() => looksRight(reviewCard)}
          onReject={() => undo(reviewCard)}
          onPrev={reviewAt > 0 ? () => setReviewId(cards![reviewAt - 1].id) : undefined}
          onNext={
            cards && reviewAt < cards.length - 1
              ? () => setReviewId(cards[reviewAt + 1].id)
              : undefined
          }
          onClose={() => setReviewId(null)}
        />
      )}
    </section>
  );
}
