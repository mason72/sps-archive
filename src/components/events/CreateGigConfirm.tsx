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
  /** Set when a gallery already exists for this gig. Marked, never hidden. */
  alreadyIn: { eventId: string; eventName: string } | null;
  score: number;
  matchedOn: string[];
  dayGap: number | null;
}

export interface GigIntelPayload {
  venue: string | null;
  crew: {
    crewId?: string;
    newPerson?: { name: string; kind?: string };
    roles: string[];
    confirmedRoles: string[];
    rehire: string | null;
    note: string | null;
  }[];
  orgDomains: string[];
  calendarEventIds: string[];
}

const DISCIPLINES = ["photographer", "stylist", "makeup artist"];

/**
 * The rehire ladder, in Mason's own words and in priority order.
 *
 * Mirrors `REHIRE_LADDER` in `src/lib/event-intel/roles.ts`, which is the
 * authority — the server normalises whatever arrives and this list only decides
 * what is offered. Kept as a literal rather than imported so this client
 * component does not pull a server module's dependency graph into the bundle.
 *
 * Colours come from the SEVERITY ramp (stone / amber-700 / red-700), never
 * emerald: a rehire judgement about a named person is not the brand's accent.
 */
const REHIRE: { value: string; label: string; on: string }[] = [
  { value: "first_call", label: "First call", on: "bg-stone-900 text-white" },
  { value: "solid", label: "Solid", on: "bg-stone-500 text-white" },
  { value: "last_resort", label: "Last resort", on: "bg-amber-700 text-white" },
  { value: "never", label: "Never again", on: "bg-red-700 text-white" },
];

interface TempPerson {
  /** Local only — a temp has no server id until the event is created. */
  localId: string;
  name: string;
}

