"use client";

/**
 * The naming engine's snack tray — "Who is this?" cards on /people.
 *
 * Each card is one anonymous face cluster the engine matched to a known
 * person with high confidence: the cluster's face beside the known person's
 * face, decided on FACES, one click per cluster. Confirm names the cluster
 * (its group shots flow onto the person's card through the live plumbing);
 * "Not them" is durable — the engine never re-asks that name of that cluster.
 *
 * Deliberately NOT an inbox: renders nothing when the queue is empty, sorts
 * by payoff (biggest clusters first), and leaving it untouched costs nothing
 * but unharvested group shots.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";

import { FaceCircleCrop, type FaceCropGeometry } from "@/components/faces/FaceCircleCrop";

interface SuggestionCard {
  id: string;
  personId: string;
  eventId: string;
  eventName: string;
  /** crew = confirming creates a crew LINK, never a persons.name write. */
  kind: "guest" | "crew";
  suggestedName: string;
  confidence: number;
  photoCount: number;
  clusterFace: FaceCropGeometry | null;
  referenceFace: FaceCropGeometry | null;
}

export function IdentitySuggestions() {
  const router = useRouter();
  const [cards, setCards] = useState<SuggestionCard[] | null>(null);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmedAny, setConfirmedAny] = useState(false);

  const load = async () => {
    try {
      const res = await fetch("/api/people/identity-suggestions?limit=8");
      if (!res.ok) return;
      const body = (await res.json()) as {
        suggestions: SuggestionCard[];
        pendingTotal: number;
      };
      setCards(body.suggestions);
      setPendingTotal(body.pendingTotal);
    } catch {
      // The wall works fine without the tray.
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decide = async (card: SuggestionCard, action: "confirm" | "reject") => {
    setBusy(card.id);
    try {
      const res = await fetch("/api/people/identity-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: card.id, action }),
      });
      if (!res.ok) throw new Error();
      setCards((prev) => (prev ? prev.filter((c) => c.id !== card.id) : prev));
      setPendingTotal((n) => Math.max(0, n - 1));
      if (action === "confirm") setConfirmedAny(true);
      // Refill the tray as cards leave it.
      if ((cards?.length ?? 0) <= 3) load();
    } catch {
      // Leave the card in place — a card that vanishes on a 500 is a lie.
    } finally {
      setBusy(null);
    }
  };

  if (!cards || cards.length === 0) {
    // Confirms change the wall's counts — refresh once on the way out rather
    // than on every click, so the tray stays snappy mid-run.
    if (confirmedAny && cards && cards.length === 0) {
      router.refresh();
      setConfirmedAny(false);
    }
    return null;
  }

  return (
    <section className="mb-14">
      <div className="mb-5 flex items-baseline justify-between">
        <p className="label-caps">
          Who is this?
          <span className="ml-2 normal-case tracking-normal text-stone-300">
            the archive thinks it knows · {pendingTotal.toLocaleString()} waiting
          </span>
        </p>
        {confirmedAny && (
          <button
            onClick={() => {
              setConfirmedAny(false);
              router.refresh();
            }}
            className="text-[12px] text-stone-400 underline transition-colors hover:text-stone-600"
          >
            Refresh the wall
          </button>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.id} className="border border-stone-200 bg-white p-4">
            <div className="flex items-center justify-center gap-3">
              <figure className="text-center">
                <div className="relative mx-auto h-20 w-20 overflow-hidden rounded-full bg-stone-100">
                  {card.clusterFace && <FaceCircleCrop face={card.clusterFace} />}
                </div>
                <figcaption className="mt-1.5 text-[10px] uppercase tracking-[0.14em] text-stone-400">
                  unnamed
                </figcaption>
              </figure>
              <ArrowRight className="h-4 w-4 shrink-0 text-stone-300" />
              <figure className="text-center">
                <div className="relative mx-auto h-20 w-20 overflow-hidden rounded-full bg-stone-100">
                  {card.referenceFace && <FaceCircleCrop face={card.referenceFace} />}
                </div>
                <figcaption className="mt-1.5 max-w-[96px] truncate text-[10px] uppercase tracking-[0.14em] text-stone-400">
                  {card.suggestedName}
                </figcaption>
              </figure>
            </div>
            <p className="mt-3 text-center text-[13px] leading-snug text-stone-700">
              Is this <span className="text-stone-900">{card.suggestedName}</span>?
              {card.kind === "crew" && (
                <span
                  className="ml-1.5 align-middle rounded-full border border-stone-200 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] text-stone-500"
                  title="Confirming links this face to your crew roster — crew never join the guest index"
                >
                  crew
                </span>
              )}
            </p>
            <p className="mt-0.5 truncate text-center text-[11px] text-stone-400">
              {card.photoCount} photo{card.photoCount === 1 ? "" : "s"} at {card.eventName}
            </p>
            <div className="mt-3 flex items-center justify-center gap-2">
              <button
                onClick={() => decide(card, "confirm")}
                disabled={busy === card.id}
                className="border border-emerald-200 px-3 py-1.5 text-[12px] font-medium text-emerald-700 transition-colors hover:border-emerald-500 disabled:opacity-40"
              >
                Confirm
              </button>
              <button
                onClick={() => decide(card, "reject")}
                disabled={busy === card.id}
                className="px-3 py-1.5 text-[12px] text-stone-400 transition-colors hover:text-stone-600 disabled:opacity-40"
              >
                Not them
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
