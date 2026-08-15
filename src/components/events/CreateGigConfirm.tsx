"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Looking a gig up while you name the event — and confirming it before the
 * event exists.
 *
 * Mason, 2026-08-15: "I was assuming it would be on the very first screen where
 * you create the event. Where you enter the name and date. And it pre-populates
 * if you use the autocomplete."
 *
 * That is the ask this file answers, and it is the ask from the very start of
 * Event Intel: "the crew member who's uploading the event can simply confirm
 * it." What shipped before this confirmed an event that ALREADY existed — a
 * strip under the photos and a tab. Both are for correcting; neither is where
 * anyone is standing when the information is freshest.
 *
 * ── Two rules this component exists to hold ─────────────────────────────────
 *
 * 1. IT NEVER ARGUES WITH WHAT HE TYPED. Picking a gig fills the name only when
 *    what is in the box is a FRAGMENT of the calendar's label — "perkin" →
 *    "Perkin Elmer". A finished name he wrote on purpose is left exactly alone
 *    and the rename is offered as a chip he may ignore. `suggestEventName` is
 *    emphatic about why: the calendar label is an internal booking shorthand
 *    written to be recognised while scheduling, and his gallery names are
 *    usually better. A tool that overwrites his wording gets stopped being used.
 *
 * 2. A GUESS MUST NOT READ AS A FACT OR BEHAVE LIKE A DECISION. The calendar
 *    knows who was invited and never what they did, so people arrive selected
 *    and roles arrive empty — except a discipline implied by the person's own
 *    `kind`, which is the one inference the backfill also permits (a stylist
 *    styled). That one renders DASHED. Clicking it confirms it and only it;
 *    submitting sends dashed roles as roles and solid roles as confirmed. Same
 *    three states as the strip under the photos, deliberately, because it is
 *    the same question.
 */

export interface SuggestedGig {
  key: string;
  client: string | null;
  title: string;
  start: string;
  end: string;
  /** The day the JOB was shot — a grouped gig often starts on its set-up day. */
  shootDate: string;
  entryCount: number;
  city: string | null;
  venue: { name: string | null; street: string | null; city: string | null; raw: string } | null;
  crew: { crewId: string; name: string; isRegular: boolean; kind: string | null }[];
  unresolvedCrew: { email: string; displayName: string | null }[];
  orgs: { domain: string; orgId: string | null; name: string | null }[];
  calendarEventIds: string[];
  score: number;
  matchedOn: string[];
  dayGap: number | null;
}

export interface GigIntelPayload {
  venue: string | null;
  crew: { crewId: string; roles: string[]; confirmedRoles: string[] }[];
  orgDomains: string[];
  calendarEventIds: string[];
}

const DISCIPLINES = ["photographer", "stylist", "makeup artist"];

/** Per-person state on the card. `discipline` may be a guess; `lead` never is. */
interface CrewPick {
  on: boolean;
  lead: boolean;
  discipline: string | null;
  /** True while the discipline is the machine's inference, not his click. */
  disciplineIsGuess: boolean;
}

const fmtDay = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

const fmtRange = (start: string, end: string) =>
  start === end ? fmtDay(start) : `${fmtDay(start)} – ${fmtDay(end)}`;

/** The label a venue should show: its name, else the street, else the raw string. */
export function venueLabel(v: SuggestedGig["venue"]): string | null {
  if (!v) return null;
  return v.name || v.street || v.raw || null;
}

/**
 * Is what is typed merely the beginning of the calendar's label?
 *
 * Deliberately strict — a substring, and shorter. "perkin" is a fragment of
 * "Perkin Elmer"; "Perkin Elmer SKO 2018" is not a fragment of anything and is
 * a name he wrote.
 */
export function isFragmentOf(typed: string, label: string): boolean {
  const t = typed.trim().toLowerCase();
  const l = label.trim().toLowerCase();
  if (!t || !l) return false;
  return t.length < l.length && l.includes(t);
}

// ── the dropdown ────────────────────────────────────────────────────────────

