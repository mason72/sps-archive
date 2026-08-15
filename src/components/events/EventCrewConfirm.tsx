"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * "Is this who worked it?" — on the first screen, under the photos.
 *
 * Mason: "Where do people confirm staff? I was assuming it would be on the
 * first screen (maybe below the main content)." Right. The full Intel panel is
 * a tab you have to know exists, which is fine for editing and useless as a
 * prompt. A confirmation you have to go looking for is not a confirmation.
 *
 * This is a TO-DO, not a permanent panel: it renders only while something is
 * unconfirmed, and disappears the moment the last guess is answered. Nothing to
 * dismiss, nothing to collapse, no empty state occupying the page forever.
 *
 * The calendar knows who was invited; it does not know what they did. So the
 * people are usually right and the roles are the guess — which is why the whole
 * thing can be accepted in one click, and any single role corrected in one
 * more.
 */

interface CrewRow {
  crewId: string;
  name: string;
  isRegular: boolean;
  roles: string[];
  confirmedRoles: string[];
}

export function EventCrewConfirm({ eventId }: { eventId: string }) {
  const [crew, setCrew] = useState<CrewRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${eventId}/intel`);
      if (!res.ok) return;                     // silent: this is a nudge, not a feature
      const j = await res.json();
      setCrew(j.crew ?? []);
    } catch {
      /* A prompt that cannot load simply does not appear. */
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  if (!crew || done) return null;

  const pending = crew.filter((c) => c.roles.some((r) => !c.confirmedRoles.includes(r)));
  if (pending.length === 0) return null;

  const patch = async (body: Record<string, unknown>) => {
    await fetch(`/api/events/${eventId}/intel`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  };

  /** Accept the calendar's whole reading of this gig. */
  const confirmAll = async () => {
    setBusy(true);
    // Optimistic: the strip should vanish on click, not after N round trips.
    setDone(true);
    for (const c of pending) {
      await patch({ crewId: c.crewId, roles: c.roles, confirmedRoles: c.roles });
    }
    setBusy(false);
  };

  /** Confirm one role, leaving the rest of that person's guesses alone. */
  const confirmRole = async (c: CrewRow, role: string) => {
    const confirmed = [...new Set([...c.confirmedRoles, role])];
    setCrew((list) =>
      (list ?? []).map((x) => (x.crewId === c.crewId ? { ...x, confirmedRoles: confirmed } : x))
    );
    await patch({ crewId: c.crewId, roles: c.roles, confirmedRoles: confirmed });
  };

  /** Drop a role the calendar guessed wrong. */
  const dropRole = async (c: CrewRow, role: string) => {
    const roles = c.roles.filter((r) => r !== role);
    const confirmed = c.confirmedRoles.filter((r) => r !== role);
    setCrew((list) =>
      (list ?? []).map((x) =>
        x.crewId === c.crewId ? { ...x, roles, confirmedRoles: confirmed } : x
      )
    );
    await patch({ crewId: c.crewId, roles, confirmedRoles: confirmed });
  };

  return (
    <div className="mx-8 mb-16 mt-4 md:mx-16">
      <div className="rounded-lg border border-stone-200 bg-white px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <span className="text-[11px] uppercase tracking-[0.14em] text-stone-400">
              From the calendar
            </span>
            <p className="mt-1 text-[14px] text-stone-700">
              {pending.length === 1 ? "One assignment is" : `${pending.length} assignments are`}{" "}
              still a guess. Is this who worked it?
            </p>
          </div>
          <button
            onClick={() => void confirmAll()}
            disabled={busy}
            className="rounded-md border border-stone-800 bg-stone-900 px-3 py-1.5 text-[13px] text-white transition-colors hover:bg-stone-700 disabled:opacity-50"
          >
            Looks right
          </button>
        </div>

        <ul className="mt-4 divide-y divide-stone-100">
          {pending.map((c) => (
            <li key={c.crewId} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
              <span className="text-[14px] text-stone-900">{c.name}</span>
              {!c.isRegular && <span className="text-[11px] text-stone-400">not a regular</span>}
              <span className="flex flex-wrap gap-1.5">
                {c.roles.map((role) => {
                  const confirmed = c.confirmedRoles.includes(role);
                  return (
                    <span key={role} className="inline-flex items-center">
                      <button
                        onClick={() => void (confirmed ? dropRole(c, role) : confirmRole(c, role))}
                        title={confirmed ? "Confirmed — click to remove" : "Click to confirm"}
                        className={`rounded-full px-2.5 py-1 text-[12px] transition-colors ${
                          confirmed
                            ? "border border-stone-800 bg-stone-900 text-white"
                            : "border border-dashed border-stone-400 bg-white text-stone-600 hover:border-stone-800 hover:text-stone-900"
                        }`}
                      >
                        {role}
                      </button>
                      {!confirmed && (
                        <button
                          onClick={() => void dropRole(c, role)}
                          title="They did not do this"
                          className="ml-1 text-[13px] leading-none text-stone-300 transition-colors hover:text-red-700"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  );
                })}
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-3 text-[11px] text-stone-400">
          Anything you confirm here is never overwritten by the calendar again. Venue, client and
          the rest live in the Intel tab above.
        </p>
      </div>
    </div>
  );
}
