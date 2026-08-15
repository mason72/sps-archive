"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

/**
 * Who worked this event, and where — on the event page, where it was looked for.
 *
 * `/intel` answers "which events did this PERSON work". Confirming an
 * assignment is the opposite question, and Mason went to the event page for it,
 * which is the right instinct: you review a gig while looking at the gig.
 *
 * INTERNAL. Venue logistics, client structure and rebook judgements about named
 * people who do not work here. Rendered only inside the owner's editor; there
 * is no share path to it and there must never be one.
 *
 * The load-bearing idea is that a GUESS MUST NEVER READ AS A FACT. The calendar
 * backfill filled 42 crew links by inference — a seniority ladder, gig type,
 * title order — and every one is marked `inferred`. Those render as provisional
 * and are excluded from any tally until a human touches them. Touching one is
 * what makes it true.
 */

interface CrewRow {
  crewId: string;
  name: string;
  kind: string | null;
  homeCity: string | null;
  canLead: string | null;
  roles: string[];
  rolesSource: string;
  wouldRebook: string | null;
  note: string | null;
}

interface IntelPayload {
  event: { id: string; name: string; date: string | null };
  confirmed: boolean;
  notes: string | null;
  venue: { id: string; name: string; address: string | null; city: string | null; region: string | null; notes: string | null } | null;
  crew: CrewRow[];
  orgs: { orgId: string; name: string; role: string }[];
  knownRoles: string[];
  roster: { id: string; name: string; kind: string; homeCity: string | null }[];
}

const META = "text-[11px] uppercase tracking-[0.14em] text-stone-400";

