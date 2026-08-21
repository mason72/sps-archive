"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { ImagePlus, X } from "lucide-react";
import { FIELD, SubjectFields, completeFromGig, type Gig, type Subject } from "./SubjectFields";
import { unreadable } from "./NoteComposer";
import { metresBetween, prepareImage, putBlob, type PreparedImage } from "@/lib/intel-notes/client-image";
import type { IntelNote } from "@/lib/intel-notes/store";
import { venues as venueRegistry, useRegistry } from "./registry-cache";

/**
 * The bulk screen — photos first, one ROW per photo.
 *
 * Mason: "the first workflow is going to be uploading dozens/hundreds of BTS
 * shots from over the years … they'll be all over the place … every photo
 * should get a separate client/venue tag … a larger image thumbnail and each
 * image has the client/venue fields next to it, so it's per-image not one
 * edit box at the top of all the images."
 *
 * So: a big thumbnail on the left, and that photo's own venue, client, gig
 * and caption beside it. THE FIELDS DECIDE where it shows — venue filled
 * means the venue page, client filled means the client page; there is no
 * tag control (Mason: "we just let the fields do the work"). No selection model, no shared control panel —
 * the per-photo fields ARE the interface. What makes hundreds bearable:
 *
 *   - rows line up newest-first by EXIF date, under day + place headers
 *     (GPS within 300 m), so one gig's shots sit together;
 *   - a header can fill its still-empty rows with the nearest known venue
 *     and the one gig that day, in a click;
 *   - "Same as above" copies the previous row's subject — a run of twenty
 *     shots from one gig is one click each.
 *
 * Save takes only the ASSIGNED rows; the rest stay, counted. Each distinct
 * subject is one POST, because the server resolves venue/client from the gig
 * per request.
 */

