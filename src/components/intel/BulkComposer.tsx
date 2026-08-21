"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Check, ImagePlus, X } from "lucide-react";
import { FIELD, SubjectFields, Tag, type Gig, type Subject } from "./SubjectFields";
import { unreadable } from "./NoteComposer";
import { metresBetween, prepareImage, putBlob, type PreparedImage } from "@/lib/intel-notes/client-image";
import type { IntelNote } from "@/lib/intel-notes/store";
import type { KnownVenue } from "./VenuePicker";

/**
 * The bulk screen — photos first, then sort them.
 *
 * Mason: "the first workflow is going to be uploading dozens/hundreds of BTS
 * shots from over the years … they'll be all over the place … every photo
 * should get a separate client/venue tag."
 *
 * So this is a sorting table, not a form. Every photo carries ITS OWN venue,
 * client, gig, caption and tags. The machinery around that exists only to make
 * assigning hundreds fast:
 *
 *   - photos line up newest-first by EXIF date, sectioned by day + location
 *     (GPS within 300 m), so one gig's shots sit together;
 *   - a section can suggest its venue (nearest known, ≤300 m) and its gig
 *     (exactly one event within a day of that date) — one click applies to
 *     the section's unassigned photos;
 *   - select any set of photos and apply a subject from the sticky bar.
 *
 * Save takes only the ASSIGNED photos. The rest stay on screen, counted, so
 * nothing lands half-tagged. Each distinct subject is one POST, because the
 * server resolves venue/client from the gig per request.
 */

interface Item {
  key: string;
  file: File;
  prep: PreparedImage | null;
  caption: string;
  aboutVenue: boolean;
  aboutClient: boolean;
  subject: Subject | null;
  selected: boolean;
  status: "preparing" | "ready" | "uploading" | "done" | "error";
  error?: string;
}

interface Section {
  key: string;
  day: string | null;
  label: string;
  centre: { lat: number; lng: number } | null;
  items: Item[];
}

const NEAR_M = 300;
const EMPTY: Subject = { venue: null, client: null, gig: null };

const dayOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-CA") : null);