export function EventIntelPanel({ eventId }: { eventId: string }) {
  const [data, setData] = useState<IntelPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${eventId}/intel`);
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      // Say what went wrong. An empty panel and a failed fetch look identical.
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  /**
   * Write in the BACKGROUND; render the change now.
   *
   * The first version awaited the PATCH and then re-fetched the whole panel
   * before re-rendering — two round trips and a full re-render to toggle one
   * chip, which Mason clocked at "1-2 sec... very unresponsive for a simple
   * tool". He is right: nothing here needs a server round trip to be DRAWN.
   * The server is the record, not the renderer.
   *
   * So the local copy updates synchronously and the request goes out behind it.
   * On failure the previous state is restored and the error is shown — an
   * optimistic update that silently keeps a change the server rejected is worse
   * than a slow one, because it lies about what was saved.
   *
   * No refetch on success either: we already know what we sent, and refetching
   * is what made the rows jump around.
   */
  const applyLocal = (fn: (d: IntelPayload) => IntelPayload) =>
    setData((d) => (d ? fn(d) : d));

  const save = async (body: Record<string, unknown>, optimistic: (d: IntelPayload) => IntelPayload) => {
    const before = data;
    applyLocal(optimistic);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/intel`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
    } catch (e) {
      setData(before);            // put it back — never keep a rejected change
      setError(e instanceof Error ? e.message : "Save failed");
    }
  };

  /** Alphabetical, and it STAYS alphabetical — nothing reorders on a write. */
  const byName = (a: CrewRow, b: CrewRow) =>
    a.name.localeCompare(b.name, "en", { sensitivity: "base" });

  const setCrew = (crewId: string, patch: Partial<CrewRow>) => (d: IntelPayload) => ({
    ...d,
    crew: d.crew
      .map((c) => (c.crewId === crewId ? { ...c, ...patch, rolesSource: "manual" } : c))
      .sort(byName),
  });

  if (error && !data) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-16">
        <p className="text-[14px] text-red-700">{error}</p>
        <button onClick={() => void load()} className="mt-3 text-[13px] text-stone-600 underline underline-offset-4">
          Try again
        </button>
      </div>
    );
  }
  if (!data) return <div className="px-8 py-16 text-[13px] text-stone-400">Loading intel…</div>;

  const unconfirmed = data.crew.filter((c) => c.rolesSource !== "manual" && c.roles.length).length;

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <header className="pb-5">
        <h2 className="font-editorial text-[28px] leading-tight text-stone-900">
          Who worked this, and where
        </h2>
        <p className="mt-1.5 text-[13px] text-stone-500">
          Back-office only — never visible to a client.{" "}
          {unconfirmed > 0 ? (
            <>
              <span className="text-stone-800">{unconfirmed}</span>{" "}
              {unconfirmed === 1 ? "assignment is" : "assignments are"} still a guess.
            </>
          ) : data.crew.length ? (
            "Every assignment here is confirmed."
          ) : null}
        </p>
      </header>
      <div className="h-px bg-stone-200" />

      {/* ── Venue ─────────────────────────────────────────────────────────── */}
      <section className="mt-8">
        <span className={META}>Venue</span>
        <div className="mt-3">
          {data.venue ? (
            <>
              <p className="text-[15px] text-stone-900">{data.venue.name}</p>
              {(data.venue.address || data.venue.city) && (
                <p className="mt-0.5 text-[13px] text-stone-500">
                  {[data.venue.address, data.venue.city, data.venue.region].filter(Boolean).join(", ")}
                </p>
              )}
              {data.venue.notes && (
                <p className="mt-3 whitespace-pre-wrap rounded-md bg-stone-50 p-3 text-[13px] leading-relaxed text-stone-700">
                  {data.venue.notes}
                </p>
              )}
            </>
          ) : (
            <p className="text-[13px] text-stone-400">
              No venue recorded. The calendar backfill sets this from a matched gig&apos;s location.
            </p>
          )}
        </div>
      </section>

      {/* ── Crew ──────────────────────────────────────────────────────────── */}
      <section className="mt-9">
        <div className="flex items-baseline justify-between">
          <span className={META}>
            Crew
            {data.crew.length > 0 && data.crew.every((c) => c.kind === "staff") && (
              /* Otherwise the rebook controls look broken rather than absent —
                 they are for temps, and this gig had none. */
              <span className="ml-2 normal-case tracking-normal text-stone-300">
                all staff — rebook notes appear for local hires
              </span>
            )}
          </span>
          <button
            onClick={() => setAdding((v) => !v)}
            className="text-[12px] text-stone-500 underline underline-offset-4 hover:text-stone-800"
          >
            {adding ? "Cancel" : "Add someone"}
          </button>
        </div>

        {adding && (
          <CrewPicker
            roster={data.roster.filter((r) => !data.crew.some((c) => c.crewId === r.id))}
            onPick={(person) => {
              setAdding(false);
              void save({ addCrewId: person.id }, (d) => ({
                ...d,
                crew: [
                  ...d.crew,
                  {
                    crewId: person.id, name: person.name, kind: person.kind ?? null,
                    homeCity: person.homeCity ?? null, canLead: null,
                    roles: [], rolesSource: "manual", wouldRebook: null, note: null,
                  },
                ].sort(byName),
              }));
            }}
            onCreated={(person) => {
              setAdding(false);
              // Straight into the crew list AND the roster, so a second event
              // that day finds them already there.
              applyLocal((d) => ({
                ...d,
                roster: [...d.roster, person].sort((a, b) => a.name.localeCompare(b.name)),
                crew: [
                  ...d.crew,
                  {
                    crewId: person.id, name: person.name, kind: person.kind,
                    homeCity: person.homeCity, canLead: null,
                    roles: [], rolesSource: "manual", wouldRebook: null, note: null,
                  },
                ].sort(byName),
              }));
            }}
            onCancel={() => setAdding(false)}
          />
        )}

        <div className="mt-3 divide-y divide-stone-100">
          {data.crew.length === 0 && (
            <p className="py-3 text-[13px] text-stone-400">
              Nobody linked yet. The backfill attaches crew from a matched calendar entry&apos;s attendees.
            </p>
          )}
          {data.crew.map((c) => (
            <CrewLine
              key={c.crewId}
              crew={c}
              knownRoles={data.knownRoles}
              onRoles={(roles) => void save({ crewId: c.crewId, roles }, setCrew(c.crewId, { roles }))}
              onRebook={(v) => void save({ crewId: c.crewId, wouldRebook: v }, setCrew(c.crewId, { wouldRebook: v }))}
              onNote={(v) => void save({ crewId: c.crewId, note: v }, setCrew(c.crewId, { note: v }))}
              onRemove={() =>
                void save({ crewId: c.crewId, remove: true }, (d) => ({
                  ...d, crew: d.crew.filter((x) => x.crewId !== c.crewId),
                }))
              }
            />
          ))}
        </div>
      </section>

      {/* ── Client ────────────────────────────────────────────────────────── */}
      <section className="mt-9">
        <span className={META}>Client</span>
        <div className="mt-3 flex flex-wrap gap-2">
          {data.orgs.length === 0 && (
            <p className="text-[13px] text-stone-400">
              None recorded. An event can have several — the payer is the client; the end brand and
              the host are different companies and all three can be true.
            </p>
          )}
          {data.orgs.map((o) => (
            <span
              key={`${o.orgId}-${o.role}`}
              className="inline-flex items-center gap-2 rounded-full bg-stone-100 px-2.5 py-1 text-[12px] text-stone-600"
            >
              {o.name}
              <span className="text-stone-400">{o.role.replace(/_/g, " ")}</span>
            </span>
          ))}
        </div>
      </section>

      <div className="mt-10 flex items-center justify-between border-t border-stone-200 pt-4">
        <p className="text-[12px] text-stone-400">
          Roles you set are never overwritten by the calendar backfill.
        </p>
        <Link href="/intel" className="text-[12px] text-stone-500 underline underline-offset-4 hover:text-stone-800">
          All intel →
        </Link>
      </div>
    </div>
  );
}

