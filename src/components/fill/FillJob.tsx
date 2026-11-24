"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Expand, Loader2, Lock, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * FillJob — the crew's pick page for one TDP Work job (/fill/[sectionId]).
 *
 * Mason texts a photographer this link. It opens the job's client gallery,
 * ranked (best first), and the photographer taps 6 to 12 photos and presses
 * Add. Phone-first: big tiles, a viewer for judging a face, one sticky
 * button. Contract and owner checks: src/lib/site/fill.ts.
 *
 * Every network call goes through `api`, so /dev/fill can render the same
 * screen from a fixture (phone-width checks need no signed-in browser).
 */

export interface Source {
  eventId: string;
  name: string;
  photoCount: number;
}

export interface Job {
  sectionId: string;
  name: string;
  workEventId: string;
  locked: boolean;
  missing: string[];
  memberIds: string[];
  sources: Source[];
}

export interface Photo {
  id: string;
  thumbnailUrl: string;
  thumbnailLgUrl: string;
  onSite: boolean;
}

const TARGET = { min: 6, max: 12 };

/** A failed call carries the HTTP status so the page can say what went wrong. */
export class FillError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface FillApi {
  job(): Promise<Job>;
  shortlist(sourceId: string): Promise<Photo[]>;
  photos(sourceId: string, offset: number): Promise<{ photos: Photo[]; nextOffset: number | null }>;
  add(imageIds: string[]): Promise<void>;
}

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const reason = await res.json().then((j) => j?.error as string | undefined).catch(() => undefined);
    throw new FillError(res.status, reason ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** The real endpoints (src/app/api/fill, and the ordinary Copy to... transfer). */
export function fillApi(sectionId: string): FillApi {
  return {
    job: async () => (await readJson<{ job: Job }>(await fetch(`/api/fill/${sectionId}`))).job,
    shortlist: async (sourceId) =>
      (await readJson<{ photos: Photo[] }>(
        await fetch(`/api/fill/${sectionId}/shortlist?source=${sourceId}`, { method: "POST" })
      )).photos,
    photos: async (sourceId, offset) =>
      readJson(await fetch(`/api/fill/${sectionId}/photos?source=${sourceId}&offset=${offset}`)),
    add: async (imageIds) => {
      await readJson(
        await fetch("/api/images/transfer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageIds, targetSectionId: sectionId, mode: "copy" }),
        })
      );
    },
  };
}