export function GigDropdown({
  gigs,
  activeIndex,
  onPick,
  onHover,
}: {
  gigs: SuggestedGig[];
  activeIndex: number;
  onPick: (g: SuggestedGig) => void;
  onHover: (i: number) => void;
}) {
  if (!gigs.length) return null;
  return (
    <ul
      role="listbox"
      className="absolute left-0 right-0 top-full z-20 mt-1 max-h-80 overflow-y-auto border border-stone-200 bg-white shadow-[0_8px_24px_-12px_rgba(12,10,9,0.18)]"
    >
      {gigs.map((g, i) => {
        const venue = venueLabel(g.venue);
        const meta = [
          fmtRange(g.start, g.end),
          venue,
          g.crew.length ? `${g.crew.length} crew` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <li key={g.key}>
            <button
              type="button"
              role="option"
              aria-selected={i === activeIndex}
              onMouseEnter={() => onHover(i)}
              onClick={() => onPick(g)}
              className={`flex w-full flex-col items-start gap-0.5 border-l-2 px-4 py-3 text-left transition-colors ${
                i === activeIndex
                  ? "border-l-accent bg-stone-50"
                  : "border-l-transparent hover:bg-stone-50"
              }`}
            >
              <span className="text-[14px] leading-snug text-stone-900">{g.title}</span>
              <span className="text-[12px] text-stone-400">{meta}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ── the confirm card ────────────────────────────────────────────────────────

export function GigConfirmCard({
  gig,
  typedName,
  typedDate,
  onUseName,
  onUseDate,
  onClear,
  onChange,
}: {
  gig: SuggestedGig;
  typedName: string;
  typedDate: string;
  onUseName: (name: string) => void;
  onUseDate: (date: string) => void;
  onClear: () => void;
  onChange: (payload: GigIntelPayload) => void;
}) {
  const [picks, setPicks] = useState<Record<string, CrewPick>>({});

  // Seed once per gig: everyone on, discipline guessed from what they DO.
  useEffect(() => {
    const seed: Record<string, CrewPick> = {};
    for (const c of gig.crew) {
      const guess = c.kind && DISCIPLINES.includes(c.kind) ? c.kind : null;
      seed[c.crewId] = { on: true, lead: false, discipline: guess, disciplineIsGuess: !!guess };
    }
    setPicks(seed);
  }, [gig]);

  const payload = useMemo<GigIntelPayload>(() => {
    const crew = gig.crew
      .filter((c) => picks[c.crewId]?.on)
      .map((c) => {
        const p = picks[c.crewId];
        const roles = [...(p.lead ? ["lead"] : []), ...(p.discipline ? [p.discipline] : [])];
        // A guessed discipline is a role, not an endorsement. `lead` is only
        // ever here because he clicked it, so it is always confirmed.
        const confirmedRoles = roles.filter(
          (r) => !(r === p.discipline && p.disciplineIsGuess)
        );
        return { crewId: c.crewId, roles, confirmedRoles };
      });
    return {
      venue: gig.venue?.raw ?? null,
      crew,
      orgDomains: gig.orgs.map((o) => o.domain),
      calendarEventIds: gig.calendarEventIds,
    };
  }, [gig, picks]);

  useEffect(() => { onChange(payload); }, [payload, onChange]);

  const toggleOn = (id: string) =>
    setPicks((p) => ({ ...p, [id]: { ...p[id], on: !p[id]?.on } }));

  const toggleLead = (id: string) =>
    setPicks((p) => ({ ...p, [id]: { ...p[id], lead: !p[id]?.lead } }));

  /**
   * One discipline, three states.
   *
   *   outline  not on the gig  → click adds it, confirmed
   *   dashed   still a guess   → click CONFIRMS it, and only it
   *   solid    yours           → click removes it
   */
  const pickDiscipline = (id: string, role: string) =>
    setPicks((p) => {
      const cur = p[id];
      if (cur?.discipline === role) {
        if (cur.disciplineIsGuess) return { ...p, [id]: { ...cur, disciplineIsGuess: false } };
        return { ...p, [id]: { ...cur, discipline: null, disciplineIsGuess: false } };
      }
      return { ...p, [id]: { ...cur, discipline: role, disciplineIsGuess: false } };
    });

  const venue = venueLabel(gig.venue);
  const nameProposal = gig.client?.trim() || null;
  const offerName = !!nameProposal && nameProposal.toLowerCase() !== typedName.trim().toLowerCase();
  const dateMismatch = typedDate && typedDate !== gig.shootDate;

  return (
    <div className="border border-stone-200 bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-stone-100 px-5 py-4">
        <div>
          <span className="label-caps text-stone-400">From the calendar</span>
          <p className="mt-1 text-[15px] leading-snug text-stone-900">{gig.title}</p>
          <p className="mt-0.5 text-[12px] text-stone-400">
            {fmtRange(gig.start, gig.end)}
            {gig.entryCount > 1 && ` · ${gig.entryCount} entries`}
            {gig.city && ` · ${gig.city}`}
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-[12px] text-stone-400 underline-offset-4 transition-colors hover:text-stone-700 hover:underline"
        >
          Not this one
        </button>
      </div>

      {/* Offers, never applications: the two things the pick could overwrite. */}
      {(offerName || dateMismatch) && (
        <div className="flex flex-wrap gap-2 border-b border-stone-100 px-5 py-3">
          {offerName && nameProposal && (
            <button
              type="button"
              onClick={() => onUseName(nameProposal)}
              className="border border-stone-200 px-2.5 py-1 text-[12px] text-stone-600 transition-colors hover:border-stone-800 hover:text-stone-900"
            >
              Name it “{nameProposal}”
            </button>
          )}
          {dateMismatch && (
            <button
              type="button"
              onClick={() => onUseDate(gig.shootDate)}
              className="border border-stone-200 px-2.5 py-1 text-[12px] text-stone-600 transition-colors hover:border-stone-800 hover:text-stone-900"
            >
              Use {fmtDay(gig.shootDate)}
            </button>
          )}
        </div>
      )}

      <dl className="divide-y divide-stone-100">
        <div className="px-5 py-4">
          <dt className="label-caps mb-1.5 text-stone-400">Venue</dt>
          <dd className="text-[14px] text-stone-700">
            {venue ?? <span className="text-stone-400">The calendar named none</span>}
            {gig.venue?.city && <span className="text-stone-400"> · {gig.venue.city}</span>}
          </dd>
        </div>

        <div className="px-5 py-4">
          <dt className="label-caps mb-1 text-stone-400">Crew</dt>
          {gig.crew.length === 0 ? (
            <dd className="text-[14px] text-stone-400">
              Nobody on this entry matched your roster
              {gig.unresolvedCrew.length > 0 &&
                ` — ${gig.unresolvedCrew.length} attendee${gig.unresolvedCrew.length === 1 ? "" : "s"} unrecognised`}
            </dd>
          ) : (
            <>
              <p className="mb-3 text-[12px] text-stone-400">
                Everyone invited is on. Tap a role to say what they did — tinted and italic is
                still a guess, solid is yours.
              </p>
              <dd>
                <ul className="divide-y divide-stone-100">
                  {gig.crew.map((c) => {
                    const p = picks[c.crewId];
                    if (!p) return null;
                    return (
                      <li
                        key={c.crewId}
                        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2.5 first:pt-0"
                      >
                        {/**
                         * The name and its badge STACK.
                         *
                         * Beside each other they pushed the role chips past the
                         * card's width, so a local hire's row wrapped its chips
                         * onto a ragged second line while a regular's row did
                         * not — rows of two different heights for no reason a
                         * reader could see. Found by looking at it.
                         */}
                        <span className="min-w-0">
                          <button
                            type="button"
                            onClick={() => toggleOn(c.crewId)}
                            title={p.on ? "They were not here" : "Add them back"}
                            className={`block text-left text-[14px] transition-colors ${
                              p.on ? "text-stone-900" : "text-stone-300 line-through"
                            }`}
                          >
                            {c.name}
                          </button>
                          {!c.isRegular && p.on && (
                            <span className="block text-[11px] leading-tight text-stone-400">
                              not a regular
                            </span>
                          )}
                        </span>

                        {p.on && (
                          <span className="flex flex-wrap items-center gap-2">
                            {/**
                             * TWO DIFFERENT CONTROLS, because they are two
                             * different questions — and the shapes say so.
                             *
                             * `lead` is a FLAG: a squared-off chip that is on or
                             * off. The discipline is a CHOICE: one fully
                             * rounded segmented track where picking a segment
                             * necessarily un-picks the others. Rendering both
                             * as identical pills, which is what shipped first,
                             * made "stylist AND photographer" look like a legal
                             * combination — the API rejects it, so the UI
                             * should not offer it.
                             *
                             * The radius carries that distinction on its own,
                             * so the flag needs no status dot: with the shape
                             * already saying "toggle", a dot is decoration, and
                             * this system spends nothing on decoration. On, it
                             * takes the SAME emerald as a confirmed segment —
                             * both mean "a human decided this".
                             */}
                            <button
                              type="button"
                              onClick={() => toggleLead(c.crewId)}
                              aria-pressed={p.lead}
                              title={p.lead ? "Led this gig — click to unset" : "Mark as lead"}
                              className={`rounded-[3px] border px-2.5 py-1 text-[12px] transition-colors ${
                                p.lead
                                  ? "border-accent bg-accent text-white"
                                  : "border-stone-200 text-stone-400 hover:border-stone-400 hover:text-stone-600"
                              }`}
                            >
                              lead
                            </button>

                            {/* The segmented control. One track, one answer. */}
                            <span
                              role="radiogroup"
                              aria-label="Discipline"
                              className="inline-flex overflow-hidden rounded-full border border-stone-200"
                            >
                              {DISCIPLINES.map((role, i) => {
                                const on = p.discipline === role;
                                const guess = on && p.disciplineIsGuess;
                                return (
                                  <button
                                    key={role}
                                    type="button"
                                    role="radio"
                                    aria-checked={on}
                                    onClick={() => pickDiscipline(c.crewId, role)}
                                    title={
                                      guess
                                        ? "A guess from their roster entry — click to confirm"
                                        : on
                                          ? "Confirmed — click to clear"
                                          : "Click to set"
                                    }
                                    // Extra padding on the end segments so the
                                    // text is not crowded by the round caps.
                                    className={`px-2.5 py-1 text-[12px] transition-colors first:pl-3.5 last:pr-3.5 ${
                                      i > 0 ? "border-l border-stone-200" : ""
                                    } ${
                                      guess
                                        ? // Still a guess: the accent is present
                                          // but unfilled, so it reads as pending
                                          // rather than decided.
                                          "bg-accent-muted/60 text-accent-hover italic"
                                        : on
                                          ? "bg-accent text-white"
                                          : "text-stone-500 hover:bg-stone-50 hover:text-stone-800"
                                    }`}
                                  >
                                    {role}
                                  </button>
                                );
                              })}
                            </span>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {gig.unresolvedCrew.length > 0 && (
                  <p className="mt-3 text-[11px] text-stone-400">
                    {gig.unresolvedCrew.length} other attendee
                    {gig.unresolvedCrew.length === 1 ? " is" : "s are"} not on your roster — add
                    them on the Intel tab once the event exists.
                  </p>
                )}
              </dd>
            </>
          )}
        </div>

        <div className="px-5 py-4">
          <dt className="label-caps mb-1.5 text-stone-400">Client</dt>
          <dd className="text-[14px] text-stone-700">
            {gig.orgs.length === 0 ? (
              <span className="text-stone-400">No onsite contact in the entry</span>
            ) : (
              gig.orgs.map((o) => (
                <span key={o.domain} className="mr-3 inline-block">
                  {o.name ?? o.domain}
                  {!o.orgId && <span className="ml-1.5 text-[11px] text-stone-400">new</span>}
                </span>
              ))
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

// ── the lookup itself ───────────────────────────────────────────────────────

export interface GigLookupState {
  gigs: SuggestedGig[];
  loading: boolean;
  /** "no-credential" | "calendar-error" | null — reported, never swallowed. */
  unavailable: string | null;
}

/**
 * Debounced calendar lookup for whatever is in the name and date fields.
 *
 * Debounced at 300ms and aborted on change, because this reaches Google. The
 * server caches the window for five minutes, so a burst of keystrokes costs one
 * round trip rather than one per tick.
 */
export function useGigLookup(name: string, date: string, enabled: boolean): GigLookupState {
  const [state, setState] = useState<GigLookupState>({
    gigs: [],
    loading: false,
    unavailable: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  const query = name.trim();

  useEffect(() => {
    if (!enabled || (query.length < 2 && !date)) {
      setState((s) => (s.gigs.length || s.loading ? { ...s, gigs: [], loading: false } : s));
      return;
    }
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setState((s) => ({ ...s, loading: true }));
      try {
        const params = new URLSearchParams();
        if (query) params.set("q", query);
        if (date) params.set("date", date);
        const res = await fetch(`/api/events/suggest-gig?${params}`, { signal: ctrl.signal });
        if (!res.ok) {
          setState({ gigs: [], loading: false, unavailable: "calendar-error" });
          return;
        }
        const j = (await res.json()) as { gigs: SuggestedGig[]; unavailable: string | null };
        setState({ gigs: j.gigs ?? [], loading: false, unavailable: j.unavailable ?? null });
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        setState({ gigs: [], loading: false, unavailable: "calendar-error" });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, date, enabled]);

  return state;
}

/** Keyboard handling for the name input while the dropdown is open. */
export function useDropdownKeys(
  count: number,
  onPick: (i: number) => void,
  onClose: () => void
): {
  activeIndex: number;
  setActiveIndex: (i: number) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
} {
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => { setActiveIndex(-1); }, [count]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!count) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % count);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i <= 0 ? count - 1 : i - 1));
      } else if (e.key === "Enter" && activeIndex >= 0) {
        // Only swallow Enter when a row is actually highlighted — otherwise
        // Enter must still submit the form, which is how this page has always
        // worked.
        e.preventDefault();
        onPick(activeIndex);
      } else if (e.key === "Escape") {
        onClose();
      }
    },
    [count, activeIndex, onPick, onClose]
  );

  return { activeIndex, setActiveIndex, onKeyDown };
}
