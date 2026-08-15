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
  const [busy, setBusy] = useState<string | null>(null);
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

  const patch = async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    try {
      const res = await fetch(`/api/events/${eventId}/intel`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  };

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
          <span className={META}>Crew</span>
          <button
            onClick={() => setAdding((v) => !v)}
            className="text-[12px] text-stone-500 underline underline-offset-4 hover:text-stone-800"
          >
            {adding ? "Cancel" : "Add someone"}
          </button>
        </div>

        {adding && (
          <div className="mt-3 rounded-md border border-stone-200 bg-white p-3">
            <select
              defaultValue=""
              onChange={(e) => { if (e.target.value) { void patch({ addCrewId: e.target.value }, "add"); setAdding(false); } }}
              className="w-full rounded-md border border-stone-200 px-2 py-1.5 text-[13px] text-stone-800 focus:border-stone-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
            >
              <option value="" disabled>Choose from the roster…</option>
              {data.roster
                .filter((r) => !data.crew.some((c) => c.crewId === r.id))
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}{r.homeCity ? ` — ${r.homeCity}` : ""}
                  </option>
                ))}
            </select>
          </div>
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
              busy={busy === c.crewId}
              onRoles={(roles) => void patch({ crewId: c.crewId, roles }, c.crewId)}
              onRebook={(v) => void patch({ crewId: c.crewId, wouldRebook: v }, c.crewId)}
              onNote={(v) => void patch({ crewId: c.crewId, note: v }, c.crewId)}
              onRemove={() => void patch({ crewId: c.crewId, remove: true }, c.crewId)}
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
  crew, knownRoles, busy, onRoles, onRebook, onNote, onRemove,
}: {
  crew: CrewRow;
  knownRoles: string[];
  busy: boolean;
  onRoles: (roles: string[]) => void;
  onRebook: (v: string | null) => void;
  onNote: (v: string) => void;
  onRemove: () => void;
}) {
  const [note, setNote] = useState(crew.note ?? "");
  const [openNote, setOpenNote] = useState(false);
  const guessed = crew.rolesSource !== "manual";

  const toggle = (role: string) => {
    const next = crew.roles.includes(role)
      ? crew.roles.filter((r) => r !== role)
      : [...crew.roles, role];
    onRoles(next);
  };

  return (
    <div className={`py-4 ${busy ? "opacity-50" : ""}`}>
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <span className="text-[15px] text-stone-900">{crew.name}</span>
          {crew.homeCity && <span className="ml-2 text-[12px] text-stone-400">{crew.homeCity}</span>}
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

      {(openNote || crew.note) && (
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
