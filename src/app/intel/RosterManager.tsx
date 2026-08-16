"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatLastHired } from "@/lib/event-intel/last-hired";
import { MonthPicker } from "@/components/ui/date-picker";

/**
 * The roster, editable.
 *
 * 89 people arrived from a spreadsheet import with no way to touch them since —
 * no search, no adding, no removing. Mason: "the roster is ridiculous... I need
 * to remove like 80% of the people on that list."
 *
 * So: search, multi-select, bulk archive, inline edit, and add. Removing 70
 * people has to be a couple of gestures, not seventy.
 *
 * ARCHIVE is the default removal. `event_crew` references these rows, so
 * deleting someone who worked a 2018 gig would take that history with them.
 * Archiving drops them out of every picker and keeps the record. A real delete
 * is offered only for people on no events, and the server verifies that rather
 * than trusting this component.
 */

interface Person {
  id: string;
  display_name: string;
  full_name: string | null;
  primary_email: string | null;
  kind: string;
  city: string | null;
  can_lead: string | null;
  travels: boolean | null;
  archived: boolean;
  notes: string | null;
  eventCount: number;
  is_regular: boolean;
  /** Hand-entered seed month (YYYY-MM-01) — what the editor edits. */
  last_hired_on: string | null;
  /** The EFFECTIVE date: max(seed, newest linked event). What displays. */
  lastHired: string | null;
}

const META = "text-[11px] uppercase tracking-[0.14em] text-stone-400";
const FIELD =
  "w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-[13px] text-stone-800 placeholder:text-stone-300 focus:border-stone-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/25";

