"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Users, X } from "lucide-react";

export interface PersonFace {
  thumbnailUrl: string;
  bbox: { x: number; y: number; w: number; h: number };
  imageWidth: number | null;
  imageHeight: number | null;
}

export interface Person {
  id: string;
  name: string | null;
  faceCount: number;
  imageIds: string[];
  face: PersonFace | null;
}

interface MislabelCard {
  key: string;
  personId: string;
  personName: string;
  imageIds: string[];
  filedAs: string;
  face: PersonFace | null;
}

interface Suggestions {
  mislabels: MislabelCard[];
  merges: { key: string; fromId: string; intoId: string; name: string }[];
  refinements: {
    key: string;
    personId: string;
    currentName: string;
    fullName: string;
    supportingCount: number;
  }[];
}

/**
 * PeopleView — the editor's face grid (circle crops). Suggestions surface
 * face-vs-filename disagreements as side-by-side FACE comparisons (names
 * alone mean nothing to the photographer) with a click-through compare view.
 */
export function PeopleView({
  eventId,
  activePersonId,
  onSelectPerson,
  imageById,
  onSuggestionsCount,
}: {
  eventId: string;
  activePersonId: string | null;
  onSelectPerson: (person: Person | null) => void;
  /** imageId → thumb + filename, from the editor's already-loaded images. */
  imageById?: Map<string, { thumbnailUrl: string; filename: string }>;
  /** Reports the live suggestion count (drives the People-button badge). */
  onSuggestionsCount?: (count: number) => void;
}) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [compare, setCompare] = useState<MislabelCard | null>(null);
  // Review/name a person (face or caption click) — the one "who is this?"
  // surface; unnamed clusters open straight into the name field.
  const [reviewing, setReviewing] = useState<Person | null>(null);
  const [failed, setFailed] = useState(false);

  const reportCount = useCallback(
    (s: Suggestions | null) => {
      onSuggestionsCount?.(
        (s?.mislabels.length ?? 0) +
          (s?.merges.length ?? 0) +
          (s?.refinements.length ?? 0)
      );
    },
    [onSuggestionsCount]
  );

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await fetch(`/api/events/${eventId}/people`);
      if (!res.ok) throw new Error(`people ${res.status}`);
      const data = (await res.json()) as { people: Person[]; suggestions?: Suggestions };
      setPeople(data.people);
      setSuggestions(data.suggestions ?? null);
      reportCount(data.suggestions ?? null);
    } catch {
      setFailed(true);
      setPeople([]);
    }
  }, [eventId, reportCount]);

  useEffect(() => {
    load();
  }, [load]);

  /** Apply or dismiss a suggestion; reload on mutations that reshape people. */
  const resolve = useCallback(
    async (payload: Record<string, unknown> & { key: string }, reload: boolean) => {
      setCompare(null);
      // Optimistic: the card disappears immediately.
      setSuggestions((prev) => {
        const next = prev
          ? {
              mislabels: prev.mislabels.filter((s) => s.key !== payload.key),
              merges: prev.merges.filter((s) => s.key !== payload.key),
              refinements: prev.refinements.filter((s) => s.key !== payload.key),
            }
          : prev;
        reportCount(next);
        return next;
      });
      try {
        const res = await fetch(`/api/events/${eventId}/people/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error();
        if (reload) await load();
      } catch {
        toast.error("Couldn't apply that — try again");
        await load();
      }
    },
    [eventId, load, reportCount]
  );

  if (people === null) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="aspect-square rounded-full bg-stone-100 animate-pulse" />
        ))}
      </div>
    );
  }

  if (failed) {
    return (
      <p className="text-center py-16 text-[13px] text-stone-400">
        Couldn&apos;t load people.{" "}
        <button onClick={load} className="underline hover:text-stone-600">
          Retry
        </button>
      </p>
    );
  }

  if (!people.length) {
    return (
      <div className="flex flex-col items-center py-20 text-center">
        <Users className="h-8 w-8 text-stone-200 mb-4" />
        <p className="font-editorial text-xl text-stone-300 italic mb-2">No people yet</p>
        <p className="text-[13px] text-stone-400 max-w-sm">
          Faces group into people automatically a little while after photos
          finish uploading.
        </p>
      </div>
    );
  }

  const personOf = (id: string) => people.find((p) => p.id === id);
  const hasSuggestions =
    (suggestions?.mislabels.length ?? 0) +
      (suggestions?.merges.length ?? 0) +
      (suggestions?.refinements.length ?? 0) >
    0;

  // Named people A–Z, then the unnamed (largest first) under their own header.
  const named = people
    .filter((p) => p.name)
    .sort((a, b) => a.name!.localeCompare(b.name!, undefined, { sensitivity: "base" }));
  const unnamed = people.filter((p) => !p.name).sort((a, b) => b.faceCount - a.faceCount);

  return (
    <div>
      {/* ─── Suggestions: compare FACES, decide with one click ─── */}
      {hasSuggestions && (
        <div className="mb-10">
          <p className="text-[10px] uppercase tracking-[0.2em] text-stone-400 font-medium mb-4">
            Suggestions
          </p>
          <div className="space-y-4">
            {suggestions!.mislabels.map((s) => {
              const person = personOf(s.personId);
              return (
                <div key={s.key} className="border border-stone-200 p-4">
                  <div className="flex items-center gap-5 flex-wrap">
                    <button
                      onClick={() => setCompare(s)}
                      className="flex items-center gap-5 group"
                      title="Compare all photos"
                    >
                      <figure className="w-28 text-center">
                        <div className="relative w-28 h-28 rounded-full overflow-hidden bg-stone-100 group-hover:ring-2 group-hover:ring-stone-300 group-hover:ring-offset-2 transition-all">
                          {s.face && <FaceCrop face={s.face} />}
                        </div>
                        <figcaption className="mt-2 text-[11px] text-stone-500">
                          Filed as &ldquo;{s.filedAs}&rdquo;
                        </figcaption>
                      </figure>
                      <ArrowRight className="h-4 w-4 text-stone-300 shrink-0" />
                      <figure className="w-28 text-center">
                        <div className="relative w-28 h-28 rounded-full overflow-hidden bg-stone-100 group-hover:ring-2 group-hover:ring-stone-300 group-hover:ring-offset-2 transition-all">
                          {person?.face && <FaceCrop face={person.face} />}
                        </div>
                        <figcaption className="mt-2 text-[11px] text-stone-700">
                          {s.personName}
                          <span className="text-stone-400"> · {person?.faceCount ?? "?"}</span>
                        </figcaption>
                      </figure>
                    </button>
                    <div className="flex-1 min-w-[180px]">
                      <p className="text-[13px] text-stone-600 leading-snug">
                        Same person?{" "}
                        {s.imageIds.length === 1
                          ? "This photo is"
                          : `${s.imageIds.length} photos are`}{" "}
                        filed as{" "}
                        <span className="text-stone-900">&ldquo;{s.filedAs}&rdquo;</span> but
                        cluster with <span className="text-stone-900">{s.personName}</span>.
                      </p>
                      <button
                        onClick={() => setCompare(s)}
                        className="mt-1 text-[12px] text-stone-400 underline hover:text-stone-600 transition-colors"
                      >
                        Compare all photos
                      </button>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() =>
                          resolve(
                            { action: "fix-label", key: s.key, imageIds: s.imageIds, personId: s.personId },
                            true
                          )
                        }
                        className="px-3 py-1.5 text-[12px] font-medium text-emerald-700 border border-emerald-200 hover:border-emerald-500 transition-colors"
                      >
                        Confirm match
                      </button>
                      <button
                        onClick={() => resolve({ action: "dismiss", key: s.key }, false)}
                        className="px-3 py-1.5 text-[12px] text-stone-400 hover:text-stone-600 transition-colors"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {suggestions!.refinements.map((s) => (
              <div key={s.key} className="border border-stone-200 p-4">
                <div className="flex items-center gap-5 flex-wrap">
                  <p className="flex-1 min-w-[180px] text-[13px] text-stone-600 leading-snug">
                    {s.supportingCount} of <span className="text-stone-900">{s.currentName}</span>&apos;s
                    files use the fuller name{" "}
                    <span className="text-stone-900">&ldquo;{s.fullName}&rdquo;</span> — names
                    get truncated, not invented.
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() =>
                        resolve(
                          {
                            action: "refine-name",
                            key: s.key,
                            personId: s.personId,
                            fullName: s.fullName,
                          },
                          true
                        )
                      }
                      className="px-3 py-1.5 text-[12px] font-medium text-emerald-700 border border-emerald-200 hover:border-emerald-500 transition-colors"
                    >
                      Use full name
                    </button>
                    <button
                      onClick={() => resolve({ action: "dismiss", key: s.key }, false)}
                      className="px-3 py-1.5 text-[12px] text-stone-400 hover:text-stone-600 transition-colors"
                    >
                      Keep current
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {suggestions!.merges.map((s) => {
              const from = personOf(s.fromId);
              const into = personOf(s.intoId);
              return (
                <div key={s.key} className="border border-stone-200 p-4">
                  <div className="flex items-center gap-5 flex-wrap">
                    <div className="flex items-center gap-5">
                      {[from, into].map((p, i) =>
                        p ? (
                          <figure key={p.id} className="w-28 text-center">
                            <div className="relative w-28 h-28 rounded-full overflow-hidden bg-stone-100">
                              {p.face && <FaceCrop face={p.face} />}
                            </div>
                            <figcaption className="mt-2 text-[11px] text-stone-500">
                              {s.name}
                              <span className="text-stone-400"> · {p.faceCount}</span>
                            </figcaption>
                          </figure>
                        ) : (
                          <div key={i} className="w-28 h-28 rounded-full bg-stone-100" />
                        )
                      )}
                    </div>
                    <p className="flex-1 min-w-[180px] text-[13px] text-stone-600 leading-snug">
                      <span className="text-stone-900">{s.name}</span> appears as two
                      separate people — same person?
                    </p>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() =>
                          resolve({ action: "merge", key: s.key, fromId: s.fromId, intoId: s.intoId }, true)
                        }
                        className="px-3 py-1.5 text-[12px] font-medium text-emerald-700 border border-emerald-200 hover:border-emerald-500 transition-colors"
                      >
                        Merge
                      </button>
                      <button
                        onClick={() => resolve({ action: "dismiss", key: s.key }, false)}
                        className="px-3 py-1.5 text-[12px] text-stone-400 hover:text-stone-600 transition-colors"
                      >
                        Keep separate
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── People grid: named A–Z, then unnamed ─── */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-4 gap-y-7">
        {named.map((person) => (
          <PersonCard
            key={person.id}
            person={person}
            active={person.id === activePersonId}
            onClick={() =>
              person.name
                ? onSelectPerson(person.id === activePersonId ? null : person)
                : setReviewing(person)
            }
            onOpenModal={() => setReviewing(person)}
          />
        ))}
      </div>
      {unnamed.length > 0 && (
        <>
          <p className="mt-10 mb-4 text-[10px] uppercase tracking-[0.2em] text-stone-400 font-medium">
            Unnamed · {unnamed.length}
          </p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-4 gap-y-7">
            {unnamed.map((person) => (
              <PersonCard
                key={person.id}
                person={person}
                active={person.id === activePersonId}
                onClick={() =>
                  person.name
                    ? onSelectPerson(person.id === activePersonId ? null : person)
                    : setReviewing(person)
                }
                onOpenModal={() => setReviewing(person)}
              />
            ))}
          </div>
        </>
      )}

      {/* ─── Review & name a person ─── */}
      {reviewing && (
        <PersonModal
          personId={reviewing.id}
          personName={reviewing.name}
          imageIds={reviewing.imageIds}
          imageById={imageById}
          onSaved={(name) => {
            setPeople((prev) =>
              prev ? prev.map((p) => (p.id === reviewing.id ? { ...p, name } : p)) : prev
            );
            setReviewing(null);
            load(); // names can resolve/raise suggestions (merges, refinements)
          }}
          onClose={() => setReviewing(null)}
        />
      )}

      {/* ─── Compare view: the photo in question vs everything of theirs ─── */}
      {compare && (
        <CompareModal
          card={compare}
          person={personOf(compare.personId) ?? null}
          imageById={imageById}
          onFix={() =>
            resolve(
              {
                action: "fix-label",
                key: compare.key,
                imageIds: compare.imageIds,
                personId: compare.personId,
              },
              true
            )
          }
          onDismiss={() => resolve({ action: "dismiss", key: compare.key }, false)}
          onRenamed={() => load()}
          onClose={() => setCompare(null)}
        />
      )}
    </div>
  );
}

function CompareModal({
  card,
  person,
  imageById,
  onFix,
  onDismiss,
  onRenamed,
  onClose,
}: {
  card: MislabelCard;
  person: Person | null;
  imageById?: Map<string, { thumbnailUrl: string; filename: string }>;
  onFix: () => void;
  onDismiss: () => void;
  onRenamed: () => void;
  onClose: () => void;
}) {
  const questionIds = new Set(card.imageIds);
  const otherIds = (person?.imageIds ?? []).filter((id) => !questionIds.has(id));
  const [showFilenames, setShowFilenames] = useState(true);
  // Inline rename of the person — sometimes neither existing name is right
  // and the fix is typing the correct one, independent of any merge.
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(card.personName);
  const saveRename = async () => {
    setRenaming(false);
    const name = nameDraft.trim();
    if (!name || name === card.personName) return;
    try {
      const res = await fetch(`/api/people/${card.personId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error();
      onRenamed();
    } catch {
      toast.error("Couldn't save the name");
    }
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl max-h-[85vh] bg-white p-8 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Actions pinned top-right — never wrapping, never scrolled away. */}
        <div className="flex items-start gap-6 mb-6">
          <div className="flex-1 min-w-0">
            {renaming ? (
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={saveRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveRename();
                  if (e.key === "Escape") setRenaming(false);
                }}
                className="font-editorial text-2xl text-stone-900 bg-transparent border-b border-stone-300 focus:border-stone-900 focus:outline-none w-full max-w-sm"
              />
            ) : (
              <h2 className="font-editorial text-2xl text-stone-900">
                Is this {card.personName}?{" "}
                <button
                  onClick={() => {
                    setNameDraft(card.personName);
                    setRenaming(true);
                  }}
                  className="align-middle ml-1 text-[12px] font-sans text-stone-400 underline hover:text-stone-600 transition-colors"
                >
                  rename
                </button>
              </h2>
            )}
            <p className="text-[13px] text-stone-500 mt-1">
              Filed as &ldquo;{card.filedAs}&rdquo; — compare against every photo of{" "}
              {card.personName}.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={onDismiss}
              className="px-4 py-2 text-[13px] text-stone-400 hover:text-stone-600 transition-colors"
            >
              Dismiss
            </button>
            <button
              onClick={onFix}
              className="px-5 py-2 text-[13px] font-medium text-white bg-stone-900 hover:bg-stone-700 transition-colors"
            >
              Confirm match
            </button>
            <button
              onClick={onClose}
              className="p-1 ml-1 text-stone-300 hover:text-stone-600 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Split panes: the reference photo stays put, only the person's
            grid scrolls — scrolling must never lose the thing being compared. */}
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="min-h-0 flex flex-col">
            <p className="text-[10px] uppercase tracking-[0.2em] text-stone-400 font-medium mb-3 shrink-0">
              {card.imageIds.length === 1
                ? "The photo in question"
                : `${card.imageIds.length} photos in question`}
            </p>
            {/* Full frames, not crops — context matters for the call. Scrolls
                on its own when the group is large. */}
            <div className="min-h-0 overflow-y-auto pr-1 space-y-3">
              {card.imageIds.map((id) => {
                const entry = imageById?.get(id);
                return (
                  <figure key={id}>
                    {entry ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={entry.thumbnailUrl} alt="" className="w-full bg-stone-100" />
                    ) : card.face && id === card.imageIds[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={card.face.thumbnailUrl} alt="" className="w-full bg-stone-100" />
                    ) : (
                      <div className="aspect-[3/4] bg-stone-100" />
                    )}
                    {showFilenames && entry?.filename && (
                      <figcaption className="mt-1 text-[11px] text-stone-400 truncate">
                        {entry.filename}
                      </figcaption>
                    )}
                  </figure>
                );
              })}
            </div>
          </div>
          <div className="min-h-0 flex flex-col">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <p className="text-[10px] uppercase tracking-[0.2em] text-stone-400 font-medium">
                {card.personName} · {otherIds.length} other photo{otherIds.length === 1 ? "" : "s"}
              </p>
              <button
                onClick={() => setShowFilenames((v) => !v)}
                className={`text-[11px] transition-colors ${
                  showFilenames ? "text-stone-600" : "text-stone-300 hover:text-stone-500"
                }`}
              >
                Filenames
              </button>
            </div>
            <div className="min-h-0 overflow-y-auto pr-1">
              <div className="grid grid-cols-3 gap-x-1.5 gap-y-2">
                {otherIds.map((id) => {
                  const entry = imageById?.get(id);
                  return (
                    <figure key={id}>
                      {entry ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={entry.thumbnailUrl}
                          alt=""
                          loading="lazy"
                          className="aspect-square w-full object-cover object-top bg-stone-100"
                        />
                      ) : (
                        <div className="aspect-square bg-stone-100" />
                      )}
                      {showFilenames && entry?.filename && (
                        <figcaption className="mt-0.5 text-[9px] leading-tight text-stone-400 truncate">
                          {entry.filename}
                        </figcaption>
                      )}
                    </figure>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

function PersonCard({
  person,
  active,
  onClick,
  onOpenModal,
}: {
  person: Person;
  active: boolean;
  onClick: () => void;
  onOpenModal: () => void;
}) {
  return (
    <div className="group text-center">
      <button
        onClick={onClick}
        className={`relative block w-full aspect-square rounded-full overflow-hidden bg-stone-100 transition-all duration-300 ${
          active
            ? "ring-2 ring-accent ring-offset-2"
            : "hover:ring-1 hover:ring-stone-300 hover:ring-offset-2"
        }`}
      >
        {person.face ? <FaceCrop face={person.face} /> : null}
      </button>
      <button
        onClick={onOpenModal}
        title={person.name ? "Review & rename" : "Review & name"}
        className="mt-2 block w-full truncate text-[12px] transition-colors"
      >
        {person.name ? (
          <span className="text-stone-700 group-hover:text-stone-900">
            {person.name} <span className="text-stone-400">· {person.faceCount}</span>
          </span>
        ) : (
          <span className="text-stone-300 italic hover:text-stone-500">
            Add name <span className="not-italic">· {person.faceCount}</span>
          </span>
        )}
      </button>
    </div>
  );
}

/**
 * PersonModal — review a person's photos (with filenames) and set their name.
 * The one surface for "who is this?": unnamed clusters open straight into the
 * name field; named people open in review mode with rename a click away.
 * Shared by the People view (face/caption clicks) and the grid's person chip.
 */
export function PersonModal({
  personId,
  personName,
  imageIds,
  imageById,
  startEditing,
  onSaved,
  onClose,
}: {
  personId: string;
  personName: string | null;
  imageIds: string[];
  imageById?: Map<string, { thumbnailUrl: string; filename: string }>;
  startEditing?: boolean;
  onSaved: (name: string) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(startEditing ?? !personName);
  const [draft, setDraft] = useState(personName ?? "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const save = async () => {
    const name = draft.trim();
    if (!name || name === personName) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/people/${personId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error();
      onSaved(name);
      setEditing(false);
    } catch {
      toast.error("Couldn't save the name");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[85vh] bg-white p-8 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-6 mb-6 shrink-0">
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="flex items-center gap-3">
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") save();
                    if (e.key === "Escape") setEditing(false);
                  }}
                  placeholder="Type their name…"
                  className="font-editorial text-2xl text-stone-900 bg-transparent border-b border-stone-300 focus:border-stone-900 focus:outline-none w-full max-w-sm placeholder:text-stone-300"
                />
                <button
                  onClick={save}
                  disabled={saving || !draft.trim()}
                  className="px-4 py-1.5 text-[13px] font-medium text-white bg-stone-900 hover:bg-stone-700 transition-colors disabled:opacity-40 shrink-0"
                >
                  Save
                </button>
              </div>
            ) : (
              <h2 className="font-editorial text-2xl text-stone-900">
                {personName ?? "Unnamed person"}{" "}
                <button
                  onClick={() => {
                    setDraft(personName ?? "");
                    setEditing(true);
                  }}
                  className="align-middle ml-1 text-[12px] font-sans text-stone-400 underline hover:text-stone-600 transition-colors"
                >
                  rename
                </button>
              </h2>
            )}
            <p className="text-[13px] text-stone-500 mt-1">
              {imageIds.length} photo{imageIds.length === 1 ? "" : "s"} — filenames
              often reveal who this is.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-stone-300 hover:text-stone-600 transition-colors shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto pr-1">
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-x-1.5 gap-y-2">
            {imageIds.map((id) => {
              const entry = imageById?.get(id);
              return (
                <figure key={id}>
                  {entry ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={entry.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      className="aspect-square w-full object-cover object-top bg-stone-100"
                    />
                  ) : (
                    <div className="aspect-square bg-stone-100" />
                  )}
                  {entry?.filename && (
                    <figcaption className="mt-0.5 text-[9px] leading-tight text-stone-400 truncate">
                      {entry.filename}
                    </figcaption>
                  )}
                </figure>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Zoomed face crop inside a (circular) window: position the thumbnail so the
 * face box sits centered at ~half the tile. Pure CSS percentages.
 */
function FaceCrop({ face }: { face: PersonFace }) {
  const W = face.imageWidth ?? 800;
  const H = face.imageHeight ?? 533;
  const { x, y, w, h } = face.bbox;
  const winPx = Math.min(Math.max(w * W, h * H) * 2, Math.min(W, H));
  const widthPct = (W / winPx) * 100;
  const heightPct = (H / winPx) * 100;
  const cx = (x + w / 2) * W;
  const cy = (y + h / 2) * H;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const leftPct = clamp(50 - (cx / winPx) * 100, 100 - widthPct, 0);
  const topPct = clamp(50 - (cy / winPx) * 100, 100 - heightPct, 0);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={face.thumbnailUrl}
      alt=""
      loading="lazy"
      className="absolute max-w-none"
      style={{
        width: `${widthPct}%`,
        height: `${heightPct}%`,
        left: `${leftPct}%`,
        top: `${topPct}%`,
      }}
    />
  );
}