/* ── One person's assignment ─────────────────────────────────────────────── */

function CrewLine({
  crew, knownRoles, onRoles, onRebook, onNote, onRemove,
}: {
  crew: CrewRow;
  knownRoles: string[];
  onRoles: (roles: string[]) => void;
  onRebook: (v: string | null) => void;
  onNote: (v: string) => void;
  onRemove: () => void;
}) {
  const [note, setNote] = useState(crew.note ?? "");
  const [openNote, setOpenNote] = useState(false);
  const guessed = crew.rolesSource !== "manual";

  /**
   * Rebook and notes are for people who DON'T work here.
   *
   * Mason: "we only need the yes/no/maybe/notes for NON CREW (temps)". You do
   * not file a rehire judgement on your own team — the question is meaningless
   * for staff and the control is noise on every row. `kind` is decided once per
   * PERSON when they are merged (staff | local | client | other), never derived
   * per gig, so this is stable: Joey never reads as a local hire on an old
   * event just because that record carried a personal address.
   */
  const isTemp = crew.kind !== "staff";

  const toggle = (role: string) => {
    const next = crew.roles.includes(role)
      ? crew.roles.filter((r) => r !== role)
      : [...crew.roles, role];
    onRoles(next);
  };

  return (
    <div className="py-4">
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <span className="text-[15px] text-stone-900">{crew.name}</span>
          {crew.homeCity && <span className="ml-2 text-[12px] text-stone-400">{crew.homeCity}</span>}
          {crew.kind && crew.kind !== "staff" && (
            <span className="ml-2 text-[11px] text-stone-400">{crew.kind}</span>
          )}
          {guessed && crew.roles.length > 0 && (
            <span
              className="ml-2 text-[11px] italic text-stone-400"
              title="Guessed from the calendar — click a role to confirm or change it"
            >
              guessed
            </span>
          )}
        </div>
        <button
          onClick={onRemove}
          className="shrink-0 text-[11px] text-stone-300 transition-colors hover:text-red-700"
          title="Remove from this event"
        >
          Remove
        </button>
      </div>

      {/* Roles. Clicking any chip is what turns a guess into a decision. */}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {knownRoles.map((role) => {
          const on = crew.roles.includes(role);
          return (
            <button
              key={role}
              onClick={() => toggle(role)}
              className={`rounded-full px-2.5 py-1 text-[12px] transition-colors duration-150 ${
                on
                  ? guessed
                    ? "border border-dashed border-stone-400 bg-white text-stone-600"
                    : "border border-stone-800 bg-stone-900 text-white"
                  : "border border-stone-200 bg-white text-stone-400 hover:border-stone-400 hover:text-stone-700"
              }`}
              title={on && guessed ? "Guessed — click to confirm" : on ? "Click to remove" : "Click to add"}
            >
              {role}
            </button>
          );
        })}
      </div>

      {isTemp && (
      <div className="mt-2.5 flex flex-wrap items-center gap-4">
        {/* Severity ramp, never the brand accent — a green "yes" beside an
            emerald selection makes the accent mean two things at once. */}
        <span className="flex items-center gap-1.5">
          {(["yes", "maybe", "no"] as const).map((v) => {
            const on = crew.wouldRebook === v;
            const dot = v === "yes" ? "bg-stone-600" : v === "maybe" ? "bg-amber-600" : "bg-red-700";
            return (
              <button
                key={v}
                onClick={() => onRebook(on ? null : v)}
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[12px] transition-colors ${
                  on ? "bg-stone-100 text-stone-800" : "text-stone-400 hover:text-stone-700"
                }`}
                title={v === "yes" ? "Would rebook" : v === "no" ? "Would not rebook" : "Maybe"}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${on ? dot : "bg-stone-300"}`} />
                {v}
              </button>
            );
          })}
        </span>
        <button
          onClick={() => setOpenNote((v) => !v)}
          className="text-[12px] text-stone-400 underline underline-offset-4 hover:text-stone-700"
        >
          {crew.note ? "Note" : "Add note"}
        </button>
      </div>
      )}

      {isTemp && (openNote || crew.note) && (
        <div className="mt-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => { if (note !== (crew.note ?? "")) onNote(note); }}
            rows={2}
            placeholder="What happened, for next time"
            className="w-full rounded-md border border-stone-200 px-2.5 py-2 text-[13px] leading-relaxed text-stone-700 placeholder:text-stone-300 focus:border-stone-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
          />
        </div>
      )}
    </div>
  );
}

