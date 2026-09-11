"use client";

/**
 * The naming engine's snack tray — "Who is this?" cards on /people.
 *
 * Each card is one anonymous face cluster the engine matched to a known
 * person with high confidence: the cluster's face beside the known person's
 * face, decided on FACES, one click per cluster. Confirm names the cluster
 * (its group shots flow onto the person's card through the live plumbing);
 * "Not them" is durable — the engine never re-asks that name of that cluster.
 * "Not a person" is for a suggested name that is a label, not a human ("Weka
 * SKO27", a gallery name every file carried): one click removes it
 * everywhere and clears every card offering it, with an undo.
 *
 * Deliberately NOT an inbox: renders nothing when the queue is empty, sorts
 * least-confident first (those are the ones that need a person), and leaving
 * it untouched costs nothing but unharvested group shots.
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
  /** A junk label the confirm will clear ("Marriott Green" on Christie). */
  currentName?: string | null;
  suggestedName: string;
  confidence: number;
  photoCount: number;
  clusterFace: FaceCropGeometry | null;
  referenceFace: FaceCropGeometry | null;
}

/** Mirrors SURE_CONFIDENCE in the API route. Measured: true-match median
 *  0.886, impostor max 0.363. */
const SURE = 0.9;

export function IdentitySuggestions() {
  const router = useRouter();
  const [cards, setCards] = useState<SuggestionCard[] | null>(null);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmedAny, setConfirmedAny] = useState(false);
  const [sureCount, setSureCount] = useState(0);
  const [bulkBusy, setBulkBusy] = useState(false);
  /** The last "Not a person", held for its undo. */
  const [notice, setNotice] = useState<{
    key: string;
    name: string;
    clearedSuggestions: number;
    clearedClusters: number;
    undone?: boolean;
  } | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/people/identity-suggestions?limit=8");
      if (!res.ok) return;
      const body = (await res.json()) as {
        sureTotal?: number;
        suggestions: SuggestionCard[];
        pendingTotal: number;
      };
      setCards(body.suggestions);
      setPendingTotal(body.pendingTotal);
      setSureCount(body.sureTotal ?? 0);
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

  // One click for a name that labels a gallery rather than a person — it
  // clears every card offering it at once, so the tray reloads rather than
  // dropping a single card.
  const notAPerson = async (card: SuggestionCard) => {
    setBusy(card.id);
    try {
      const res = await fetch("/api/people/exclude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: card.suggestedName,
          reason: `Suggestion card, ${card.eventName}`,
        }),
      });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as {
        key: string;
        name: string;
        clearedSuggestions: number;
        clearedClusters: number;
      };
      setNotice(body);
      await load();
      router.refresh();
    } catch {
      // Leave the cards in place — a card that vanishes on a 500 is a lie.
    } finally {
      setBusy(null);
    }
  };

  const undoNotAPerson = async () => {
    if (!notice) return;
    const res = await fetch(`/api/people/exclude?key=${encodeURIComponent(notice.key)}`, {
      method: "DELETE",
    });
    if (!res.ok) return;
    // The cards come back when the engine next scans those events, not now —
    // say so, rather than leave an empty tray looking like the undo failed.
    setNotice({ ...notice, undone: true });
    router.refresh();
  };

  if (!cards || cards.length === 0) {
    // Confirms change the wall's counts — refresh once on the way out rather
    // than on every click, so the tray stays snappy mid-run.
    if (confirmedAny && cards && cards.length === 0) {
      router.refresh();
      setConfirmedAny(false);
    }
    // A "Not a person" can empty the tray; its undo must outlive the cards.
    if (!notice) return null;
  }

  const confirmSure = async () => {
    if (!confirm(`Confirm ${sureCount} matches the archive is at least ${Math.round(SURE * 100)}% sure about?`)) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/people/identity-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", minConfidence: SURE }),
      });
      if (res.ok) {
        setConfirmedAny(true);
        await load();
        router.refresh();
      }
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <section className="mb-14">
      <div className="mb-5 flex items-baseline justify-between">
        <p className="label-caps">
          Who is this?
          <span className="ml-2 normal-case tracking-normal text-stone-300">
            the archive thinks it knows · {pendingTotal.toLocaleString()} waiting
          </span>
        </p>
        <div className="flex items-baseline gap-4">
          {/* The wall is sorted LEAST confident first, so the cards on screen are
              the ones that need a person. This clears the near-certain tail in
              one deliberate act rather than 192 reflexive clicks — a human still
              applies it, which is the invariant that matters. */}
          {sureCount > 1 && (
            <button
              onClick={confirmSure}
              disabled={bulkBusy}
              title={`Confirms every pending match at ${Math.round(SURE * 100)}% confidence or higher. Measured floor for a true match is 0.55; impostors topped out at 0.363.`}
              className="text-[12px] text-emerald-700 underline underline-offset-2 transition-colors hover:text-emerald-800 disabled:text-stone-300 disabled:no-underline"
            >
              {bulkBusy ? "Confirming…" : `Confirm the ${sureCount.toLocaleString()} above ${Math.round(SURE * 100)}%`}
            </button>
          )}
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
      </div>
      {notice && (
        <p role="status" className="mb-4 text-[12px] text-stone-500">
          {notice.undone ? (
            <>
              Put <span className="text-stone-900">{notice.name}</span> back. Its suggestions
              return when those events are next scanned.
            </>
          ) : (
            <>
              <span className="text-stone-900">{notice.name}</span> is not a person — cleared{" "}
              {notice.clearedSuggestions} suggestion{notice.clearedSuggestions === 1 ? "" : "s"}
              {notice.clearedClusters > 0 &&
                ` and took the name off ${notice.clearedClusters} face group${notice.clearedClusters === 1 ? "" : "s"}`}
              .
              <button
                type="button"
                onClick={undoNotAPerson}
                className="ml-2 text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
              >
                Undo
              </button>
            </>
          )}
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
            <div className="flex items-center justify-center gap-3">
              <figure className="text-center">
                <div className="relative mx-auto h-20 w-20 overflow-hidden rounded-full bg-stone-100">
                  {card.clusterFace && <FaceCircleCrop face={card.clusterFace} />}
                </div>
                <figcaption
                  className="mt-1.5 max-w-[96px] truncate text-[10px] uppercase tracking-[0.14em] text-stone-400"
                  title={card.currentName ? `Filed as "${card.currentName}" — confirming clears it` : undefined}
                >
                  {card.currentName ? `"${card.currentName}"` : "unnamed"}
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
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
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
              {/* Crew are real people by construction — only a filename-born
                  guest name can be a label. */}
              {card.kind === "guest" && (
                <button
                  onClick={() => notAPerson(card)}
                  disabled={busy === card.id}
                  title={`"${card.suggestedName}" is a label, not a human. Removes the name everywhere and clears every card offering it. Undoable.`}
                  className="px-1 py-1.5 text-[12px] text-stone-400 transition-colors hover:text-stone-600 disabled:opacity-40"
                >
                  Not a person
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
