"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { ImagePlus, X } from "lucide-react";
import type { ComboValue } from "./Combobox";
import { FIELD, SubjectFields, Tag, type Subject } from "./SubjectFields";
import { prepareImage, putBlob, type PreparedImage } from "@/lib/intel-notes/client-image";
import type { IntelNote } from "@/lib/intel-notes/store";

/**
 * Add notes and behind-the-scenes photos — ONE composer, three hosts.
 *
 * The event's intel tab (gig known), the venue and client panels on /intel
 * (one side known), and the bulk screen (nothing known). Same control
 * everywhere, so "caption, then tag Venue / Client" is learned once.
 *
 * Each photo is its OWN entry with its own caption and tags — Mason: "allow
 * uploading multiple images and each can be tagged for either/both and notes
 * can be blank IF they have an image." The top-level toggles set every photo
 * at once; a per-photo toggle overrides just that one.
 *
 * Photos tell us things before you type: the EXIF date proposes the gig, the
 * GPS proposes the venue. Both are pre-filled pickers, never silent writes —
 * a wrong guess costs one tap.
 */

interface Item {
  key: string;
  file: File;
  prep: PreparedImage | null;
  caption: string;
  aboutVenue: boolean;
  aboutClient: boolean;
  status: "preparing" | "ready" | "uploading" | "done" | "error";
  error?: string;
}