interface Item {
  key: string;
  file: File;
  prep: PreparedImage | null;
  caption: string;
  subject: Subject;
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
const hasSubject = (s: Subject) => !!(s.venue || s.client || s.gig);
const dayOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-CA") : null);

export function BulkComposer({ onSaved }: { onSaved: (notes: IntelNote[]) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const venues = useRegistry(venueRegistry) ?? [];
  const [gigsByDay, setGigsByDay] = useState<Record<string, Gig[]>>({});
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Uploaded slots by item key — a failed POST does not re-upload on retry. */
  const keyed = useRef(new Map<string, { storageKey: string; thumbKey: string }>());
  const previews = useRef(new Set<string>());
  useEffect(() => () => { for (const u of previews.current) URL.revokeObjectURL(u); }, []);

  /* ── Photos in ─────────────────────────────────────────────────────────── */

  const onDrop = useCallback((accepted: File[]) => {
    if (!accepted.length) return;
    const fresh: Item[] = accepted.map((file) => ({
      key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
      file, prep: null, caption: "", subject: EMPTY, status: "preparing",
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

  const patch = (key: string, p: Partial<Item> | ((it: Item) => Partial<Item>)) =>
    setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...(typeof p === "function" ? p(x) : p) } : x)));

  const remove = (key: string) =>
    setItems((xs) => {
      const it = xs.find((x) => x.key === key);
      if (it?.prep) { URL.revokeObjectURL(it.prep.previewUrl); previews.current.delete(it.prep.previewUrl); }
      return xs.filter((x) => x.key !== key);
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

  /** The visible order, for "Same as above". */
  const order = useMemo(() => sections.flatMap((s) => s.items.map((i) => i.key)), [sections]);

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

  const suggestFor = (s: Section) => {
    const venue = s.centre
      ? venues.filter((v) => v.lat != null && v.lng != null)
          .map((v) => ({ v, m: metresBetween(s.centre!, { lat: v.lat!, lng: v.lng! }) }))
          .filter((x) => x.m <= NEAR_M).sort((a, b) => a.m - b.m)[0]?.v ?? null
      : null;
    const gigs = s.day ? gigsByDay[s.day] ?? [] : [];
    return { venue, gig: gigs.length === 1 ? gigs[0] : null };
  };

  const applySuggestion = async (s: Section) => {
    const sug = suggestFor(s);
    const subject = await completeFromGig({
      venue: sug.venue ? { id: sug.venue.id, name: sug.venue.name } : null,
      client: null,
      gig: sug.gig,
    });
    setItems((xs) => xs.map((x) => (s.items.some((i) => i.key === x.key) && !hasSubject(x.subject) ? { ...x, subject } : x)));
  };

  const sameAsAbove = (key: string) => {
    const i = order.indexOf(key);
    if (i <= 0) return;
    const above = items.find((x) => x.key === order[i - 1]);
    if (above) patch(key, { subject: { ...above.subject } });
  };

  /* ── Save ──────────────────────────────────────────────────────────────── */

  const assigned = items.filter((i) => (i.status === "ready" || i.status === "done") && i.prep && hasSubject(i.subject));
  const unassigned = items.filter((i) => (i.status === "ready" || i.status === "done") && !hasSubject(i.subject));
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
          patch(it.key, { status: "uploading" });
          await Promise.all([putBlob(slot.putUrl, it.prep!.full), putBlob(slot.thumbPutUrl, it.prep!.thumb)]);
          keyed.current.set(it.key, slot);
          done += 1;
          setProgress({ done, total: assigned.length });
          patch(it.key, { status: "done" });
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));

      // One POST per distinct subject.
      const groups = new Map<string, Item[]>();
      for (const it of assigned) {
        const s = it.subject;
        const k = `${s.gig?.id ?? ""}|${s.venue?.id ?? ""}|${s.client?.id ?? ""}`;
        groups.set(k, [...(groups.get(k) ?? []), it]);
      }
      const saved: IntelNote[] = [];
      for (const group of groups.values()) {
        const s = group[0].subject;
        const res = await fetch("/api/intel/notes", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventId: s.gig?.id ?? null, venueId: s.venue?.id ?? null, orgId: s.client?.id ?? null,
            entries: group.map((it) => {
              const slot = keyed.current.get(it.key)!;
              return {
                body: it.caption.trim() || null, storageKey: slot.storageKey, thumbKey: slot.thumbKey,
                width: it.prep!.width, height: it.prep!.height, takenAt: it.prep!.takenAt,
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

  return (
    <div {...getRootProps()} className="relative">
      <input {...getInputProps()} />

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
        <span className="text-[12px] text-stone-400">Each photo gets its own venue, client and gig below.</span>
      </button>

      {sections.map((s) => {
        const sug = suggestFor(s);
        const open_ = s.items.filter((i) => !hasSubject(i.subject)).length;
        return (
          <section key={s.key} className="mt-8">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-stone-200 pb-2">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="text-[11px] uppercase tracking-[0.14em] text-stone-500">{s.label}</span>
                <span className="text-[12px] text-stone-400">
                  {s.items.length} photo{s.items.length === 1 ? "" : "s"}
                  {s.centre && sug.venue && <> · near {sug.venue.name}</>}
                  {s.centre && !sug.venue && <> · one location, no known venue nearby</>}
                </span>
              </div>
              {(sug.venue || sug.gig) && open_ > 0 && (
                <button
                  type="button"
                  onClick={() => void applySuggestion(s)}
                  className="rounded-full border border-emerald-500 bg-emerald-50 px-3 py-1 text-[12px] text-emerald-800 hover:bg-emerald-100"
                >
                  Use {[sug.venue?.name, sug.gig?.name].filter(Boolean).join(" · ")} for {open_ === s.items.length ? "all" : `the ${open_} unset`}
                </button>
              )}
            </div>

            <ul className="divide-y divide-stone-100">
              {s.items.map((it) => (
                <PhotoRow
                  key={it.key}
                  it={it}
                  saving={saving}
                  canCopyAbove={order.indexOf(it.key) > 0}
                  onChange={(p) => patch(it.key, p)}
                  onSameAsAbove={() => sameAsAbove(it.key)}
                  onRemove={() => remove(it.key)}
                />
              ))}
            </ul>
          </section>
        );
      })}

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
              {unassigned.length > 0 && <>{unassigned.length} still need a venue, client or gig — they stay here. </>}
              {preparing > 0 && <>Reading {preparing}…</>}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── One photo, its own fields ──────────────────────────────────────────── */

function PhotoRow({ it, saving, canCopyAbove, onChange, onSameAsAbove, onRemove }: {
  it: Item; saving: boolean; canCopyAbove: boolean;
  onChange: (p: Partial<Item>) => void; onSameAsAbove: () => void; onRemove: () => void;
}) {
  const assigned = hasSubject(it.subject);
  const a = "text-[12px] text-stone-500 underline-offset-4 hover:text-stone-900 hover:underline disabled:opacity-40";
  return (
    <li className="flex flex-col gap-4 py-5 sm:flex-row">
      {/* The photo — big enough to recognise a loading dock. */}
      <div className="relative w-full shrink-0 overflow-hidden rounded-md bg-stone-100 sm:w-64 md:w-72">
        <div className="aspect-[4/3] w-full">
          {it.prep ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={it.prep.previewUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center px-3 text-center text-[12px] text-stone-400">
              {it.status === "error" ? it.error : "Reading…"}
            </span>
          )}
        </div>
        {!assigned && it.status !== "error" && (
          <span className="absolute left-2 top-2 rounded-full bg-amber-600 px-2 py-0.5 text-[11px] text-white">Needs a home</span>
        )}
        {(it.status === "uploading" || it.status === "done") && (
          <span className={`absolute inset-x-0 bottom-0 h-1 ${it.status === "done" ? "bg-emerald-500" : "animate-pulse bg-emerald-500/50"}`} />
        )}
        {it.prep?.takenAt && (
          <span className="absolute bottom-2 right-2 rounded bg-stone-950/60 px-1.5 py-0.5 text-[11px] text-white">
            {new Date(it.prep.takenAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </span>
        )}
      </div>

      {/* Its fields. */}
      <div className="min-w-0 flex-1">
        <SubjectFields
          value={it.subject}
          onChange={(subject) => onChange({ subject })}
          near={it.prep?.gps ?? null}
          takenOn={it.prep?.takenAt ?? null}
        />
        <input
          value={it.caption}
          onChange={(e) => onChange({ caption: e.target.value })}
          placeholder="Caption — “don’t use these stairs, elevator to the right”"
          disabled={saving}
          className={`${FIELD} mt-3`}
        />
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-[12px] text-stone-400">
            {it.subject.venue && it.subject.client ? "Shows on the venue and the client pages"
              : it.subject.venue ? "Shows on the venue page — add a client to show there too"
              : it.subject.client ? "Shows on the client page — add a venue to show there too"
              : it.subject.gig ? "Linked to the gig only — add a venue or client to show on their pages"
              : null}
          </span>
          <span className="ml-auto inline-flex items-center gap-4">
            {canCopyAbove && !saving && (
              <button type="button" className={a} onClick={onSameAsAbove}>Same as above</button>
            )}
            {!saving && (
              <button type="button" onClick={onRemove} className="text-stone-300 hover:text-stone-700" aria-label="Remove"><X className="h-4 w-4" /></button>
            )}
          </span>
        </div>
      </div>
    </li>
  );
}
