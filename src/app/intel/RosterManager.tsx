"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
  const [band, setBand] = useState<"all" | "regular" | "other">("all");
  const [showArchived, setShowArchived] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/crew?archived=${showArchived ? "1" : "0"}`);
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not load");
      const j = await res.json();
      setPeople(j.crew);
      setKinds(j.kinds);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, [showArchived]);

  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    let list = people;
    if (band === "regular") list = list.filter((p) => p.is_regular);
    if (band === "other") list = list.filter((p) => !p.is_regular);
    if (s) {
      list = list.filter((p) =>
        [p.display_name, p.full_name, p.primary_email, p.city, p.kind]
          .some((f) => (f ?? "").toLowerCase().includes(s))
      );
    }
    return list;
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
    setPeople(people.filter((p) => !ids.includes(p.id)));
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
          <div className="mt-2 flex gap-1">
            {([["all","All"],["regular","Regulars"],["other","Non-regulars"]] as const).map(([k,label]) => (
              <button
                key={k}
                onClick={() => setBand(k)}
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
                      ? people.filter((p) => p.is_regular).length
                      : people.filter((p) => !p.is_regular).length}
                  </span>
                )}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[13px] text-stone-500">
            {people.length} {showArchived ? "archived" : "active"}
            {q && ` · ${shown.length} matching`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email, city…"
            className={`${FIELD} w-56`}
          />
          <button
            onClick={() => { setShowArchived((v) => !v); setPicked(new Set()); }}
            className="text-[12px] text-stone-500 underline underline-offset-4 hover:text-stone-800"
          >
            {showArchived ? "Show active" : "Show archived"}
          </button>
          <button
            onClick={() => setAddOpen((v) => !v)}
            className="rounded-md border border-stone-800 bg-stone-900 px-3 py-1.5 text-[13px] text-white transition-colors hover:bg-stone-700"
          >
            {addOpen ? "Cancel" : "Add person"}
          </button>
        </div>
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
            <button
              onClick={() => void archiveMany([...picked], !showArchived)}
              className="text-[13px] text-stone-700 underline underline-offset-4 hover:text-stone-900"
            >
              {showArchived ? "Restore" : "Archive"} {picked.size}
            </button>
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
                        <span className="text-[14px] text-stone-900">{p.display_name}</span>
                        <span className="text-[11px] text-stone-400">{p.kind}</span>
                        {p.city && <span className="text-[11px] text-stone-400">· {p.city}</span>}
                        {p.eventCount > 0 && (
                          <span className="text-[11px] text-stone-400">
                            · {p.eventCount} event{p.eventCount === 1 ? "" : "s"}
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
                      onClick={() => void (showArchived ? archiveMany([p.id], false) : remove(p))}
                      title={
                        showArchived ? "Restore"
                        : p.eventCount > 0 ? `On ${p.eventCount} events — archives instead of deleting`
                        : "Delete"
                      }
                      className="text-[12px] text-stone-400 hover:text-red-700"
                    >
                      {showArchived ? "Restore" : p.eventCount > 0 ? "Archive" : "Delete"}
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>

        {shown.length === 0 && (
          <p className="py-6 text-[13px] text-stone-400">
            {q ? `Nobody matches “${q}”.` : showArchived ? "Nobody archived." : "Nobody on the roster."}
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
      <div className="sm:col-span-2 flex items-center gap-3">
        <button
          onClick={() => onSave({
            display_name: f.display_name.trim(),
            primary_email: f.primary_email.trim() || null,
            kind: f.kind,
            city: f.city.trim() || null,
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