export function NoteComposer({
  eventId,
  venue: venueProp,
  client: clientProp,
  lockVenue,
  lockClient,
  onSaved,
  onCancel,
}: {
  /** The gig, when the host already knows it (the event page). */
  eventId?: string;
  venue?: ComboValue | null;
  client?: ComboValue | null;
  /** On a venue page the venue is the page; it is not a choice. */
  lockVenue?: boolean;
  lockClient?: boolean;
  onSaved: (notes: IntelNote[]) => void;
  onCancel?: () => void;
}) {
  const [subject, setSubject] = useState<Subject>({ venue: venueProp ?? null, client: clientProp ?? null, gig: null });
  const { venue, client, gig } = subject;
  const [text, setText] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [allVenue, setAllVenue] = useState(true);
  const [allClient, setAllClient] = useState(true);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Slots already PUT, by item key — survives a failed POST so a retry reuses
   * the uploaded bytes instead of silently posting text-only (review finding).
   */
  const keyed = useRef(new Map<string, { storageKey: string; thumbKey: string }>());
  /** Live preview URLs, revoked on remove/unmount — never from an effect on `items`. */
  const previews = useRef(new Set<string>());
  useEffect(() => () => { for (const u of previews.current) URL.revokeObjectURL(u); }, []);
  useEffect(() => { if (venueProp !== undefined) setSubject((s) => ({ ...s, venue: venueProp })); }, [venueProp]);
  useEffect(() => { if (clientProp !== undefined) setSubject((s) => ({ ...s, client: clientProp })); }, [clientProp]);

  /* ── Photos in ─────────────────────────────────────────────────────────── */

  const onDrop = useCallback((accepted: File[]) => {
    if (!accepted.length) return;
    const fresh: Item[] = accepted.map((file) => ({
      key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
      file, prep: null, caption: "", aboutVenue: allVenue, aboutClient: allClient, status: "preparing",
    }));
    setItems((xs) => [...xs, ...fresh]);
    // Prepare sequentially — decoding twelve 12MP frames at once is how a
    // phone tab gets killed for memory.
    (async () => {
      for (const it of fresh) {
        try {
          const prep = await prepareImage(it.file);
          previews.current.add(prep.previewUrl);
          setItems((xs) => xs.map((x) => (x.key === it.key ? { ...x, prep, status: "ready" } : x)));
        } catch {
          setItems((xs) => xs.map((x) => (x.key === it.key ? { ...x, status: "error", error: unreadable(it.file) } : x)));
        }
      }
    })();
  }, [allVenue, allClient]);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: { "image/*": [] },
    noClick: true,
    useFsAccessApi: false,
  });

  const remove = (key: string) =>
    setItems((xs) => {
      const it = xs.find((x) => x.key === key);
      if (it?.prep) { URL.revokeObjectURL(it.prep.previewUrl); previews.current.delete(it.prep.previewUrl); }
      return xs.filter((x) => x.key !== key);
    });

  /* ── What the photos know ──────────────────────────────────────────────── */

  const near = useMemo(() => items.find((i) => i.prep?.gps)?.prep?.gps ?? null, [items]);
  const takenOn = useMemo(() => {
    const dates = items.map((i) => i.prep?.takenAt).filter((d): d is string => !!d).sort();
    return dates.length ? dates[Math.floor(dates.length / 2)] : null;
  }, [items]);

  /* ── Save ──────────────────────────────────────────────────────────────── */

  const ready = items.filter((i) => i.status === "ready" || i.status === "done");
  const preparing = items.some((i) => i.status === "preparing");
  const hasSubject = !!(eventId || gig || venue || client);
  const hasContent = !!text.trim() || ready.length > 0;
  const canSave = hasSubject && hasContent && !preparing && !saving;

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      // Everything with bytes: not-yet-uploaded AND already-uploaded (a retry).
      const photos = items.filter((i) => (i.status === "ready" || i.status === "done") && i.prep);
      const pending = photos.filter((i) => !keyed.current.has(i.key));
      let slots: { storageKey: string; thumbKey: string; putUrl: string; thumbPutUrl: string }[] = [];
      if (pending.length) {
        const p = await fetch("/api/intel/notes/presign", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ count: pending.length }),
        });
        const pj = await p.json();
        if (!p.ok) throw new Error(pj.error ?? "Could not prepare upload");
        slots = pj.slots;
      }
      setProgress({ done: photos.length - pending.length, total: photos.length });
      // Four at a time: enough to fill a hotel uplink, few enough to survive it.
      let next = 0;
      let done = photos.length - pending.length;
      const worker = async () => {
        while (next < pending.length) {
          const i = next++;
          const it = pending[i];
          const slot = slots[i];
          setItems((xs) => xs.map((x) => (x.key === it.key ? { ...x, status: "uploading" } : x)));
          await Promise.all([putBlob(slot.putUrl, it.prep!.full), putBlob(slot.thumbPutUrl, it.prep!.thumb)]);
          keyed.current.set(it.key, slot);
          done += 1;
          setProgress({ done, total: photos.length });
          setItems((xs) => xs.map((x) => (x.key === it.key ? { ...x, status: "done" } : x)));
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));

      const entries: Record<string, unknown>[] = [];
      if (text.trim()) entries.push({ body: text.trim(), aboutVenue: allVenue, aboutClient: allClient });
      for (const it of photos) {
        const slot = keyed.current.get(it.key)!;
        entries.push({
          body: it.caption.trim() || null,
          storageKey: slot.storageKey, thumbKey: slot.thumbKey,
          width: it.prep!.width, height: it.prep!.height, takenAt: it.prep!.takenAt,
          aboutVenue: it.aboutVenue, aboutClient: it.aboutClient,
        });
      }
      const res = await fetch("/api/intel/notes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: eventId ?? gig?.id ?? null,
          venueId: venue?.id ?? null,
          orgId: client?.id ?? null,
          entries,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Could not save");
      for (const it of items) if (it.prep) { URL.revokeObjectURL(it.prep.previewUrl); previews.current.delete(it.prep.previewUrl); }
      keyed.current.clear();
      setItems([]);
      setText("");
      setProgress(null);
      onSaved(j.notes as IntelNote[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      // Anything that finished uploading keeps its slot (`keyed`) and its
      // `done` status; a retry posts it without uploading again.
      setItems((xs) => xs.map((x) => (x.status === "uploading" ? { ...x, status: "ready" } : x)));
    } finally {
      setSaving(false);
    }
  };

  const setAll = (side: "venue" | "client", on: boolean) => {
    if (side === "venue") { setAllVenue(on); setItems((xs) => xs.map((x) => ({ ...x, aboutVenue: on }))); }
    else { setAllClient(on); setItems((xs) => xs.map((x) => ({ ...x, aboutClient: on }))); }
  };

  return (
    <div {...getRootProps()} className={`rounded-lg border bg-white p-4 sm:p-5 ${isDragActive ? "border-emerald-500 ring-2 ring-emerald-500/20" : "border-stone-200"}`}>
      <input {...getInputProps()} />

      {/* ── Where does this land ───────────────────────────────────────── */}
      <SubjectFields
        value={subject}
        onChange={setSubject}
        eventId={eventId}
        near={near}
        takenOn={takenOn}
        lockVenue={lockVenue}
        lockClient={lockClient}
      />

      {/* ── Text ───────────────────────────────────────────────────────── */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="A note — the loading dock, the power, who to ask for…"
        className={`${FIELD} mt-4 resize-y leading-relaxed`}
      />

      {/* ── Tags (for the note and, by default, every photo) ───────────── */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-stone-400">About</span>
        <Tag on={allVenue} onClick={() => setAll("venue", !allVenue)} disabled={!venue && !eventId && !gig}>Venue</Tag>
        <Tag on={allClient} onClick={() => setAll("client", !allClient)} disabled={!client && !eventId && !gig}>Client</Tag>
        {items.length > 1 && <span className="text-[12px] text-stone-300">sets every photo — change any one below</span>}
      </div>

      {/* ── Photos ─────────────────────────────────────────────────────── */}
      <div className="mt-4">
        {items.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2">
            {items.map((it) => (
              <li key={it.key} className="flex gap-3 rounded-md border border-stone-200 p-2">
                <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded bg-stone-100">
                  {it.prep ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.prep.previewUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[11px] text-stone-400">
                      {it.status === "error" ? "✕" : "…"}
                    </div>
                  )}
                  {(it.status === "uploading" || it.status === "done") && (
                    <div className={`absolute inset-x-0 bottom-0 h-1 ${it.status === "done" ? "bg-emerald-500" : "bg-emerald-500/50 animate-pulse"}`} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <input
                    value={it.caption}
                    onChange={(e) => setItems((xs) => xs.map((x) => (x.key === it.key ? { ...x, caption: e.target.value } : x)))}
                    placeholder="Caption — “don’t use these stairs, elevator to the right”"
                    className={`${FIELD} py-1.5 text-[13px]`}
                    disabled={saving}
                  />
                  <div className="mt-2 flex items-center gap-1.5">
                    <Tag small on={it.aboutVenue} onClick={() => setItems((xs) => xs.map((x) => (x.key === it.key ? { ...x, aboutVenue: !x.aboutVenue } : x)))}>Venue</Tag>
                    <Tag small on={it.aboutClient} onClick={() => setItems((xs) => xs.map((x) => (x.key === it.key ? { ...x, aboutClient: !x.aboutClient } : x)))}>Client</Tag>
                    <span className="ml-auto text-[11px] text-stone-400">
                      {it.status === "error" ? <span className="text-red-700">{it.error}</span>
                        : it.status === "preparing" ? "Reading…"
                        : it.prep?.takenAt ? new Date(it.prep.takenAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                        : null}
                    </span>
                    {!saving && (
                      <button type="button" onClick={() => remove(it.key)} className="text-stone-300 hover:text-stone-700" aria-label="Remove">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={open}
          disabled={saving}
          className={`mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md border border-dashed text-[13px] transition-colors ${
            isDragActive ? "border-emerald-500 text-emerald-700" : "border-stone-300 text-stone-500 hover:border-stone-400 hover:text-stone-700"
          }`}
        >
          <ImagePlus className="h-4 w-4" />
          {items.length ? "Add more photos" : "Add photos — or drop them here"}
        </button>
      </div>

      {/* ── Save ───────────────────────────────────────────────────────── */}
      {error && <p className="mt-3 text-[12px] text-red-700">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canSave}
          className="min-h-[40px] rounded-md border border-stone-800 bg-stone-900 px-4 text-[13px] text-white disabled:opacity-40"
        >
          {saving
            ? progress && progress.total ? `Uploading ${progress.done} of ${progress.total}…` : "Saving…"
            : ready.length ? `Save ${ready.length + (text.trim() ? 1 : 0)} ${ready.length + (text.trim() ? 1 : 0) === 1 ? "entry" : "entries"}` : "Save note"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={saving} className="text-[13px] text-stone-500 hover:text-stone-800">Cancel</button>
        )}
        {!hasSubject && <span className="text-[12px] text-stone-400">Pick a venue, a client, or a gig.</span>}
        {hasSubject && !hasContent && <span className="text-[12px] text-stone-400">Write a note or add a photo.</span>}
      </div>
    </div>
  );
}

/** iPhone camera rolls are HEIC by default, and Chrome cannot decode it. Say so. */
export function unreadable(file: File): string {
  return /heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name)
    ? "HEIC isn’t supported here — export as JPEG first"
    : "Couldn’t read this photo";
}