/**
 * Add someone to this gig: type their name.
 *
 * The first version was a bare `<select>` over 89 people with no search and no
 * way to add anyone new — which is useless for the actual job. A temp worked
 * today, you type their name, and either they are on the roster or you make
 * them right here. Mason should never have to leave the event, go to the
 * roster, add a person, come back, and find them.
 *
 * Anyone created here is `kind: "local"` — a temp. That is not a guess about
 * them; it is what "someone I am adding from an event page who is not already
 * on my roster" means, and it is the thing that makes the rebook and notes
 * controls appear for them. Staff are already on the roster.
 */
function CrewPicker({
  roster, onPick, onCreated, onCancel,
}: {
  roster: { id: string; name: string; kind: string; homeCity: string | null }[];
  onPick: (p: { id: string; name: string; kind: string; homeCity: string | null }) => void;
  onCreated: (p: { id: string; name: string; kind: string; homeCity: string | null }) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);

  const term = q.trim().toLowerCase();
  const matches = term
    ? roster.filter((r) => r.name.toLowerCase().includes(term) || (r.homeCity ?? "").toLowerCase().includes(term))
    : roster;
  // Offer to create only when nothing matches EXACTLY — a near-match should be
  // picked, not duplicated. Duplicate people are the failure this registry
  // exists to prevent.
  const exact = roster.some((r) => r.name.toLowerCase() === term);
  const canCreate = term.length >= 2 && !exact;
  const options = matches.slice(0, 8);

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/crew", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: q.trim(), kind: "local" }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Could not add");
      onCreated({ id: j.id, name: q.trim(), kind: "local", homeCity: null });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add");
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onCancel(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, options.length)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    if (e.key === "Enter") {
      e.preventDefault();
      if (cursor < options.length) onPick(options[cursor]);
      else if (canCreate) void create();
    }
  };

  return (
    <div className="mt-3 rounded-md border border-stone-200 bg-white p-3">
      <input
        autoFocus
        value={q}
        onChange={(e) => { setQ(e.target.value); setCursor(0); }}
        onKeyDown={onKey}
        placeholder="Type a name — or a new one to add them"
        className="w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-[13px] text-stone-800 placeholder:text-stone-300 focus:border-stone-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
      />

      <ul className="mt-2 max-h-60 overflow-y-auto">
        {options.map((r, i) => (
          <li key={r.id}>
            <button
              onMouseEnter={() => setCursor(i)}
              onClick={() => onPick(r)}
              className={`flex w-full items-baseline justify-between gap-3 rounded px-2 py-1.5 text-left text-[13px] ${
                i === cursor ? "bg-stone-100 text-stone-900" : "text-stone-700 hover:bg-stone-50"
              }`}
            >
              <span>{r.name}</span>
              <span className="text-[11px] text-stone-400">
                {[r.kind !== "staff" ? r.kind : null, r.homeCity].filter(Boolean).join(" · ")}
              </span>
            </button>
          </li>
        ))}

        {canCreate && (
          <li>
            <button
              onMouseEnter={() => setCursor(options.length)}
              onClick={() => void create()}
              disabled={busy}
              className={`flex w-full items-baseline justify-between gap-3 rounded px-2 py-1.5 text-left text-[13px] ${
                cursor === options.length ? "bg-stone-100 text-stone-900" : "text-stone-700 hover:bg-stone-50"
              }`}
            >
              <span>{busy ? "Adding…" : <>Add <span className="text-stone-900">“{q.trim()}”</span> as a temp</>}</span>
              <span className="text-[11px] text-stone-400">new</span>
            </button>
          </li>
        )}

        {options.length === 0 && !canCreate && (
          <li className="px-2 py-2 text-[12px] text-stone-400">
            {term ? "No match — type at least two characters to add someone new." : "Nobody left to add."}
          </li>
        )}
      </ul>

      {err && <p className="mt-2 text-[12px] text-red-700">{err}</p>}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-stone-300">↑↓ to move · Enter to choose · Esc to close</span>
        <button onClick={onCancel} className="text-[12px] text-stone-500 hover:text-stone-800">Cancel</button>
      </div>
    </div>
  );
}