export function BulkComposer({ onSaved }: { onSaved: (notes: IntelNote[]) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [bar, setBar] = useState<Subject>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [venues, setVenues] = useState<KnownVenue[]>([]);
  const [gigsByDay, setGigsByDay] = useState<Record<string, Gig[]>>({});
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastClick = useRef<string | null>(null);
  /** Uploaded slots by item key — a failed POST does not re-upload on retry. */
  const keyed = useRef(new Map<string, { storageKey: string; thumbKey: string }>());
  const previews = useRef(new Set<string>());
  useEffect(() => () => { for (const u of previews.current) URL.revokeObjectURL(u); }, []);

  useEffect(() => {
    fetch("/api/venues").then((r) => r.json()).then((j) => setVenues((j.venues ?? []) as KnownVenue[])).catch(() => {});
  }, []);

  /* ── Photos in ─────────────────────────────────────────────────────────── */

  const onDrop = useCallback((accepted: File[]) => {
    if (!accepted.length) return;
    const fresh: Item[] = accepted.map((file) => ({
      key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
      file, prep: null, caption: "", aboutVenue: true, aboutClient: true, subject: null, selected: false, status: "preparing",
    }));
    setItems((xs) => [...xs, ...fresh]);
    (async () => {
      // Two at a time — hundreds of 12MP decodes in parallel is a dead tab.
      let i = 0;
      const worker = async () => {
        while (i < fresh.length) {
          const it = fresh[i++];
          try {
            const prep = await prepareImage(it.file);
            previews.current.add(prep.previewUrl);
            setItems((xs) => xs.map((x) => (x.key === it.key ? { ...x, prep, status: "ready" } : x)));
          } catch {
            setItems((xs) => xs.map((x) => (x.key === it.key ? { ...x, status: "error", error: unreadable(it.file) } : x)));
          }
        }
      };
      await Promise.all([worker(), worker()]);
    })();
  }, []);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop, accept: { "image/*": [] }, noClick: true, useFsAccessApi: false,
  });

  /* ── Sections: by day, then by place ───────────────────────────────────── */

  const sections = useMemo<Section[]>(() => {
    const out: Section[] = [];
    const sorted = [...items].sort((a, b) => (b.prep?.takenAt ?? "").localeCompare(a.prep?.takenAt ?? ""));
    for (const it of sorted) {
      const day = dayOf(it.prep?.takenAt ?? null);
      const gps = it.prep?.gps ?? null;
      let sec = out.find((s) =>
        s.day === day && (gps && s.centre ? metresBetween(gps, s.centre) <= NEAR_M : !gps && !s.centre)
      );
      if (!sec) {
        sec = { key: `${day ?? "nodate"}-${out.length}`, day, centre: gps, label: "", items: [] };
        out.push(sec);
      }
      sec.items.push(it);
    }
    for (const s of out) {
      s.label = s.day
        ? new Date(`${s.day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
        : "No date in the photo";
    }
    return out;
  }, [items]);

  // Gigs per day, fetched once per distinct day — the section suggestion.
  useEffect(() => {
    const days = [...new Set(sections.map((s) => s.day).filter((d): d is string => !!d))].filter((d) => !(d in gigsByDay));
    if (!days.length) return;
    let alive = true;
    Promise.all(days.map(async (d) => {
      try {
        const r = await fetch(`/api/intel/gigs?on=${d}T12:00:00Z`);
        const j = await r.json();
        return [d, (j.gigs ?? []) as Gig[]] as const;
      } catch { return [d, []] as const; }
    })).then((pairs) => { if (alive) setGigsByDay((m) => ({ ...m, ...Object.fromEntries(pairs) })); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections]);

  const suggestFor = (s: Section): { venue: KnownVenue | null; gig: Gig | null } => {
    const venue = s.centre
      ? venues.filter((v) => v.lat != null && v.lng != null)
          .map((v) => ({ v, m: metresBetween(s.centre!, { lat: v.lat!, lng: v.lng! }) }))
          .filter((x) => x.m <= NEAR_M).sort((a, b) => a.m - b.m)[0]?.v ?? null
      : null;
    const gigs = s.day ? gigsByDay[s.day] ?? [] : [];
    return { venue, gig: gigs.length === 1 ? gigs[0] : null };
  };

  /* ── Assignment ────────────────────────────────────────────────────────── */

  const patch = (keys: string[], f: (it: Item) => Partial<Item>) =>
    setItems((xs) => xs.map((x) => (keys.includes(x.key) ? { ...x, ...f(x) } : x)));

  const selected = items.filter((i) => i.selected);
  const selKeys = selected.map((i) => i.key);

  const toggleSelect = (key: string, shift: boolean) => {
    if (shift && lastClick.current) {
      // Range select in the visible (sectioned) order.
      const order = sections.flatMap((s) => s.items.map((i) => i.key));
      const a = order.indexOf(lastClick.current);
      const b = order.indexOf(key);
      if (a >= 0 && b >= 0) {
        const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
        patch(range, () => ({ selected: true }));
        return;
      }
    }
    lastClick.current = key;
    patch([key], (it) => ({ selected: !it.selected }));
  };

  const applyBar = () => {
    if (!selKeys.length) return;
    patch(selKeys, () => ({ subject: { ...bar }, selected: false }));
  };

  /**
   * Fill venue/client from a gig, the way SubjectFields does when you pick one —
   * used by the section suggestion so one click yields a complete subject.
   */
  const completeFromGig = async (s: Subject): Promise<Subject> => {
    if (!s.gig || (s.venue && s.client)) return s;
    try {
      const r = await fetch(`/api/events/${s.gig.id}/intel`);
      if (!r.ok) return s;
      const j = await r.json();
      const payer = (j.orgs ?? []).find((o: { role: string }) => o.role === "payer") ?? (j.orgs ?? [])[0];
      return {
        ...s,
        venue: s.venue ?? (j.venue ? { id: j.venue.id, name: j.venue.name } : null),
        client: s.client ?? (payer ? { id: payer.orgId, name: payer.name } : null),
      };
    } catch { return s; }
  };

  const applySuggestion = async (s: Section) => {
    const sug = suggestFor(s);
    let subject: Subject = {
      venue: sug.venue ? { id: sug.venue.id, name: sug.venue.name } : null,
      client: null,
      gig: sug.gig,
    };
    subject = await completeFromGig(subject);
    patch(s.items.filter((i) => !i.subject).map((i) => i.key), () => ({ subject }));
  };

  /* ── Save ──────────────────────────────────────────────────────────────── */

  const hasSubject = (i: Item) => !!(i.subject && (i.subject.venue || i.subject.client || i.subject.gig));
  const assigned = items.filter((i) => (i.status === "ready" || i.status === "done") && i.prep && hasSubject(i));
  const unassigned = items.filter((i) => (i.status === "ready" || i.status === "done") && !hasSubject(i));
  const preparing = items.filter((i) => i.status === "preparing").length;

  const save = async () => {
    if (!assigned.length) return;
    setError(null);
    setSaving(true);
    try {
      const pending = assigned.filter((i) => !keyed.current.has(i.key));
      let slots: { storageKey: string; thumbKey: string; putUrl: string; thumbPutUrl: string }[] = [];
      if (pending.length) {
        const p = await fetch("/api/intel/notes/presign", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count: pending.length }),
        });
        const pj = await p.json();
        if (!p.ok) throw new Error(pj.error ?? "Could not prepare upload");
        slots = pj.slots;
      }

      let done = assigned.length - pending.length;
      setProgress({ done, total: assigned.length });
      let next = 0;
      const worker = async () => {
        while (next < pending.length) {
          const i = next++;
          const it = pending[i];
          const slot = slots[i];
          patch([it.key], () => ({ status: "uploading" }));
          await Promise.all([putBlob(slot.putUrl, it.prep!.full), putBlob(slot.thumbPutUrl, it.prep!.thumb)]);
          keyed.current.set(it.key, slot);
          done += 1;
          setProgress({ done, total: assigned.length });
          patch([it.key], () => ({ status: "done" }));
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));

      // One POST per distinct subject.
      const groups = new Map<string, Item[]>();
      for (const it of assigned) {
        const s = it.subject!;
        const k = `${s.gig?.id ?? ""}|${s.venue?.id ?? ""}|${s.client?.id ?? ""}`;
        groups.set(k, [...(groups.get(k) ?? []), it]);
      }
      const saved: IntelNote[] = [];
      for (const group of groups.values()) {
        const s = group[0].subject!;
        const res = await fetch("/api/intel/notes", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventId: s.gig?.id ?? null, venueId: s.venue?.id ?? null, orgId: s.client?.id ?? null,
            entries: group.map((it) => {
              const slot = keyed.current.get(it.key)!;
              return {
                body: it.caption.trim() || null, storageKey: slot.storageKey, thumbKey: slot.thumbKey,
                width: it.prep!.width, height: it.prep!.height, takenAt: it.prep!.takenAt,
                aboutVenue: it.aboutVenue, aboutClient: it.aboutClient,
              };
            }),
          }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? "Could not save");
        saved.push(...(j.notes as IntelNote[]));
        // Drop the saved ones as each group lands, so a failure mid-way leaves
        // exactly the unsaved photos on screen.
        const savedKeys = new Set(group.map((g) => g.key));
        for (const k of savedKeys) keyed.current.delete(k);
        setItems((xs) => {
          for (const x of xs) if (savedKeys.has(x.key) && x.prep) { URL.revokeObjectURL(x.prep.previewUrl); previews.current.delete(x.prep.previewUrl); }
          return xs.filter((x) => !savedKeys.has(x.key));
        });
      }
      setProgress(null);
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      // `done` items keep their slot; only the interrupted one goes back to ready.
      setItems((xs) => xs.map((x) => (x.status === "uploading" ? { ...x, status: "ready" } : x)));
    } finally {
      setSaving(false);
    }
  };

  /* ── Render ────────────────────────────────────────────────────────────── */

  const barNear = selected.find((i) => i.prep?.gps)?.prep?.gps ?? null;
  const barTaken = (() => {
    const ds = selected.map((i) => i.prep?.takenAt).filter((d): d is string => !!d).sort();
    return ds.length ? ds[Math.floor(ds.length / 2)] : null;
  })();
  const barReady = !!(bar.venue || bar.client || bar.gig);

  return (
    <div {...getRootProps()} className="relative">
      <input {...getInputProps()} />

      {/* ── Drop ───────────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={open}
        disabled={saving}
        className={`flex min-h-[120px] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-[14px] transition-colors ${
          isDragActive ? "border-emerald-500 bg-emerald-50/40 text-emerald-700" : "border-stone-300 bg-white text-stone-500 hover:border-stone-400 hover:text-stone-700"
        }`}
      >
        <ImagePlus className="h-5 w-5" />
        {items.length ? "Add more photos" : "Drop photos here — as many as you like, from anywhere"}
        <span className="text-[12px] text-stone-400">They sort themselves by date and place; you say which venue and client.</span>
      </button>

      {/* ── Sticky bar: apply to selection ─────────────────────────────── */}
      {items.length > 0 && (
        <div className="sticky top-0 z-20 -mx-1 mt-4 rounded-lg border border-stone-200 bg-white/95 p-3 shadow-sm backdrop-blur sm:p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-stone-400">
              {selected.length ? `${selected.length} selected` : "Select photos, then set where they belong"}
            </span>
            {selected.length > 0 && (
              <button type="button" onClick={() => patch(selKeys, () => ({ selected: false }))} className="text-[12px] text-stone-400 underline-offset-4 hover:text-stone-700 hover:underline">
                Clear selection
              </button>
            )}
          </div>
          <div className="mt-2">
            <SubjectFields value={bar} onChange={setBar} near={barNear} takenOn={barTaken} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={applyBar}
              disabled={!selected.length || !barReady || saving}
              className="min-h-[36px] rounded-md border border-stone-800 bg-stone-900 px-3 text-[13px] text-white disabled:opacity-40"
            >
              Apply to {selected.length || "selected"}
            </button>
            <button type="button" onClick={() => setBar(EMPTY)} className="text-[12px] text-stone-400 underline-offset-4 hover:text-stone-700 hover:underline">Reset</button>
          </div>
        </div>
      )}

      {/* ── Sections ───────────────────────────────────────────────────── */}
      {sections.map((s) => {
        const sug = suggestFor(s);
        const open_ = s.items.filter((i) => !i.subject).length;
        return (
          <section key={s.key} className="mt-8">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="text-[11px] uppercase tracking-[0.14em] text-stone-500">{s.label}</span>
                <span className="text-[12px] text-stone-400">
                  {s.items.length} photo{s.items.length === 1 ? "" : "s"}
                  {s.centre && sug.venue && <> · near {sug.venue.name}</>}
                  {s.centre && !sug.venue && <> · one location, no known venue nearby</>}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {(sug.venue || sug.gig) && open_ > 0 && (
                  <button
                    type="button"
                    onClick={() => void applySuggestion(s)}
                    className="rounded-full border border-emerald-500 bg-emerald-50 px-3 py-1 text-[12px] text-emerald-800 hover:bg-emerald-100"
                  >
                    Use {[sug.venue?.name, sug.gig?.name].filter(Boolean).join(" · ")}
                  </button>
                )}
                <button type="button" onClick={() => patch(s.items.map((i) => i.key), () => ({ selected: true }))} className="text-[12px] text-stone-500 underline-offset-4 hover:text-stone-800 hover:underline">
                  Select all
                </button>
              </div>
            </div>

            <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {s.items.map((it) => (
                <PhotoCard
                  key={it.key}
                  it={it}
                  saving={saving}
                  editing={editing === it.key}
                  onSelect={(shift) => toggleSelect(it.key, shift)}
                  onEdit={() => setEditing(editing === it.key ? null : it.key)}
                  onChange={(p) => patch([it.key], () => p)}
                  onRemove={() => setItems((xs) => { if (it.prep) { URL.revokeObjectURL(it.prep.previewUrl); previews.current.delete(it.prep.previewUrl); } return xs.filter((x) => x.key !== it.key); })}
                />
              ))}
            </ul>
          </section>
        );
      })}

      {/* ── Save ───────────────────────────────────────────────────────── */}
      {items.length > 0 && (
        <div className="sticky bottom-0 z-20 mt-8 -mx-1 rounded-lg border border-stone-200 bg-white/95 p-3 shadow-sm backdrop-blur sm:p-4">
          {error && <p className="mb-2 text-[12px] text-red-700">{error}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={!assigned.length || saving}
              className="min-h-[40px] rounded-md border border-stone-800 bg-stone-900 px-4 text-[13px] text-white disabled:opacity-40"
            >
              {saving && progress ? `Uploading ${progress.done} of ${progress.total}…` : `Save ${assigned.length} assigned`}
            </button>
            <span className="text-[12px] text-stone-400">
              {unassigned.length > 0 && <>{unassigned.length} still need a venue or client — they stay here. </>}
              {preparing > 0 && <>Reading {preparing}…</>}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function PhotoCard({ it, saving, editing, onSelect, onEdit, onChange, onRemove }: {
  it: Item; saving: boolean; editing: boolean;
  onSelect: (shift: boolean) => void; onEdit: () => void;
  onChange: (p: Partial<Item>) => void; onRemove: () => void;
}) {
  const s = it.subject;
  const has = !!(s && (s.venue || s.client || s.gig));
  return (
    <li className={`rounded-md border bg-white p-2 ${it.selected ? "border-emerald-500 ring-2 ring-emerald-500/20" : has ? "border-stone-200" : "border-amber-300"} ${editing ? "col-span-2 sm:col-span-3 md:col-span-4" : ""}`}>
      <div className={editing ? "flex gap-4" : ""}>
        <button
          type="button"
          onClick={(e) => onSelect(e.shiftKey)}
          className={`relative block overflow-hidden rounded bg-stone-100 ${editing ? "h-40 w-40 shrink-0" : "aspect-[4/3] w-full"}`}
          aria-pressed={it.selected}
        >
          {it.prep ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={it.prep.previewUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center text-[11px] text-stone-400">{it.status === "error" ? it.error : "Reading…"}</span>
          )}
          {it.selected && (
            <span className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white"><Check className="h-3.5 w-3.5" /></span>
          )}
          {(it.status === "uploading" || it.status === "done") && (
            <span className={`absolute inset-x-0 bottom-0 h-1 ${it.status === "done" ? "bg-emerald-500" : "animate-pulse bg-emerald-500/50"}`} />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="mt-1.5 flex items-start justify-between gap-2">
            <button type="button" onClick={onEdit} className="min-w-0 text-left" title="Change this photo's venue, client or gig">
              {has ? (
                <span className="block truncate text-[12px] text-stone-800">
                  {[s!.venue?.name, s!.client?.name].filter(Boolean).join(" · ") || s!.gig?.name}
                </span>
              ) : (
                <span className="block text-[12px] text-amber-700">Unassigned — tap to set</span>
              )}
              {has && s!.gig && (s!.venue || s!.client) && <span className="block truncate text-[11px] text-stone-400">{s!.gig.name}</span>}
            </button>
            {!saving && (
              <button type="button" onClick={onRemove} className="shrink-0 text-stone-300 hover:text-stone-700" aria-label="Remove"><X className="h-4 w-4" /></button>
            )}
          </div>

          {editing && (
            <div className="mt-3">
              <SubjectFields
                value={s ?? EMPTY}
                onChange={(subject) => onChange({ subject })}
                near={it.prep?.gps ?? null}
                takenOn={it.prep?.takenAt ?? null}
              />
            </div>
          )}

          <input
            value={it.caption}
            onChange={(e) => onChange({ caption: e.target.value })}
            placeholder="Caption"
            disabled={saving}
            className={`${FIELD} mt-2 py-1 text-[12px]`}
          />
          <div className="mt-1.5 flex items-center gap-1.5">
            <Tag small on={it.aboutVenue} onClick={() => onChange({ aboutVenue: !it.aboutVenue })}>Venue</Tag>
            <Tag small on={it.aboutClient} onClick={() => onChange({ aboutClient: !it.aboutClient })}>Client</Tag>
            {editing && <button type="button" onClick={onEdit} className="ml-auto text-[12px] text-stone-500 underline-offset-4 hover:underline">Done</button>}
          </div>
        </div>
      </div>
    </li>
  );
}