export function RosterManager() {
  const [people, setPeople] = useState<Person[]>([]);
  const [kinds, setKinds] = useState<string[]>([]);
  const [q, setQ] = useState("");
  /**
   * Regular is MARKED, never derived from an event count. The calendar backfill
   * covers 23 of 27 events, so a count would call a regular new and a one-off
   * prolific — and this is the list Mason picks from under time pressure.
   */
  const [band, setBand] = useState<"all" | "regular" | "other" | "archived">("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * EVERYONE, always — archived included, flagged per row.
   *
   * The old shape fetched active OR archived behind a "Show archived" toggle,
   * and Mason couldn't find the archived at all: "there's no way to find
   * archived people... they should show up in search if I type their name in."
   * Archived is now a BAND beside the others, and search deliberately ignores
   * the band entirely (see `shown`), so a typed name finds the person whatever
   * their state — with an `archived` chip saying which state that is.
   */
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/crew?archived=1`);
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not load");
      const j = await res.json();
      setPeople(j.crew);
      setKinds(j.kinds);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s) {
      // Search spans EVERYONE — a band is a browsing cut, and a typed name is
      // a question about a specific person whose state you may not know.
      return people.filter((p) =>
        [p.display_name, p.full_name, p.primary_email, p.city, p.kind]
          .some((f) => (f ?? "").toLowerCase().includes(s))
      );
    }
    if (band === "archived") return people.filter((p) => p.archived);
    const active = people.filter((p) => !p.archived);
    if (band === "regular") return active.filter((p) => p.is_regular);
    if (band === "other") return active.filter((p) => !p.is_regular);
    return active;
  }, [people, q, band]);

  /** Optimistic, like the rest of this feature — the server is the record, not the renderer. */
  const mutate = async (body: Record<string, unknown>, local: (list: Person[]) => Person[]) => {
    const before = people;
    setPeople(local(people));
    setError(null);
    try {
      const res = await fetch("/api/crew", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
    } catch (e) {
      setPeople(before);
      setError(e instanceof Error ? e.message : "Save failed");
    }
  };

  const archiveMany = async (ids: string[], archived: boolean) => {
    const before = people;
    // FLIP, don't remove: everyone stays loaded, and an archived person just
    // moves bands — removing them locally would make Restore look like delete.
    setPeople(people.map((p) => (ids.includes(p.id) ? { ...p, archived } : p)));
    setPicked(new Set());
    try {
      // Sequential rather than parallel: 70 concurrent writes against one table
      // is a burst for no benefit, and a partial failure is easier to reason
      // about when the order is known.
      for (const id of ids) {
        const res = await fetch("/api/crew", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, archived }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      }
    } catch (e) {
      setPeople(before);
      setError(e instanceof Error ? e.message : "Some rows did not save");
    }
  };

  const remove = async (p: Person) => {
    if (p.eventCount > 0) { void archiveMany([p.id], true); return; }
    const before = people;
    setPeople(people.filter((x) => x.id !== p.id));
    try {
      const res = await fetch(`/api/crew?id=${p.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not delete");
    } catch (e) {
      setPeople(before);
      setError(e instanceof Error ? e.message : "Could not delete");
    }
  };

  const allPickedOnScreen = shown.length > 0 && shown.every((p) => picked.has(p.id));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className={META}>Roster</span>
          <div className="mt-2 flex flex-wrap gap-1">
            {([["all","All"],["regular","Regulars"],["other","Non-regulars"],["archived","Alumni"]] as const).map(([k,label]) => (
              <button
                key={k}
                onClick={() => { setBand(k); setPicked(new Set()); }}
                className={`rounded-full px-2.5 py-1 text-[12px] transition-colors ${
                  band === k
                    ? "bg-stone-900 text-white"
                    : "border border-stone-200 text-stone-500 hover:border-stone-400 hover:text-stone-800"
                }`}
              >
                {label}
                {k !== "all" && (
                  <span className="ml-1.5 tabular-nums opacity-60">
                    {k === "regular"
                      ? people.filter((p) => p.is_regular && !p.archived).length
                      : k === "other"
                        ? people.filter((p) => !p.is_regular && !p.archived).length
                        : people.filter((p) => p.archived).length}
                  </span>
                )}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[13px] text-stone-500">
            {people.filter((p) => !p.archived).length} active
            {q && ` · ${shown.length} matching (alumni included)`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setAddOpen((v) => !v)}
            className="rounded-md border border-stone-800 bg-stone-900 px-3 py-1.5 text-[13px] text-white transition-colors hover:bg-stone-700"
          >
            {addOpen ? "Cancel" : "Add person"}
          </button>
        </div>
      </div>

      {/* Search sits ABOVE THE LIST IT SEARCHES — the same rule the pivot axes
          follow, and Mason had to point out this tab had been skipped: "Roster
          tab still has Search top-right instead of above the list of names."
          Top-right it read as page chrome; here, the thing it filters is the
          next thing you look at. */}
      <div className="mt-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, email, city…"
          className={`${FIELD} max-w-sm`}
        />
      </div>

      {error && <p className="mt-3 text-[13px] text-red-700">{error}</p>}

      {addOpen && <AddPerson kinds={kinds} onDone={() => { setAddOpen(false); void load(); }} />}

      {/* Bulk bar — the whole point is that clearing 70 people is two gestures. */}
      {picked.size > 0 && (
        <div className="mt-4 flex items-center justify-between rounded-md border border-stone-300 bg-white px-3 py-2">
          <span className="text-[13px] text-stone-700">{picked.size} selected</span>
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                const ids = [...picked];
                setPicked(new Set());
                void Promise.all(
                  ids.map((id) =>
                    mutate({ id, is_regular: true }, (list) =>
                      list.map((x) => (x.id === id ? { ...x, is_regular: true } : x))
                    )
                  )
                );
              }}
              className="text-[13px] text-stone-700 underline underline-offset-4 hover:text-stone-900"
            >
              Mark regular
            </button>
            {/* Search can mix archived and active into one selection, so the
                bulk actions split by the rows' ACTUAL state instead of a mode:
                each button names exactly what it will touch. */}
            {(() => {
              const activePicked = [...picked].filter((id) => people.find((p) => p.id === id && !p.archived));
              const archivedPicked = [...picked].filter((id) => people.find((p) => p.id === id && p.archived));
              return (
                <>
                  {activePicked.length > 0 && (
                    <button
                      onClick={() => void archiveMany(activePicked, true)}
                      className="text-[13px] text-stone-700 underline underline-offset-4 hover:text-stone-900"
                    >
                      Move to alumni {activePicked.length}
                    </button>
                  )}
                  {archivedPicked.length > 0 && (
                    <button
                      onClick={() => void archiveMany(archivedPicked, false)}
                      className="text-[13px] text-stone-700 underline underline-offset-4 hover:text-stone-900"
                    >
                      Restore {archivedPicked.length}
                    </button>
                  )}
                </>
              );
            })()}
            <button onClick={() => setPicked(new Set())} className="text-[12px] text-stone-400 hover:text-stone-700">
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="mt-4">
        <label className="flex items-center gap-2 border-b border-stone-200 pb-2 text-[12px] text-stone-400">
          <input
            type="checkbox"
            checked={allPickedOnScreen}
            onChange={(e) =>
              setPicked(e.target.checked ? new Set(shown.map((p) => p.id)) : new Set())
            }
            className="accent-stone-800"
          />
          Select all {q ? "matching" : "shown"}
        </label>

        <ul className="divide-y divide-stone-100">
          {shown.map((p) => (
            <li key={p.id} className="py-2.5">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={picked.has(p.id)}
                  onChange={(e) =>
                    setPicked((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(p.id); else n.delete(p.id);
                      return n;
                    })
                  }
                  className="mt-1 accent-stone-800"
                />
                <div className="min-w-0 flex-1">
                  {editing === p.id ? (
                    <EditPerson
                      person={p}
                      kinds={kinds}
                      onCancel={() => setEditing(null)}
                      onSave={(patch) => { setEditing(null); void mutate({ id: p.id, ...patch },
                        (list) => list.map((x) => (x.id === p.id ? { ...x, ...patch } as Person : x))); }}
                    />
                  ) : (
                    <>
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <button
                          onClick={() =>
                            void mutate(
                              { id: p.id, is_regular: !p.is_regular },
                              (list) => list.map((x) => (x.id === p.id ? { ...x, is_regular: !x.is_regular } : x))
                            )
                          }
                          title={p.is_regular ? "A regular — click to unmark" : "Mark as a regular"}
                          className={`text-[13px] leading-none transition-colors ${
                            p.is_regular ? "text-stone-800" : "text-stone-200 hover:text-stone-500"
                          }`}
                          aria-pressed={p.is_regular}
                        >
                          ★
                        </button>
                        <span className={`text-[14px] ${p.archived ? "text-stone-500" : "text-stone-900"}`}>
                          {p.display_name}
                        </span>
                        {/* Search spans everyone, so a row must SAY when it is
                            archived — otherwise a found-by-name archived person
                            is indistinguishable from an active one. */}
                        {p.archived && (
                          <span className="rounded-full border border-stone-200 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.1em] text-stone-400">
                            alumni
                          </span>
                        )}
                        <span className="text-[11px] text-stone-400">{p.kind}</span>
                        {p.city && <span className="text-[11px] text-stone-400">· {p.city}</span>}
                        {p.eventCount > 0 && (
                          <span className="text-[11px] text-stone-400">
                            · {p.eventCount} event{p.eventCount === 1 ? "" : "s"}
                          </span>
                        )}
                        {/* Non-regulars only — your own team is not something
                            you track a last-hire date for. */}
                        {!p.is_regular && formatLastHired(p.lastHired, new Date()) && (
                          <span className="text-[11px] text-stone-400">
                            · hired {formatLastHired(p.lastHired, new Date())}
                          </span>
                        )}
                      </div>
                      {p.primary_email && (
                        <p className="text-[12px] text-stone-400">{p.primary_email}</p>
                      )}
                    </>
                  )}
                </div>
                {editing !== p.id && (
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      onClick={() => setEditing(p.id)}
                      className="text-[12px] text-stone-400 hover:text-stone-800"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => void (p.archived ? archiveMany([p.id], false) : remove(p))}
                      title={
                        p.archived ? "Bring them back to the active roster"
                        : p.eventCount > 0 ? `On ${p.eventCount} events — moves to alumni instead of deleting`
                        : "Delete"
                      }
                      className={`text-[12px] text-stone-400 ${p.archived ? "hover:text-stone-800" : "hover:text-red-700"}`}
                    >
                      {p.archived ? "Restore" : p.eventCount > 0 ? "Alumni" : "Delete"}
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>

        {shown.length === 0 && (
          <p className="py-6 text-[13px] text-stone-400">
            {q ? `Nobody matches “${q}” — alumni included.` : band === "archived" ? "Nobody in alumni." : "Nobody on the roster."}
          </p>
        )}
      </div>
    </div>
  );
}

function AddPerson({ kinds, onDone }: { kinds: string[]; onDone: () => void }) {
  const [f, setF] = useState({ display_name: "", primary_email: "", kind: "photographer", city: "" });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!f.display_name.trim()) { setErr("A name is required"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/crew", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not add");
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 rounded-md border border-stone-200 bg-white p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <input autoFocus placeholder="Name (what you call them)" value={f.display_name}
          onChange={(e) => setF({ ...f, display_name: e.target.value })} className={FIELD} />
        <input placeholder="Email (optional)" value={f.primary_email}
          onChange={(e) => setF({ ...f, primary_email: e.target.value })} className={FIELD} />
        <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} className={FIELD}>
          {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <input placeholder="City / region" value={f.city}
          onChange={(e) => setF({ ...f, city: e.target.value })} className={FIELD} />
      </div>
      {err && <p className="mt-2 text-[12px] text-red-700">{err}</p>}
      <div className="mt-3 flex items-center gap-3">
        <button onClick={() => void submit()} disabled={saving}
          className="rounded-md border border-stone-800 bg-stone-900 px-3 py-1.5 text-[13px] text-white disabled:opacity-50">
          {saving ? "Adding…" : "Add"}
        </button>
        <button onClick={onDone} className="text-[13px] text-stone-500 hover:text-stone-800">Cancel</button>
      </div>
    </div>
  );
}

function EditPerson({
  person, kinds, onSave, onCancel,
}: {
  person: Person;
  kinds: string[];
  onSave: (patch: Partial<Person>) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState({
    display_name: person.display_name,
    primary_email: person.primary_email ?? "",
    kind: person.kind,
    city: person.city ?? "",
    // The month input speaks YYYY-MM; the column stores the month's first day.
    last_hired_on: (person.last_hired_on ?? "").slice(0, 7),
  });
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} className={FIELD} />
      <input value={f.primary_email} placeholder="Email"
        onChange={(e) => setF({ ...f, primary_email: e.target.value })} className={FIELD} />
      <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} className={FIELD}>
        {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
      <input value={f.city} placeholder="City / region"
        onChange={(e) => setF({ ...f, city: e.target.value })} className={FIELD} />
      {/* The SEED month only — a newer linked event outranks it on display. */}
      {!person.is_regular && (
        <div className="flex items-center gap-2 text-[12px] text-stone-500 sm:col-span-2">
          Last hired
          <MonthPicker
            value={f.last_hired_on}
            onChange={(v) => setF({ ...f, last_hired_on: v })}
          />
          <span className="text-stone-300">linked events update this on their own</span>
        </div>
      )}
      <div className="sm:col-span-2 flex items-center gap-3">
        <button
          onClick={() => onSave({
            display_name: f.display_name.trim(),
            primary_email: f.primary_email.trim() || null,
            kind: f.kind,
            city: f.city.trim() || null,
            last_hired_on: f.last_hired_on || null,
          })}
          className="rounded-md border border-stone-800 bg-stone-900 px-3 py-1 text-[12px] text-white"
        >
          Save
        </button>
        <button onClick={onCancel} className="text-[12px] text-stone-500 hover:text-stone-800">Cancel</button>
      </div>
    </div>
  );
}