/** Per-person state on the card. `discipline` may be a guess; `lead` never is. */
interface CrewPick {
  on: boolean;
  lead: boolean;
  discipline: string | null;
  /** True while the discipline is the machine's inference, not his click. */
  disciplineIsGuess: boolean;
  /** The rehire ladder. Only asked for non-regulars — see the row below. */
  rehire: string | null;
  note: string;
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
  inline = false,
}: {
  gigs: SuggestedGig[];
  activeIndex: number;
  onPick: (g: SuggestedGig) => void;
  onHover: (i: number) => void;
  /**
   * Sit in the flow instead of floating over it.
   *
   * The create screen's list hangs off a name field the photographer is
   * actively typing into, so it must overlay. The import screen has no such
   * field — the SPS event already named itself, and the question there is
   * "which of these is it?", asked of a list that is simply part of the page.
   * A floating panel that opens by itself over a photo grid reads as an error.
   * Same rows, same keyboard, different container.
   */
  inline?: boolean;
}) {
  if (!gigs.length) return null;
  return (
    <ul
      role="listbox"
      className={
        inline
          ? "max-h-72 overflow-y-auto border border-stone-200 bg-white"
          : "absolute left-0 right-0 top-full z-20 mt-1 max-h-80 overflow-y-auto border border-stone-200 bg-white shadow-[0_8px_24px_-12px_rgba(12,10,9,0.18)]"
      }
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
              <span
                className={`text-[14px] leading-snug ${
                  g.alreadyIn ? "text-stone-400" : "text-stone-900"
                }`}
              >
                {g.title}
              </span>
              <span className="text-[12px] text-stone-400">{meta}</span>
              {/* Marked, not hidden: one gig can legitimately make two
                  galleries, and a vanished row reads as a lost calendar. */}
              {g.alreadyIn && (
                <span className="text-[11px] text-stone-400 italic">
                  already in “{g.alreadyIn.eventName}”
                </span>
              )}
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
  /**
   * The name and date FIELDS this card may offer to fill, and the handlers that
   * fill them. All four are optional together, because a screen without those
   * fields has nothing to offer.
   *
   * The import screen is that case: an imported event takes its name and date
   * from SPS server-side ("never trust the client for either" — see
   * `startSpsPull`), so a chip proposing a rename there would either do nothing
   * or quietly become a second source of truth for the event's identity.
   * Renaming an imported gallery stays the event page's job.
   */
  typedName?: string;
  typedDate?: string;
  onUseName?: (name: string) => void;
  onUseDate?: (date: string) => void;
  onClear: () => void;
  onChange: (payload: GigIntelPayload) => void;
}) {
  const [picks, setPicks] = useState<Record<string, CrewPick>>({});
  /**
   * Local hires typed in here. They exist ONLY in this component until the
   * event is created — a temp entered into a form that gets abandoned should
   * not leave a person behind on the roster.
   */
  const [temps, setTemps] = useState<TempPerson[]>([]);
  const [addingTemp, setAddingTemp] = useState(false);

  // Seed once per gig: everyone on, discipline guessed from what they DO.
  useEffect(() => {
    const seed: Record<string, CrewPick> = {};
    for (const c of gig.crew) {
      const guess = c.kind && DISCIPLINES.includes(c.kind) ? c.kind : null;
      seed[c.crewId] = {
        on: true, lead: false, discipline: guess, disciplineIsGuess: !!guess,
        rehire: null, note: "",
      };
    }
    setPicks(seed);
    setTemps([]);
    setAddingTemp(false);
  }, [gig]);

  const payload = useMemo<GigIntelPayload>(() => {
    const rolesFor = (p: CrewPick) => {
      const roles = [...(p.lead ? ["lead"] : []), ...(p.discipline ? [p.discipline] : [])];
      // A guessed discipline is a role, not an endorsement. `lead` is only
      // ever here because he clicked it, so it is always confirmed.
      const confirmedRoles = roles.filter((r) => !(r === p.discipline && p.disciplineIsGuess));
      return { roles, confirmedRoles };
    };

    const crew: GigIntelPayload["crew"] = gig.crew
      .filter((c) => picks[c.crewId]?.on)
      .map((c) => {
        const p = picks[c.crewId];
        return {
          crewId: c.crewId,
          ...rolesFor(p),
          rehire: p.rehire,
          note: p.note.trim() || null,
        };
      });

    // Temps ride the SAME list — the server resolves "create then link" so no
    // caller has to match up a parallel array of new people to their roles.
    for (const t of temps) {
      const p = picks[t.localId];
      if (!p?.on) continue;
      crew.push({
        newPerson: { name: t.name, kind: p.discipline ?? undefined },
        ...rolesFor(p),
        rehire: p.rehire,
        note: p.note.trim() || null,
      });
    }

    return {
      venue: gig.venue?.raw ?? null,
      crew,
      orgDomains: gig.orgs.map((o) => o.domain),
      calendarEventIds: gig.calendarEventIds,
    };
  }, [gig, picks, temps]);

  useEffect(() => { onChange(payload); }, [payload, onChange]);

  /**
   * Calendar crew and hand-added temps render as ONE list.
   *
   * Two lists would mean two copies of the row — and the row carries the whole
   * three-state role model, which is precisely the thing that must not exist
   * twice. A temp is never a regular by construction: someone typed in during
   * a gig is by definition not who you reach for.
   */
  const rows = useMemo(
    () => [
      ...gig.crew.map((c) => ({
        id: c.crewId, name: c.name, isRegular: c.isRegular, isTemp: false,
      })),
      ...temps.map((t) => ({ id: t.localId, name: t.name, isRegular: false, isTemp: true })),
    ],
    [gig.crew, temps]
  );

  const toggleOn = (id: string) =>
    setPicks((p) => ({ ...p, [id]: { ...p[id], on: !p[id]?.on } }));

  const toggleLead = (id: string) =>
    setPicks((p) => ({ ...p, [id]: { ...p[id], lead: !p[id]?.lead } }));

  const setRehire = (id: string, value: string) =>
    setPicks((p) => ({
      ...p,
      // Clicking the current rating clears it — a judgement you can't take back
      // is one people stop making.
      [id]: { ...p[id], rehire: p[id]?.rehire === value ? null : value },
    }));

  const setNote = (id: string, note: string) =>
    setPicks((p) => ({ ...p, [id]: { ...p[id], note } }));

  /** Add a local hire, unsaved until the event is created. */
  const addTemp = (name: string) => {
    const clean = name.trim();
    if (!clean) return;
    const localId = `temp:${clean.toLowerCase()}:${temps.length}`;
    setTemps((t) => [...t, { localId, name: clean }]);
    setPicks((p) => ({
      ...p,
      // Nothing is guessed about someone we have never met — every control
      // starts empty rather than pre-filled.
      [localId]: {
        on: true, lead: false, discipline: null, disciplineIsGuess: false,
        rehire: null, note: "",
      },
    }));
    setAddingTemp(false);
  };

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
  const offerName =
    !!onUseName &&
    !!nameProposal &&
    nameProposal.toLowerCase() !== (typedName ?? "").trim().toLowerCase();
  const dateMismatch = !!onUseDate && !!typedDate && typedDate !== gig.shootDate;

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
              onClick={() => onUseName?.(nameProposal)}
              className="border border-stone-200 px-2.5 py-1 text-[12px] text-stone-600 transition-colors hover:border-stone-800 hover:text-stone-900"
            >
              Name it “{nameProposal}”
            </button>
          )}
          {dateMismatch && (
            <button
              type="button"
              onClick={() => onUseDate?.(gig.shootDate)}
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
          {rows.length === 0 ? (
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
                  {rows.map((c) => {
                    const p = picks[c.id];
                    if (!p) return null;
                    return (
                      <li key={c.id} className="py-2.5 first:pt-0">
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
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
                              onClick={() => toggleOn(c.id)}
                              title={p.on ? "They were not here" : "Add them back"}
                              className={`block text-left text-[14px] transition-colors ${
                                p.on ? "text-stone-900" : "text-stone-300 line-through"
                              }`}
                            >
                              {c.name}
                            </button>
                            {!c.isRegular && p.on && (
                              <span className="block text-[11px] leading-tight text-stone-400">
                                {c.isTemp ? "new — added here" : "not a regular"}
                              </span>
                            )}
                          </span>

                          {p.on && (
                            <span className="flex flex-wrap items-center gap-2">
                              {/**
                               * TWO DIFFERENT CONTROLS, because they are two
                               * different questions — and the shapes say so.
                               *
                               * `lead` is a FLAG: a squared-off chip that is on
                               * or off. The discipline is a CHOICE: one fully
                               * rounded segmented track where picking a segment
                               * necessarily un-picks the others. Rendering both
                               * as identical pills, which is what shipped first,
                               * made "stylist AND photographer" look like a
                               * legal combination — the API rejects it, so the
                               * UI should not offer it.
                               *
                               * The radius carries that distinction on its own,
                               * so the flag needs no status dot: with the shape
                               * already saying "toggle", a dot is decoration,
                               * and this system spends nothing on decoration.
                               * On, it takes the SAME emerald as a confirmed
                               * segment — both mean "a human decided this".
                               */}
                              <button
                                type="button"
                                onClick={() => toggleLead(c.id)}
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
                                      onClick={() => pickDiscipline(c.id, role)}
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
                                          ? // Still a guess: the accent is
                                            // present but unfilled, so it reads
                                            // as pending rather than decided.
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
                        </div>

                        {/**
                         * The rehire judgement — NON-REGULARS ONLY.
                         *
                         * Mason: "for non-regulars, can we come up with some
                         * sort of rating system so we can quickly identify
                         * whether they were a solid hire or a last resort."
                         * Your own team is not something you rate gig to gig;
                         * a local hire you may never see again is.
                         *
                         * And this is the RIGHT MOMENT for it — his reason, and
                         * it is the strongest argument in the whole feature:
                         * the lead who just worked with them is the one
                         * uploading. Any later and it is a form nobody fills in.
                         *
                         * Deliberately NOT showing their standing from other
                         * gigs here: seeing "First call ×4" while deciding
                         * today's rating is an invitation to agree with
                         * yourself. It appears once this rating exists.
                         */}
                        {p.on && !c.isRegular && (
                          <div className="mt-2 flex flex-wrap items-center gap-2 pl-0">
                            <span className="text-[11px] text-stone-400">Rehire?</span>
                            <span
                              role="radiogroup"
                              aria-label="Would you hire them again"
                              className="inline-flex overflow-hidden rounded-full border border-stone-200"
                            >
                              {REHIRE.map((r, i) => (
                                <button
                                  key={r.value}
                                  type="button"
                                  role="radio"
                                  aria-checked={p.rehire === r.value}
                                  onClick={() => setRehire(c.id, r.value)}
                                  title={
                                    p.rehire === r.value ? "Click to clear" : `Mark as ${r.label}`
                                  }
                                  className={`px-2.5 py-1 text-[12px] transition-colors first:pl-3.5 last:pr-3.5 ${
                                    i > 0 ? "border-l border-stone-200" : ""
                                  } ${
                                    p.rehire === r.value
                                      ? r.on
                                      : "text-stone-500 hover:bg-stone-50 hover:text-stone-800"
                                  }`}
                                >
                                  {r.label}
                                </button>
                              ))}
                            </span>
                            <input
                              value={p.note}
                              onChange={(e) => setNote(c.id, e.target.value)}
                              placeholder="Note (optional)"
                              className="min-w-0 flex-1 border-b border-stone-200 bg-transparent py-1 text-[12px] text-stone-700 placeholder:text-stone-300 focus:border-stone-900 focus:outline-none"
                            />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {gig.unresolvedCrew.length > 0 && (
                  <p className="mt-3 text-[11px] text-stone-400">
                    {gig.unresolvedCrew.length} other attendee
                    {gig.unresolvedCrew.length === 1 ? " is" : "s are"} not on your roster.
                  </p>
                )}
              </dd>
            </>
          )}

          {/**
           * Add a local hire, here, now.
           *
           * The calendar only knows who was INVITED, so anyone hired on the day
           * is invisible to it — and that is exactly the person whose rating
           * matters most, because you have no other record of them. Sending
           * someone to the Intel tab "once the event exists" meant the one
           * person worth rating was the one you had to go looking for.
           */}
          {addingTemp ? (
            <TempAdder onAdd={addTemp} onCancel={() => setAddingTemp(false)} />
          ) : (
            <button
              type="button"
              onClick={() => setAddingTemp(true)}
              className="mt-3 text-[12px] text-stone-400 underline-offset-4 transition-colors hover:text-stone-800 hover:underline"
            >
              + Someone else worked this
            </button>
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

// ── the standalone step ─────────────────────────────────────────────────────

/**
 * The whole gig-confirmation flow as ONE block, for a screen that has no event
 * name field to hang it off.
 *
 * The create screen doesn't use this: there, the name input IS the search, which
 * is the entire point of Mason's original ask ("it pre-populates if you use the
 * autocomplete"). The SPS import has no such field — the event arrives already
 * named by SPS — so it needs the same three parts wired to a search of its own.
 *
 * It exists in this file rather than in the import page because it is about
 * picking a gig, not about importing. The card underneath carries the whole
 * three-state role model and the rehire ladder; a second copy of that wiring is
 * exactly the drift this file was extracted to prevent.
 *
 * The seed query is applied ONCE. Remount it (`key={spsEventId}`) when the
 * subject changes — a prop that silently re-seeds would wipe a selection the
 * photographer had already made.
 */
export function GigIntelStep({
  seedQuery,
  seedDate,
  onChange,
  title,
  hint,
}: {
  /** What to search for first — usually the source system's own event name. */
  seedQuery: string;
  /** The shoot day, when the source knows it. Narrows the calendar window. */
  seedDate?: string | null;
  /** The payload to send with whatever creates the event, or null if skipped. */
  onChange: (payload: GigIntelPayload | null) => void;
  /**
   * The block's own heading and explanation.
   *
   * They live INSIDE the component so the whole block can disappear as one
   * thing. Left to the caller, an account without Event Intel would keep a
   * "Which job was this?" heading standing over nothing — the classic orphaned
   * label, and invisible to whoever ships it because they can always see the
   * body.
   */
  title?: string;
  hint?: string;
}) {
  const [query, setQuery] = useState(seedQuery);
  const [picked, setPicked] = useState<SuggestedGig | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const date = seedDate ?? "";
  const lookup = useGigLookup(query, date, !picked && !dismissed);
  const gigs = picked || dismissed ? [] : lookup.gigs;

  const keys = useDropdownKeys(
    gigs.length,
    (i) => { const g = gigs[i]; if (g) setPicked(g); },
    () => {}
  );

  // Clearing the pick must clear the payload too, or an abandoned choice keeps
  // riding along on the request.
  const clear = useCallback(() => { setPicked(null); onChange(null); }, [onChange]);

  /**
   * Event Intel is not this account's feature — render NOTHING, heading and
   * all. The calendar behind it is one studio's, so for anybody else there is
   * no gig to find and no credential they could add; a "no suggestions" line
   * would describe a door that does not exist for them.
   *
   * AFTER every hook, deliberately — an early return above `useDropdownKeys`
   * changes the hook count between renders, which is the bug this comment
   * exists to stop someone reintroducing when they move this "up where it
   * belongs".
   *
   * There is a sub-second flash of the block before the first lookup answers.
   * Accepted over an extra round trip on mount: the owner is the common case
   * and must not wait to see it.
   */
  if (lookup.unavailable === "not-enabled") return null;

  const chrome = (body: React.ReactNode) =>
    title || hint ? (
      <div>
        {title && <p className="label-caps mb-2 text-stone-400">{title}</p>}
        {hint && (
          <p className="mb-3 text-[13px] leading-[1.7] text-stone-400">{hint}</p>
        )}
        {body}
      </div>
    ) : (
      <>{body}</>
    );

  if (picked) {
    return chrome(
      <GigConfirmCard gig={picked} onClear={clear} onChange={onChange} />
    );
  }

  if (dismissed) {
    return chrome(
      <p className="text-[13px] text-stone-400">
        No gig attached.{" "}
        <button
          type="button"
          onClick={() => setDismissed(false)}
          className="underline underline-offset-4 transition-colors hover:text-stone-700"
        >
          Look again
        </button>
      </p>
    );
  }

  return chrome(
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={keys.onKeyDown}
          role="combobox"
          aria-expanded={gigs.length > 0}
          aria-label="Search the calendar for this gig"
          autoComplete="off"
          placeholder="Search the calendar…"
          className="min-w-0 flex-1 border-b border-stone-200 bg-transparent py-1.5 text-[14px] text-stone-900 placeholder:text-stone-300 focus:border-stone-900 focus:outline-none transition-colors duration-300"
        />
        <button
          type="button"
          onClick={() => { setDismissed(true); onChange(null); }}
          className="text-[12px] text-stone-400 underline-offset-4 transition-colors hover:text-stone-700 hover:underline"
        >
          Skip this
        </button>
      </div>

      <GigDropdown
        inline
        gigs={gigs}
        activeIndex={keys.activeIndex}
        onPick={setPicked}
        onHover={keys.setActiveIndex}
      />

      {/**
       * Three different silences, said apart. An empty list because the
       * calendar is unreachable, because nothing matched, and because we are
       * still asking all look identical — and only the first is something
       * Mason can act on.
       */}
      {lookup.unavailable ? (
        <p className="text-[12px] text-stone-400">
          {lookup.unavailable === "no-credential"
            ? "Calendar lookup is off here — no Google credential is configured."
            : "The calendar did not answer, so there are no suggestions right now."}
        </p>
      ) : lookup.loading ? (
        <p className="text-[12px] text-stone-400">Searching the calendar…</p>
      ) : gigs.length === 0 ? (
        <p className="text-[12px] text-stone-400">
          Nothing on the calendar matches that. Try the client, the venue or the city.
        </p>
      ) : null}
    </div>
  );
}


/**
 * Type a name to add someone the calendar never knew about.
 *
 * Name only. The discipline and the rating are set on the row like everyone
 * else's, so there is one place to learn the controls — and asking for an email
 * and a city here would turn "someone else worked this" into a form, which is
 * the thing that does not get filled in at the end of a long day. The roster
 * entry can be completed later on /intel.
 */
function TempAdder({
  onAdd,
  onCancel,
}: {
  onAdd: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          // Enter must not submit the surrounding create-event form.
          if (e.key === "Enter") { e.preventDefault(); onAdd(name); }
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Their name"
        className="min-w-0 flex-1 border-b border-stone-200 bg-transparent py-1 text-[13px] text-stone-900 placeholder:text-stone-300 focus:border-stone-900 focus:outline-none"
      />
      <button
        type="button"
        onClick={() => onAdd(name)}
        disabled={!name.trim()}
        className="rounded-[3px] border border-accent bg-accent px-2.5 py-1 text-[12px] text-white transition-opacity disabled:opacity-40"
      >
        Add
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="text-[12px] text-stone-400 transition-colors hover:text-stone-700"
      >
        Cancel
      </button>
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