export function FillJob({ api }: { api: FillApi }) {
  const [job, setJob] = useState<Job | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);

  const [shortlist, setShortlist] = useState<Photo[] | null>(null);
  const [shortlistError, setShortlistError] = useState(false);
  const [all, setAll] = useState<Photo[] | null>(null);
  const [allNext, setAllNext] = useState<number | null>(0);
  const [allLoading, setAllLoading] = useState(false);
  // A failed page stops the auto-load until a person taps "Load more"; without
  // it the observer re-fired at once and looped on a persistent error.
  const [allFailed, setAllFailed] = useState(false);
  // The gallery "All photos" belongs to, and whether a page is in flight.
  // Refs, so a response for a gallery the person has left is dropped, and the
  // button and the observer cannot both start the same page in one tick.
  const allFor = useRef(0); // bumps on every gallery switch
  const allBusy = useRef(false);

  // Selection keeps tap order, so the numbers on tiles match the order added.
  const [selected, setSelected] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [justAdded, setJustAdded] = useState<number | null>(null);
  const [viewer, setViewer] = useState<{ list: Photo[]; index: number } | null>(null);

  /** First load: a failure replaces the page. A refresh (after Add) never does. */
  const loadJob = useCallback(async (refresh = false) => {
    try {
      const j = await api.job();
      setJob(j);
      return j;
    } catch (e) {
      if (refresh) return null;
      setLoadError(
        e instanceof FillError && e.status === 404
          ? "This link does not point at a job you can open."
          : "Could not load this job. Try again in a minute."
      );
      return null;
    }
  }, [api]);

  useEffect(() => {
    loadJob().then((j) => {
      if (j && j.sources[0]) setSourceId((cur) => cur ?? j.sources[0].eventId);
    });
  }, [loadJob]);

  const source = job?.sources.find((s) => s.eventId === sourceId) ?? null;

  // Switching galleries starts that gallery fresh; the selection survives,
  // because a job can take photos from several of its galleries at once.
  useEffect(() => {
    if (!sourceId) return;
    let cancelled = false;
    setShortlist(null);
    setShortlistError(false);
    setAll(null);
    setAllNext(0);
    setAllFailed(false);
    setAllLoading(false);
    allFor.current += 1;
    allBusy.current = false;
    api
      .shortlist(sourceId)
      .then((photos) => !cancelled && setShortlist(photos))
      .catch(() => !cancelled && setShortlistError(true));
    return () => {
      cancelled = true;
    };
  }, [api, sourceId]);

  const loadMore = useCallback(async () => {
    if (!sourceId || allBusy.current || allNext === null) return;
    const forSource = sourceId;
    const gen = allFor.current;
    allBusy.current = true;
    setAllLoading(true);
    setAllFailed(false);
    try {
      const d = await api.photos(forSource, allNext);
      if (allFor.current !== gen) return; // they switched galleries
      setAll((cur) => [...(cur ?? []), ...d.photos]);
      setAllNext(d.nextOffset);
    } catch {
      if (allFor.current !== gen) return;
      setAllFailed(true);
      toast.error("Could not load more photos.");
    } finally {
      if (allFor.current === gen) {
        allBusy.current = false;
        setAllLoading(false);
      }
    }
  }, [api, sourceId, allNext]);

  // Keep loading as the end of "All photos" scrolls into view.
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || all === null || allNext === null || allFailed) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [all, allNext, allFailed, loadMore]);

  const members = useMemo(() => new Set(job?.memberIds ?? []), [job]);
  const inJob = job?.memberIds.length ?? 0;

  const toggle = useCallback(
    (id: string) => {
      if (members.has(id) || job?.locked) return;
      setJustAdded(null);
      setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    },
    [members, job?.locked]
  );

  const add = useCallback(async () => {
    if (!job || selected.length === 0 || adding) return;
    setAdding(true);
    try {
      const sent = selected;
      await api.add(sent);
      const count = sent.length;
      // The photos are in: clear first, so a failed refresh can never lead to
      // re-adding them. Then refetch before confirming, because the
      // confirmation quotes the new total (shown early it printed the old one).
      // Only what was sent: taps made while it was sending stay chosen.
      setSelected((cur) => cur.filter((id) => !sent.includes(id)));
      const fresh = await loadJob(true);
      if (!fresh) {
        setJob((cur) => (cur ? { ...cur, memberIds: [...new Set([...cur.memberIds, ...sent])] } : cur));
      }
      setJustAdded(count);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add the photos");
    } finally {
      setAdding(false);
    }
  }, [api, job, selected, adding, loadJob]);

  if (loadError) {
    return (
      <Shell>
        <p className="mt-16 text-center text-[14px] text-stone-500">{loadError}</p>
      </Shell>
    );
  }
  if (!job) {
    return (
      <Shell>
        <div className="mt-24 flex justify-center text-stone-300">
          <Loader2 className="animate-spin" size={22} />
        </div>
      </Shell>
    );
  }

  // Complete fields = live the moment it has a photo. Photos joining a draft
  // job are copied to the site's storage but the site does not list the job.
  const complete = job.missing.length === 0;
  const progress = Math.min(1, inJob / TARGET.min);

  return (
    <Shell>
      {/* ─── The job ─── */}
      <header className="pt-5 pb-4">
        <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-stone-400">
          Fill this job
        </p>
        <h1 className="mt-1 font-editorial text-[28px] leading-[1.15] text-stone-900 md:text-[36px]">
          {job.name}
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-stone-600">
          Tap the {TARGET.min} to {TARGET.max} strongest photos, then press Add.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <div className="h-1 w-28 overflow-hidden rounded-full bg-stone-100" aria-hidden>
            <div
              className={cn("h-full rounded-full transition-[width] duration-500", inJob >= TARGET.min ? "bg-emerald-500" : "bg-stone-400")}
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <span className="text-[12px] tabular-nums text-stone-500">
            {inJob} {inJob === 1 ? "photo" : "photos"} in the job
          </span>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-stone-400">
          {complete
            ? inJob > 0
              ? "This job is live: photos you add appear on twodudesphoto.com right away."
              : "Adding photos puts this job live on twodudesphoto.com right away."
            : "Draft: this job is not shown on twodudesphoto.com yet."}
        </p>
        {justAdded !== null && (
          <div className="mt-4 flex items-start gap-2.5 border-t border-stone-200 pt-3" role="status">
            <Check size={16} className="mt-0.5 shrink-0 text-emerald-600" />
            <p className="text-[13px] leading-relaxed text-stone-700">
              Added {justAdded} {justAdded === 1 ? "photo" : "photos"}. The job now has {inJob}.
              {inJob < TARGET.min ? ` Pick ${TARGET.min - inJob} more to reach ${TARGET.min}.` : " Thank you!"}
            </p>
          </div>
        )}
        {job.locked && (
          <div className="mt-4 flex items-start gap-2.5 border-t border-stone-200 pt-3">
            <Lock size={15} className="mt-0.5 shrink-0 text-amber-600" />
            <p className="text-[13px] text-stone-700">This job is locked. Unlock it in TDP Work before adding photos.</p>
          </div>
        )}
      </header>

      {job.sources.length === 0 ? (
        <p className="border-t border-stone-200 py-10 text-center text-[14px] text-stone-500">
          No client gallery is linked to this job yet. Add one in the job&apos;s details in TDP Work.
        </p>
      ) : (
        <>
          {/* ─── Which gallery ─── */}
          {job.sources.length > 1 && (
            // Wrapped, not a scroll strip: a second gallery hidden past the
            // edge of a phone is a gallery nobody picks from.
            <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label="Client galleries">
              {job.sources.map((s) => (
                <button
                  key={s.eventId}
                  aria-pressed={s.eventId === sourceId}
                  onClick={() => setSourceId(s.eventId)}
                  className={cn(
                    "max-w-full truncate rounded-full border px-3.5 py-2 text-left text-[12px] transition-colors",
                    s.eventId === sourceId
                      ? "border-stone-900 bg-stone-900 text-white"
                      : "border-stone-200 text-stone-600 hover:border-stone-400"
                  )}
                >
                  {s.name}
                  <span className={cn("ml-1.5 tabular-nums", s.eventId === sourceId ? "text-stone-400" : "text-stone-300")}>
                    {s.photoCount.toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* ─── Best picks ─── */}
          <SectionTitle
            title="Best picks"
            note={source ? `Ranked from ${source.photoCount.toLocaleString()} photos in ${source.name}` : undefined}
          />
          {shortlistError ? (
            <p className="py-8 text-center text-[13px] text-stone-500">
              Ranking did not work this time. Use All photos below.
            </p>
          ) : shortlist === null ? (
            <div>
              <p className="mb-3 flex items-center gap-2 text-[12px] text-stone-400">
                <Loader2 size={13} className="animate-spin" />
                Finding the best photos{source ? ` in ${source.photoCount.toLocaleString()}` : ""}… this takes a few seconds.
              </p>
              <Grid>
                {Array.from({ length: 12 }, (_, i) => (
                  <div key={i} className="aspect-[4/5] animate-pulse bg-stone-100" />
                ))}
              </Grid>
            </div>
          ) : (
            <Grid>
              {shortlist.map((p, i) => (
                <Tile
                  key={p.id}
                  photo={p}
                  order={selected.indexOf(p.id)}
                  added={members.has(p.id)}
                  disabled={job.locked}
                  onToggle={() => toggle(p.id)}
                  onView={() => setViewer({ list: shortlist, index: i })}
                />
              ))}
            </Grid>
          )}

          {/* ─── Everything ─── */}
          <div className="mt-10">
            {all === null ? (
              <button
                onClick={() => {
                  setAll([]);
                  loadMore();
                }}
                className="w-full border-t border-stone-200 py-4 text-[13px] font-medium text-stone-700 transition-colors hover:text-stone-900"
              >
                Show all {source ? source.photoCount.toLocaleString() : ""} photos
              </button>
            ) : (
              <>
                <SectionTitle title="All photos" note="In the order they were taken" />
                <Grid>
                  {all.map((p, i) => (
                    <Tile
                      key={p.id}
                      photo={p}
                      order={selected.indexOf(p.id)}
                      added={members.has(p.id)}
                      disabled={job.locked}
                      onToggle={() => toggle(p.id)}
                      onView={() => setViewer({ list: all, index: i })}
                    />
                  ))}
                </Grid>
                <div ref={sentinel} className="flex justify-center py-6">
                  {allNext !== null && (
                    <button
                      onClick={loadMore}
                      disabled={allLoading}
                      className="text-[12px] text-stone-500 hover:text-stone-800"
                    >
                      {allLoading ? <Loader2 size={16} className="animate-spin" /> : allFailed ? "Try again" : "Load more"}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ─── The one action ─── */}
      <div className="h-28" aria-hidden />
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          {selected.length === 0 ? (
            <p className="flex-1 py-3 text-center text-[13px] text-stone-400">
              {job.locked ? "This job is locked" : "Tap photos to choose them"}
            </p>
          ) : (
            <>
              <button
                onClick={() => setSelected([])}
                className="px-2 py-3 text-[13px] text-stone-500 hover:text-stone-800"
              >
                Clear
              </button>
              <button
                onClick={add}
                disabled={adding}
                className="flex flex-1 items-center justify-center gap-2 rounded-md bg-stone-900 py-3.5 text-[14px] font-medium text-white transition-colors hover:bg-stone-800 disabled:opacity-60"
              >
                {adding && <Loader2 size={15} className="animate-spin" />}
                Add {selected.length} {selected.length === 1 ? "photo" : "photos"}
              </button>
            </>
          )}
        </div>
      </div>

      {viewer && (
        <Viewer
          list={viewer.list}
          index={viewer.index}
          onIndex={(index) => setViewer({ ...viewer, index })}
          onClose={() => setViewer(null)}
          selected={selected}
          members={members}
          locked={job.locked}
          onToggle={toggle}
        />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-white">
      <div className="border-b border-stone-200">
        <div className="mx-auto flex max-w-5xl items-center px-4 py-3">
          <span className="font-brand text-[15px] text-stone-900">Pixeltrunk</span>
        </div>
      </div>
      <main className="mx-auto max-w-5xl px-4">{children}</main>
    </div>
  );
}

function SectionTitle({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mb-3 mt-2 flex items-baseline justify-between gap-3 border-b border-stone-200 pb-2">
      <h2 className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-900">{title}</h2>
      {note && <span className="min-w-0 truncate text-[11px] text-stone-400">{note}</span>}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">{children}</div>;
}

function Tile({
  photo,
  order,
  added,
  disabled,
  onToggle,
  onView,
}: {
  photo: Photo;
  order: number;
  added: boolean;
  disabled: boolean;
  onToggle: () => void;
  onView: () => void;
}) {
  const chosen = order >= 0;
  const label = added ? "Already in this job" : chosen ? "Remove from selection" : "Choose this photo";
  return (
    <div className="relative aspect-[4/5] overflow-hidden bg-stone-100">
      <button
        onClick={onToggle}
        disabled={added || disabled}
        aria-pressed={chosen}
        aria-label={label}
        title={label}
        className="absolute inset-0 block h-full w-full"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.thumbnailUrl}
          alt=""
          loading="lazy"
          className={cn(
            "h-full w-full object-cover transition-[transform,opacity] duration-200",
            chosen && "scale-[0.92]",
            added && "opacity-40"
          )}
        />
      </button>
      {chosen && (
        <span className="pointer-events-none absolute inset-0 ring-[3px] ring-inset ring-emerald-500" />
      )}
      <span
        className={cn(
          "pointer-events-none absolute left-1.5 top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums",
          chosen ? "bg-emerald-500 text-white" : "border border-white/80 bg-black/15"
        )}
      >
        {chosen ? order + 1 : ""}
      </span>
      {added && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-white/90 py-1 text-center text-[10px] font-medium uppercase tracking-[0.12em] text-stone-600">
          In the job
        </span>
      )}
      {!added && photo.onSite && (
        <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-sm bg-white/90 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.1em] text-stone-600">
          On the site
        </span>
      )}
      <button
        onClick={onView}
        aria-label="View larger"
        title="View larger"
        className="absolute right-0 top-0 p-2.5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]"
      >
        <Expand size={15} />
      </button>
    </div>
  );
}

function Viewer({
  list,
  index,
  onIndex,
  onClose,
  selected,
  members,
  locked,
  onToggle,
}: {
  list: Photo[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  selected: string[];
  members: Set<string>;
  locked: boolean;
  onToggle: (id: string) => void;
}) {
  const photo = list[index];
  const prev = index > 0 ? () => onIndex(index - 1) : undefined;
  const next = index < list.length - 1 ? () => onIndex(index + 1) : undefined;
  const touchX = useRef<number | null>(null);
  // Focus moves into the viewer and back to where it was on close.
  // The dialog itself takes focus, not Close: with Close focused, Space
  // (choose) could also fire the button on key release and close the viewer.
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => before?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      if (e.key === "ArrowRight" && index < list.length - 1) onIndex(index + 1);
      if (e.key === " " && photo) {
        e.preventDefault();
        onToggle(photo.id);
      }
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, onIndex, index, list.length, onToggle, photo]);

  if (!photo) return null;
  const chosen = selected.includes(photo.id);
  const added = members.has(photo.id);

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      className="fixed inset-0 z-50 flex flex-col bg-stone-950 outline-none"
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        const start = touchX.current;
        touchX.current = null;
        if (start === null) return;
        const dx = e.changedTouches[0].clientX - start;
        if (dx > 60) prev?.();
        if (dx < -60) next?.();
      }}
    >
      <div className="flex items-center justify-between px-2 py-2 text-stone-300">
        <span className="px-2 text-[12px] tabular-nums">
          {index + 1} of {list.length}
        </span>
        <button onClick={onClose} className="p-2.5 hover:text-white" aria-label="Close" title="Close">
          <X size={22} />
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={photo.id} src={photo.thumbnailLgUrl} alt="" className="max-h-full max-w-full object-contain" />
        {prev && (
          <button onClick={prev} className="absolute left-0 top-1/2 -translate-y-1/2 p-3 text-white/70 hover:text-white max-md:hidden" aria-label="Previous" title="Previous">
            <ChevronLeft size={28} />
          </button>
        )}
        {next && (
          <button onClick={next} className="absolute right-0 top-1/2 -translate-y-1/2 p-3 text-white/70 hover:text-white max-md:hidden" aria-label="Next" title="Next">
            <ChevronRight size={28} />
          </button>
        )}
      </div>
      <div className="px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {added ? (
          <p className="py-3.5 text-center text-[13px] text-stone-400">Already in this job</p>
        ) : (
          <button
            onClick={() => onToggle(photo.id)}
            disabled={locked}
            className={cn(
              "mx-auto flex w-full max-w-sm items-center justify-center gap-2 rounded-md py-3.5 text-[14px] font-medium transition-colors disabled:opacity-50",
              chosen ? "bg-emerald-500 text-white hover:bg-emerald-600" : "bg-white text-stone-900 hover:bg-stone-100"
            )}
          >
            {chosen ? (
              <>
                <Check size={16} /> Chosen ({selected.indexOf(photo.id) + 1})
              </>
            ) : (
              "Choose this photo"
            )}
          </button>
        )}
      </div>
    </div>
  );
}
