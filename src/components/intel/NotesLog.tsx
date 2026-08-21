"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Pin, X } from "lucide-react";
import { NoteComposer } from "./NoteComposer";
import type { ComboValue } from "./Combobox";
import type { IntelNote, NoteScope } from "@/lib/intel-notes/store";

/**
 * The notes & BTS log for one subject — a venue, a client, or a gig.
 *
 * Photos first as a strip (a loading dock is recognised faster than it is
 * described), then the dated log. Pinned entries sit above the rest in both.
 * Every entry says which gig taught it, because "loading dock on 5th" means
 * something different in 2019 and 2026.
 *
 * INTERNAL — rendered only on intel surfaces behind `getIntelUser()`.
 */

const META = "text-[11px] uppercase tracking-[0.14em] text-stone-400";

export function NotesLog({
  scope,
  eventId,
  venue,
  client,
  lockVenue,
  lockClient,
  blank,
}: {
  scope: NoteScope;
  /** Composer defaults — what this page already knows. */
  eventId?: string;
  venue?: ComboValue | null;
  client?: ComboValue | null;
  lockVenue?: boolean;
  lockClient?: boolean;
  blank: React.ReactNode;
}) {
  const [notes, setNotes] = useState<IntelNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  const scopeKey = JSON.stringify(scope);
  const load = useCallback(async () => {
    try {
      const sp = new URLSearchParams(scope as Record<string, string>);
      const res = await fetch(`/api/intel/notes?${sp}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Could not load");
      setNotes(j.notes);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);
  useEffect(() => { setNotes(null); setAdding(false); setOpen(null); void load(); }, [load]);

  const patch = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/intel/notes/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const j = await res.json();
    if (!res.ok) { setError(j.error ?? "Could not save"); return; }
    setNotes((xs) => sortNotes((xs ?? []).map((n) => (n.id === id ? (j.note as IntelNote) : n))));
  };
  const remove = async (id: string) => {
    if (!confirm("Delete this entry? The photo goes with it.")) return;
    const res = await fetch(`/api/intel/notes/${id}`, { method: "DELETE" });
    if (!res.ok) { setError("Could not delete"); return; }
    setNotes((xs) => (xs ?? []).filter((n) => n.id !== id));
    setOpen(null);
  };

  const photos = (notes ?? []).filter((n) => n.thumbUrl);
  const texts = (notes ?? []).filter((n) => !n.thumbUrl);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className={META}>
          Notes &amp; behind the scenes
          {notes && notes.length > 0 && <span className="ml-2 normal-case tracking-normal text-stone-300">{notes.length}</span>}
        </span>
        {!adding && (
          <button onClick={() => setAdding(true)} className="text-[12px] text-stone-500 underline underline-offset-4 hover:text-stone-800">
            Add
          </button>
        )}
      </div>

      {adding && (
        <div className="mt-3">
          <NoteComposer
            eventId={eventId}
            venue={venue}
            client={client}
            lockVenue={lockVenue}
            lockClient={lockClient}
            onSaved={(fresh) => {
              setAdding(false);
              // The composer may have tagged some entries away from this page;
              // a refetch is the honest list rather than a guess at the filter.
              void load();
              if (!fresh.length) return;
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {error && <p className="mt-3 text-[12px] text-red-700">{error}</p>}
      {notes === null && !error && <p className="mt-3 text-[13px] text-stone-400">Loading…</p>}
      {notes && notes.length === 0 && !adding && (
        <p className="mt-3 text-[13px] leading-relaxed text-stone-400">{blank}</p>
      )}

      {photos.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {photos.map((n) => {
            const i = photos.indexOf(n);
            const ar = n.width && n.height ? n.width / n.height : 4 / 3;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => setOpen(i)}
                  className="group relative block h-24 overflow-hidden rounded bg-stone-100 sm:h-28"
                  style={{ width: `${Math.max(64, Math.min(220, Math.round(112 * ar)))}px` }}
                  title={n.body ?? undefined}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={n.thumbUrl!} alt={n.body ?? ""} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                  {n.pinned && <Pin className="absolute right-1.5 top-1.5 h-3.5 w-3.5 text-white drop-shadow" />}
                  {n.body && (
                    <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-stone-950/70 to-transparent px-2 pb-1 pt-4 text-left text-[11px] text-white">
                      {n.body}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {texts.length > 0 && (
        <ul className="mt-3 divide-y divide-stone-100">
          {texts.map((n) => (
            <TextEntry key={n.id} n={n} scope={scope} onPatch={patch} onDelete={remove} />
          ))}
        </ul>
      )}

      {open !== null && photos[open] && (
        <Lightbox
          n={photos[open]}
          scope={scope}
          hasPrev={open > 0}
          hasNext={open < photos.length - 1}
          onPrev={() => setOpen((i) => (i ?? 0) - 1)}
          onNext={() => setOpen((i) => (i ?? 0) + 1)}
          onClose={() => setOpen(null)}
          onPatch={patch}
          onDelete={remove}
        />
      )}
    </div>
  );
}

function sortNotes(xs: IntelNote[]): IntelNote[] {
  return [...xs].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));
}

function when(n: IntelNote): string {
  const d = n.takenAt ?? n.createdAt;
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Provenance line: when, from which gig, about whom — minus what the page already is. */
function Provenance({ n, scope }: { n: IntelNote; scope: NoteScope }) {
  const onVenue = "venueId" in scope;
  const onClient = "orgId" in scope;
  const onEvent = "eventId" in scope;
  return (
    <span className="text-[12px] text-stone-400">
      {when(n)}
      {n.event && !onEvent && (
        <> · <Link href={`/events/${n.event.id}`} className="underline-offset-4 hover:text-stone-700 hover:underline">{n.event.name}</Link></>
      )}
      {n.venue && !onVenue && n.aboutVenue && <> · {n.venue.name}</>}
      {n.org && !onClient && n.aboutClient && <> · {n.org.name}</>}
    </span>
  );
}

function Tags({ n, onPatch }: { n: IntelNote; onPatch: (id: string, b: Record<string, unknown>) => Promise<void> }) {
  const cls = (on: boolean) =>
    `rounded-full border px-2 py-0.5 text-[11px] transition-colors ${on ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-stone-200 text-stone-400 hover:border-stone-300"}`;
  return (
    <span className="inline-flex gap-1.5">
      <button type="button" className={cls(n.aboutVenue)} onClick={() => void onPatch(n.id, { aboutVenue: !n.aboutVenue })} disabled={!n.venueId} title={n.venueId ? "About the venue" : "No venue on this entry"}>Venue</button>
      <button type="button" className={cls(n.aboutClient)} onClick={() => void onPatch(n.id, { aboutClient: !n.aboutClient })} disabled={!n.orgId} title={n.orgId ? "About the client" : "No client on this entry"}>Client</button>
    </span>
  );
}

function Actions({ n, onPatch, onDelete, editing, setEditing }: {
  n: IntelNote;
  onPatch: (id: string, b: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  editing: boolean;
  setEditing: (b: boolean) => void;
}) {
  const a = "text-[12px] text-stone-400 underline-offset-4 hover:text-stone-800 hover:underline";
  return (
    <span className="inline-flex items-center gap-3">
      <button type="button" className={a} onClick={() => void onPatch(n.id, { pinned: !n.pinned })}>{n.pinned ? "Unpin" : "Pin"}</button>
      {!editing && <button type="button" className={a} onClick={() => setEditing(true)}>{n.body ? "Edit" : "Caption"}</button>}
      <button type="button" className={`${a} hover:text-red-700`} onClick={() => void onDelete(n.id)}>Delete</button>
    </span>
  );
}

function CaptionEditor({ n, onPatch, onDone }: { n: IntelNote; onPatch: (id: string, b: Record<string, unknown>) => Promise<void>; onDone: () => void }) {
  const [v, setV] = useState(n.body ?? "");
  return (
    <div className="mt-2">
      <textarea
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        rows={2}
        onKeyDown={(e) => { if (e.key === "Escape") onDone(); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { void onPatch(n.id, { body: v }).then(onDone); } }}
        className="w-full rounded-md border border-stone-200 px-3 py-2 text-[13px] leading-relaxed text-stone-900 focus:border-stone-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
      />
      <div className="mt-2 flex gap-3">
        <button type="button" onClick={() => void onPatch(n.id, { body: v }).then(onDone)} className="rounded-md border border-stone-800 bg-stone-900 px-3 py-1 text-[12px] text-white">Save</button>
        <button type="button" onClick={onDone} className="text-[12px] text-stone-500 hover:text-stone-800">Cancel</button>
      </div>
    </div>
  );
}

function TextEntry({ n, scope, onPatch, onDelete }: {
  n: IntelNote; scope: NoteScope;
  onPatch: (id: string, b: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="py-3">
      <div className="flex items-start gap-2">
        {n.pinned && <Pin className="mt-1 h-3.5 w-3.5 shrink-0 text-stone-400" />}
        <div className="min-w-0 flex-1">
          {editing ? (
            <CaptionEditor n={n} onPatch={onPatch} onDone={() => setEditing(false)} />
          ) : (
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-stone-800">{n.body}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Provenance n={n} scope={scope} />
            <Tags n={n} onPatch={onPatch} />
            <Actions n={n} onPatch={onPatch} onDelete={onDelete} editing={editing} setEditing={setEditing} />
          </div>
        </div>
      </div>
    </li>
  );
}

function Lightbox({ n, scope, hasPrev, hasNext, onPrev, onNext, onClose, onPatch, onDelete }: {
  n: IntelNote; scope: NoteScope;
  hasPrev: boolean; hasNext: boolean;
  onPrev: () => void; onNext: () => void; onClose: () => void;
  onPatch: (id: string, b: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing) return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && hasPrev) onPrev();
      if (e.key === "ArrowRight" && hasNext) onNext();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [editing, hasPrev, hasNext, onPrev, onNext, onClose]);
  useEffect(() => setEditing(false), [n.id]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-stone-950/95 sm:flex-row" onClick={onClose}>
      <div className="relative flex flex-1 items-center justify-center p-3 sm:p-8" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={n.imageUrl ?? n.thumbUrl!} alt={n.body ?? ""} className="max-h-full max-w-full rounded object-contain" />
        {hasPrev && (
          <button type="button" onClick={onPrev} aria-label="Previous" className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-stone-900/60 p-2 text-white hover:bg-stone-900">
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        {hasNext && (
          <button type="button" onClick={onNext} aria-label="Next" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-stone-900/60 p-2 text-white hover:bg-stone-900">
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>
      <aside className="w-full shrink-0 bg-white p-4 sm:w-80 sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <span className={META}>Behind the scenes</span>
          <button type="button" onClick={onClose} aria-label="Close" className="text-stone-400 hover:text-stone-800"><X className="h-5 w-5" /></button>
        </div>
        {editing ? (
          <CaptionEditor n={n} onPatch={onPatch} onDone={() => setEditing(false)} />
        ) : (
          <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-stone-900">
            {n.body ?? <span className="text-stone-300">No caption</span>}
          </p>
        )}
        <div className="mt-3"><Provenance n={n} scope={scope} /></div>
        <div className="mt-3"><Tags n={n} onPatch={onPatch} /></div>
        <div className="mt-4 border-t border-stone-100 pt-3">
          <Actions n={n} onPatch={onPatch} onDelete={onDelete} editing={editing} setEditing={setEditing} />
        </div>
      </aside>
    </div>
  );
}
