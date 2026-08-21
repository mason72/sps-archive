"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { ImagePlus, X } from "lucide-react";
import { VenuePicker } from "./VenuePicker";
import { ClientPicker } from "./ClientPicker";
import type { ComboValue } from "./Combobox";
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

interface Gig { id: string; name: string; date: string | null }

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

const CHIP_ON = "border-emerald-500 bg-emerald-50 text-emerald-800";
const CHIP_OFF = "border-stone-200 bg-white text-stone-500 hover:border-stone-300";
const FIELD =
  "w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-[14px] text-stone-900 placeholder:text-stone-300 focus:border-stone-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/25";

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
  const [venue, setVenue] = useState<ComboValue | null>(venueProp ?? null);
  const [client, setClient] = useState<ComboValue | null>(clientProp ?? null);
  const [gig, setGig] = useState<Gig | null>(null);
  const [gigs, setGigs] = useState<Gig[]>([]);
  const [gigHint, setGigHint] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [allVenue, setAllVenue] = useState(true);
  const [allClient, setAllClient] = useState(true);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gigFilled = useRef(false);

  useEffect(() => { if (venueProp !== undefined) setVenue(venueProp); }, [venueProp]);
  useEffect(() => { if (clientProp !== undefined) setClient(clientProp); }, [clientProp]);

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
          setItems((xs) => xs.map((x) => (x.key === it.key ? { ...x, prep, status: "ready" } : x)));
        } catch {
          setItems((xs) => xs.map((x) => (x.key === it.key ? { ...x, status: "error", error: "Couldn’t read this photo" } : x)));
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

  useEffect(() => () => { for (const it of items) if (it.prep) URL.revokeObjectURL(it.prep.previewUrl); }, [items]);

  const remove = (key: string) =>
    setItems((xs) => {
      const it = xs.find((x) => x.key === key);
      if (it?.prep) URL.revokeObjectURL(it.prep.previewUrl);
      return xs.filter((x) => x.key !== key);
    });

  /* ── What the photos know ──────────────────────────────────────────────── */

  const near = useMemo(() => items.find((i) => i.prep?.gps)?.prep?.gps ?? null, [items]);
  const takenOn = useMemo(() => {
    const dates = items.map((i) => i.prep?.takenAt).filter((d): d is string => !!d).sort();
    return dates.length ? dates[Math.floor(dates.length / 2)] : null;
  }, [items]);

  // The gig list: at this venue, for this client, or on the photos' date.
  useEffect(() => {
    if (eventId) return;
    const sp = new URLSearchParams();
    if (venue) sp.set("venueId", venue.id);
    if (client) sp.set("orgId", client.id);
    if (takenOn) sp.set("on", takenOn);
    if (![...sp.keys()].length) { setGigs([]); return; }
    let alive = true;
    fetch(`/api/intel/gigs?${sp}`).then((r) => r.json()).then((j) => {
      if (!alive) return;
      const list = (j.gigs ?? []) as Gig[];
      setGigs(list);
      // Exactly one gig on the photos' date → propose it. Never more than one:
      // a guess between two is a coin flip dressed as help.
      if (takenOn && !gig && !gigFilled.current && list.length === 1) {
        setGig(list[0]);
        setGigHint("from the photos’ date");
        gigFilled.current = true;
      }
    }).catch(() => { if (alive) setGigs([]); });
    return () => { alive = false; };
  }, [venue, client, takenOn, eventId, gig]);

  // Picking a gig fills in what the gig knows, where nothing was chosen yet.
  const pickGig = async (g: Gig | null) => {
    setGig(g);
    setGigHint(null);
    if (!g) return;
    try {
      const r = await fetch(`/api/events/${g.id}/intel`);
      if (!r.ok) return;
      const j = await r.json();
      if (!venue && j.venue) setVenue({ id: j.venue.id, name: j.venue.name });
      const payer = (j.orgs ?? []).find((o: { role: string }) => o.role === "payer") ?? (j.orgs ?? [])[0];
      if (!client && payer) setClient({ id: payer.orgId, name: payer.name });
    } catch { /* the pickers still work by hand */ }
  };

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
      const photos = items.filter((i) => i.status === "ready" && i.prep);
      let slots: { storageKey: string; thumbKey: string; putUrl: string; thumbPutUrl: string }[] = [];
      if (photos.length) {
        const p = await fetch("/api/intel/notes/presign", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ count: photos.length }),
        });
        const pj = await p.json();
        if (!p.ok) throw new Error(pj.error ?? "Could not prepare upload");
        slots = pj.slots;
      }
      setProgress({ done: 0, total: photos.length });
      const keyed = new Map<string, (typeof slots)[number]>();
      // Four at a time: enough to fill a hotel uplink, few enough to survive it.
      let next = 0;
      let done = 0;
      const worker = async () => {
        while (next < photos.length) {
          const i = next++;
          const it = photos[i];
          const slot = slots[i];
          setItems((xs) => xs.map((x) => (x.key === it.key ? { ...x, status: "uploading" } : x)));
          await Promise.all([putBlob(slot.putUrl, it.prep!.full), putBlob(slot.thumbPutUrl, it.prep!.thumb)]);
          keyed.set(it.key, slot);
          done += 1;
          setProgress({ done, total: photos.length });
          setItems((xs) => xs.map((x) => (x.key === it.key ? { ...x, status: "done" } : x)));
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, photos.length) }, worker));

      const entries: Record<string, unknown>[] = [];
      if (text.trim()) entries.push({ body: text.trim(), aboutVenue: allVenue, aboutClient: allClient });
      for (const it of photos) {
        const slot = keyed.get(it.key)!;
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
      for (const it of items) if (it.prep) URL.revokeObjectURL(it.prep.previewUrl);
      setItems([]);
      setText("");
      setProgress(null);
      onSaved(j.notes as IntelNote[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      // Anything that uploaded stays uploaded; only the unsaved ones go back to ready.
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
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-stone-400">Venue</span>
          <VenuePicker value={venue} onChange={setVenue} near={near} disabled={lockVenue} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-stone-400">Client</span>
          <ClientPicker value={client} onChange={setClient} disabled={lockClient} />
        </label>
      </div>

      {!eventId && (
        <label className="mt-3 block">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-stone-400">
            Which gig <span className="normal-case tracking-normal text-stone-300">— optional</span>
            {gigHint && <span className="ml-2 normal-case tracking-normal text-emerald-700">{gigHint}</span>}
          </span>
          <select
            value={gig?.id ?? ""}
            onChange={(e) => void pickGig(gigs.find((g) => g.id === e.target.value) ?? null)}
            className={`${FIELD} min-h-[40px]`}
          >
            <option value="">{gigs.length ? "No particular gig" : venue || client || takenOn ? "No gigs found here yet" : "Pick a venue or client first"}</option>
            {gigs.map((g) => (
              <option key={g.id} value={g.id}>{g.name}{g.date ? ` · ${g.date}` : ""}</option>
            ))}
          </select>
        </label>
      )}

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

function Tag({ on, onClick, children, small, disabled }: { on: boolean; onClick: () => void; children: React.ReactNode; small?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border ${small ? "px-2 py-0.5 text-[11px]" : "min-h-[32px] px-3 text-[12px]"} transition-colors disabled:opacity-40 ${on ? CHIP_ON : CHIP_OFF}`}
    >
      {children}
    </button>
  );
}
