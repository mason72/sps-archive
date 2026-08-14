"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type {
  IntelIndex,
  IntelPerson,
  IntelVenue,
  IntelCity,
  IntelOrg,
} from "@/lib/event-intel/index-intel";

/**
 * The pivot, as a UI.
 *
 * ONE selection model across four axes. Picking a person, a venue, a city or a
 * client all resolve to the same `{axis, id}` pair, which is why every panel can
 * link into every other panel without a special case — a person's venues are
 * clickable for the same reason a venue's crew are.
 *
 * Emerald is state ONLY: the active axis underline and the selected row's rail.
 * Rebook judgements use the severity ramp (red-700 / amber-700 / stone-600) and
 * never the accent, because a green "yes" beside an emerald selection makes the
 * accent mean two different things at once.
 */

type Axis = "people" | "venues" | "cities" | "clients";

const AXES: { key: Axis; label: string }[] = [
  { key: "people", label: "People" },
  { key: "venues", label: "Venues" },
  { key: "cities", label: "Cities" },
  { key: "clients", label: "Clients" },
];

/**
 * Written out rather than computed. Chopping the last letter off the axis name
 * gave "Pick a peopl", which is what the first screenshot said back.
 */
const SINGULAR: Record<Axis, string> = {
  people: "someone",
  venues: "a venue",
  cities: "a city",
  clients: "a client",
};

const fmtDate = (d: string | null) =>
  d
    ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "undated";

/* ── Small shared pieces ──────────────────────────────────────────────────── */

function Rule() {
  return <div className="h-px bg-stone-200" />;
}

function Meta({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] uppercase tracking-[0.14em] text-stone-400">
      {children}
    </span>
  );
}

function Chip({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
}) {
  /**
   * TWO TIERS, and the difference is visible at rest.
   *
   * A chip that navigates and a chip that merely states a fact looked
   * identical, so the only clue that "The Alder Room" opens the venue was
   * hovering it — and hover is not a thing on a phone. Actionable chips are
   * bordered and darker; facts are a flat tint with no border and lighter text.
   * Nobody has to discover anything.
   */
  const shared = "inline-flex items-center rounded-full px-2.5 py-1 text-[12px]";
  if (!onClick) {
    return (
      <span className={`${shared} bg-stone-100 text-stone-500`} title={title}>
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`${shared} border border-stone-300 bg-white text-stone-800 transition-colors duration-200 hover:border-stone-800 hover:bg-stone-900 hover:text-white`}
    >
      {children}
    </button>
  );
}

/** Rebook signal. Severity ramp, never the brand accent. */
function RebookDot({ value, count }: { value: string | null; count?: number }) {
  if (!value) return null;
  const map: Record<string, [string, string]> = {
    yes: ["bg-stone-600", "would rebook"],
    maybe: ["bg-amber-600", "maybe"],
    no: ["bg-red-700", "would not rebook"],
  };
  const hit = map[value];
  if (!hit) return null;
  return (
    <span className="inline-flex items-center gap-1.5" title={hit[1]}>
      <span className={`h-1.5 w-1.5 rounded-full ${hit[0]}`} />
      <span className="text-[12px] text-stone-500">
        {count != null && <span className="tabular-nums text-stone-700">{count} </span>}
        {hit[1]}
      </span>
    </span>
  );
}

/**
 * An empty dimension is explained, never hidden.
 *
 * Roles and venue notes are both empty today. A panel that simply omits them
 * teaches nothing and leaves you wondering whether the feature exists; one that
 * says what is missing and how it gets filled is a to-do list.
 */
function Blank({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] leading-relaxed text-stone-400">{children}</p>;
}

function EventLine({
  id,
  name,
  date,
  trailing,
}: {
  id: string;
  name: string;
  date: string | null;
  trailing?: React.ReactNode;
}) {
  return (
    <li className="flex items-baseline justify-between gap-4 py-2">
      <Link
        href={`/events/${id}`}
        className="text-[14px] text-stone-800 underline-offset-4 transition-colors duration-200 hover:text-stone-950 hover:underline"
      >
        {name}
      </Link>
      <span className="flex shrink-0 items-baseline gap-3">
        {trailing}
        <span className="text-[12px] tabular-nums text-stone-400">{fmtDate(date)}</span>
      </span>
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <Meta>{title}</Meta>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/* ── The board ────────────────────────────────────────────────────────────── */

export function IntelBoard({ index }: { index: IntelIndex }) {
  const [axis, setAxis] = useState<Axis>("people");
  const [selected, setSelected] = useState<Record<Axis, string | null>>({
    people: null,
    venues: null,
    cities: null,
    clients: null,
  });
  const [query, setQuery] = useState("");

  const personById = useMemo(() => new Map(index.people.map((p) => [p.id, p])), [index.people]);
  const venueById = useMemo(() => new Map(index.venues.map((v) => [v.id, v])), [index.venues]);
  const cityByKey = useMemo(() => new Map(index.cities.map((c) => [c.key, c])), [index.cities]);
  const orgById = useMemo(() => new Map(index.orgs.map((o) => [o.id, o])), [index.orgs]);

  /** Cross-axis jump — the whole point of a pivot. */
  const jump = (to: Axis, id: string) => {
    setAxis(to);
    setSelected((s) => ({ ...s, [to]: id }));
    setQuery("");
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (...fields: (string | null | undefined)[]) =>
      !q || fields.some((f) => (f ?? "").toLowerCase().includes(q));

    if (axis === "people")
      return index.people
        .filter((p) => match(p.name, p.fullName, p.email, p.homeCity, p.kind))
        .map((p) => ({
          id: p.id,
          primary: p.name,
          secondary: [p.homeCity, p.kind !== "other" ? p.kind : null].filter(Boolean).join(" · "),
          count: p.eventCount,
        }));
    if (axis === "venues")
      return index.venues
        .filter((v) => match(v.name, v.city, v.address))
        .map((v) => ({
          id: v.id,
          primary: v.name,
          secondary: [v.city, v.region].filter(Boolean).join(", "),
          count: v.eventCount,
        }));
    if (axis === "cities")
      return index.cities
        .filter((c) => match(c.name, c.region))
        .map((c) => ({
          id: c.key,
          primary: c.name,
          secondary: c.localCrewIds.length ? `${c.localCrewIds.length} local crew` : "",
          count: c.eventCount,
        }));
    return index.orgs
      .filter((o) => match(o.name, o.kind, ...(o.domains ?? [])))
      .map((o) => ({
        id: o.id,
        primary: o.name,
        secondary: o.kind !== "unknown" ? o.kind.replace(/_/g, " ") : "",
        count: o.eventCount,
      }));
  }, [axis, query, index]);

  const currentId = selected[axis];
  const coverage = index.totalEventCount - index.uncoveredEventCount;

  return (
    <div>
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header>
        <h1 className="font-editorial text-[clamp(34px,4.5vw,52px)] leading-[0.95] text-stone-900">
          Who worked <span className="font-serif italic text-emerald-600">what</span>, and where
        </h1>
        <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-stone-500">
          Back-office only — never visible to a client.{" "}
          <span className="tabular-nums text-stone-700">{coverage}</span> of{" "}
          <span className="tabular-nums text-stone-700">{index.totalEventCount}</span> galleries
          have intel attached
          {index.uncoveredEventCount > 0 && (
            <>
              ; <span className="tabular-nums text-stone-700">{index.uncoveredEventCount}</span>{" "}
              still to match
            </>
          )}
          .
        </p>
      </header>

      {/* ── Axis tabs + search ────────────────────────────────────────────── */}
      <div className="mt-10 flex flex-wrap items-end justify-between gap-6">
        {/*
          Wraps rather than scrolls. Four axes at 375px overflowed the row and
          took the whole page into horizontal scroll with it — a body that
          scrolls sideways is a bug, not a layout. Wrapping keeps every axis
          reachable without a swipe nobody knows is available.
        */}
        <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Pivot axis">
          {AXES.map((a) => {
            const active = a.key === axis;
            const n =
              a.key === "people" ? index.people.length
              : a.key === "venues" ? index.venues.length
              : a.key === "cities" ? index.cities.length
              : index.orgs.length;
            return (
              <button
                key={a.key}
                type="button"
                onClick={() => { setAxis(a.key); setQuery(""); }}
                className={`group relative pb-2 text-[13px] uppercase tracking-[0.14em] transition-colors duration-200 ${
                  active ? "text-stone-900" : "text-stone-400 hover:text-stone-600"
                }`}
              >
                {a.label}
                <span className="ml-2 text-[11px] tabular-nums text-stone-300">{n}</span>
                <span
                  className={`absolute inset-x-0 bottom-0 h-[2px] origin-left transition-transform duration-200 ${
                    active ? "scale-x-100 bg-emerald-500" : "scale-x-0 bg-stone-300 group-hover:scale-x-100"
                  }`}
                />
              </button>
            );
          })}
        </nav>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${axis}…`}
          className="w-full max-w-xs rounded-md border border-stone-200 bg-white px-3 py-2 text-[14px] text-stone-800 placeholder:text-stone-400 focus:border-stone-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
        />
      </div>

      <div className="mt-px"><Rule /></div>

      {/* ── List + detail ─────────────────────────────────────────────────── */}
      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(260px,340px)_1fr]">
        <div className="max-h-[70vh] overflow-y-auto pr-1">
          {rows.length === 0 ? (
            <Blank>Nothing matches “{query}”.</Blank>
          ) : (
            <ul>
              {rows.map((r) => {
                const active = r.id === currentId;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setSelected((s) => ({ ...s, [axis]: active ? null : r.id }))}
                      className={`flex w-full items-baseline justify-between gap-3 border-l-2 py-2.5 pl-3 pr-2 text-left transition-colors duration-200 ${
                        active
                          ? "border-emerald-500 bg-white"
                          : "border-transparent hover:border-stone-300 hover:bg-white"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] text-stone-800">{r.primary}</span>
                        {r.secondary && (
                          <span className="block truncate text-[12px] text-stone-400">{r.secondary}</span>
                        )}
                      </span>
                      <span className="shrink-0 text-[12px] tabular-nums text-stone-400">
                        {r.count || "—"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="min-w-0">
          {!currentId ? (
            <div className="rounded-lg border border-dashed border-stone-200 bg-white/60 px-8 py-16 text-center">
              <p className="font-editorial text-[20px] text-stone-500">
                Pick {SINGULAR[axis]}
              </p>
              <p className="mt-2 text-[13px] text-stone-400">
                Every panel links into the others — a person&apos;s venues open the venue,
                a venue&apos;s crew open the person.
              </p>
            </div>
          ) : axis === "people" ? (
            <PersonPanel p={personById.get(currentId)!} venueById={venueById} orgById={orgById} personById={personById} jump={jump} />
          ) : axis === "venues" ? (
            <VenuePanel v={venueById.get(currentId)!} personById={personById} orgById={orgById} jump={jump} />
          ) : axis === "cities" ? (
            <CityPanel c={cityByKey.get(currentId)!} personById={personById} venueById={venueById} jump={jump} />
          ) : (
            <OrgPanel o={orgById.get(currentId)!} personById={personById} venueById={venueById} jump={jump} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Panels ───────────────────────────────────────────────────────────────── */

function PanelHead({ title, sub }: { title: string; sub?: React.ReactNode }) {
  return (
    <header className="pb-5">
      <h2 className="font-editorial text-[30px] leading-tight text-stone-900">{title}</h2>
      {sub && <p className="mt-1.5 text-[13px] text-stone-500">{sub}</p>}
    </header>
  );
}

function PersonPanel({
  p, venueById, orgById, personById, jump,
}: {
  p: IntelPerson;
  venueById: Map<string, IntelVenue>;
  orgById: Map<string, IntelOrg>;
  personById: Map<string, IntelPerson>;
  jump: (a: Axis, id: string) => void;
}) {
  const roles = Object.entries(p.roleCounts).sort((a, b) => b[1] - a[1]);
  return (
    <div>
      <PanelHead
        title={p.name}
        sub={
          <>
            {p.fullName && p.fullName !== p.name && <>{p.fullName} · </>}
            {p.email ?? "no email on file"}
            {p.homeCity && <> · based in {p.homeCity}</>}
          </>
        }
      />
      <Rule />

      <div className="mt-5 flex flex-wrap gap-2">
        <Chip>{p.kind}</Chip>
        {p.canLead && <Chip title="Standing capability from the roster, not a per-gig fact">can lead: {p.canLead}</Chip>}
        {p.travels != null && <Chip>{p.travels ? "travels" : "local only"}</Chip>}
        {p.archived && <Chip>archived</Chip>}
      </div>

      <Section title={`${p.eventCount} ${p.eventCount === 1 ? "gig" : "gigs"}`}>
        {p.events.length === 0 ? (
          <Blank>No gigs linked yet. The calendar backfill attaches these from attendee emails.</Blank>
        ) : (
          <ul className="divide-y divide-stone-100">
            {p.events.map((e) => (
              <EventLine
                key={e.id}
                id={e.id}
                name={e.name}
                date={e.date}
                trailing={
                  <>
                    {e.roles.length > 0 && (
                      <span
                        className={
                          e.rolesSource === "inferred"
                            ? "text-[12px] italic text-stone-400"
                            : "text-[12px] text-stone-500"
                        }
                        title={
                          e.rolesSource === "inferred"
                            ? "Guessed from the calendar — confirm or change it"
                            : undefined
                        }
                      >
                        {e.roles.join(", ")}
                        {e.rolesSource === "inferred" && " ?"}
                      </span>
                    )}
                    <RebookDot value={e.wouldRebook} />
                  </>
                }
              />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Roles">
        {roles.length === 0 ? (
          <Blank>
            {p.inferredRoleCount > 0 ? (
              <>
                {p.inferredRoleCount} {p.inferredRoleCount === 1 ? "gig has" : "gigs have"} a
                guessed role, shown in italics above. Nothing is counted here until you
                confirm it — the calendar names who was there, never what they did.
              </>
            ) : (
              <>
                Not recorded yet — the calendar names who was there, never what they did.
                This is the one dimension that needs a human.
              </>
            )}
          </Blank>
        ) : (
          <div className="flex flex-wrap gap-2">
            {roles.map(([r, n]) => (
              <Chip key={r}>{r} <span className="ml-1.5 tabular-nums text-stone-400">{n}</span></Chip>
            ))}
          </div>
        )}
      </Section>

      {(p.rebook.yes || p.rebook.no || p.rebook.maybe) > 0 && (
        <Section title="Rebook">
          <div className="flex gap-5">
            {p.rebook.yes > 0 && <RebookDot value="yes" count={p.rebook.yes} />}
            {p.rebook.maybe > 0 && <RebookDot value="maybe" count={p.rebook.maybe} />}
            {p.rebook.no > 0 && <RebookDot value="no" count={p.rebook.no} />}
          </div>
        </Section>
      )}

      <div className="grid gap-8 sm:grid-cols-2">
        <Section title="Venues worked">
          {p.venueIds.length === 0 ? <Blank>None recorded.</Blank> : (
            <div className="flex flex-wrap gap-2">
              {p.venueIds.map((id) => {
                const v = venueById.get(id);
                return v ? <Chip key={id} onClick={() => jump("venues", id)}>{v.name}</Chip> : null;
              })}
            </div>
          )}
        </Section>

        <Section title="Cities worked">
          {p.cities.length === 0 ? <Blank>None recorded.</Blank> : (
            <div className="flex flex-wrap gap-2">
              {p.cities.map((c) => (
                <Chip key={c} onClick={() => jump("cities", c.trim().toLowerCase())}>{c}</Chip>
              ))}
            </div>
          )}
        </Section>
      </div>

      <div className="grid gap-8 sm:grid-cols-2">
        <Section title="Clients">
          {p.orgIds.length === 0 ? <Blank>None recorded.</Blank> : (
            <div className="flex flex-wrap gap-2">
              {p.orgIds.map((id) => {
                const o = orgById.get(id);
                return o ? <Chip key={id} onClick={() => jump("clients", id)}>{o.name}</Chip> : null;
              })}
            </div>
          )}
        </Section>

        <Section title="Works alongside">
          {p.coCrewIds.length === 0 ? <Blank>No shared gigs recorded.</Blank> : (
            <div className="flex flex-wrap gap-2">
              {p.coCrewIds.map((id) => {
                const c = personById.get(id);
                return c ? <Chip key={id} onClick={() => jump("people", id)}>{c.name}</Chip> : null;
              })}
            </div>
          )}
        </Section>
      </div>

      {p.notes && (
        <Section title="Notes">
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-stone-700">{p.notes}</p>
        </Section>
      )}
    </div>
  );
}

function VenuePanel({
  v, personById, orgById, jump,
}: {
  v: IntelVenue;
  personById: Map<string, IntelPerson>;
  orgById: Map<string, IntelOrg>;
  jump: (a: Axis, id: string) => void;
}) {
  return (
    <div>
      <PanelHead
        title={v.name}
        sub={v.address ?? [v.city, v.region].filter(Boolean).join(", ") ?? undefined}
      />
      <Rule />

      <Section title={`${v.eventCount} ${v.eventCount === 1 ? "gig" : "gigs"} here`}>
        {v.events.length === 0 ? (
          <Blank>No gigs linked to this venue yet.</Blank>
        ) : (
          <ul className="divide-y divide-stone-100">
            {v.events.map((e) => <EventLine key={e.id} {...e} />)}
          </ul>
        )}
      </Section>

      <Section title="What we know about the room">
        {v.notes ? (
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-stone-700">{v.notes}</p>
        ) : (
          <Blank>
            Nothing yet. This is where the loading dock, the power situation and the
            security lead time belong — the things that are true every time,
            not just the last time.
          </Blank>
        )}
      </Section>

      <div className="grid gap-8 sm:grid-cols-2">
        <Section title="Crew who've worked it">
          {v.crewIds.length === 0 ? <Blank>None recorded.</Blank> : (
            <div className="flex flex-wrap gap-2">
              {v.crewIds.map((id) => {
                const p = personById.get(id);
                return p ? <Chip key={id} onClick={() => jump("people", id)}>{p.name}</Chip> : null;
              })}
            </div>
          )}
        </Section>
        <Section title="Clients seen here">
          {v.orgIds.length === 0 ? <Blank>None recorded.</Blank> : (
            <div className="flex flex-wrap gap-2">
              {v.orgIds.map((id) => {
                const o = orgById.get(id);
                return o ? <Chip key={id} onClick={() => jump("clients", id)}>{o.name}</Chip> : null;
              })}
            </div>
          )}
        </Section>
      </div>

      {v.city && (
        <Section title="City">
          <Chip onClick={() => jump("cities", v.city!.trim().toLowerCase())}>{v.city}</Chip>
        </Section>
      )}
    </div>
  );
}

function CityPanel({
  c, personById, venueById, jump,
}: {
  c: IntelCity;
  personById: Map<string, IntelPerson>;
  venueById: Map<string, IntelVenue>;
  jump: (a: Axis, id: string) => void;
}) {
  return (
    <div>
      <PanelHead
        title={c.name}
        sub={`${c.eventCount} ${c.eventCount === 1 ? "gig" : "gigs"}${c.region ? ` · ${c.region}` : ""}`}
      />
      <Rule />

      <Section title="Crew based here">
        {c.localCrewIds.length === 0 ? (
          <Blank>
            Nobody on the roster lists this as home. That is the hiring question,
            and it is separate from who has flown in to work here.
          </Blank>
        ) : (
          <div className="flex flex-wrap gap-2">
            {c.localCrewIds.map((id) => {
              const p = personById.get(id);
              return p ? (
                <Chip key={id} onClick={() => jump("people", id)}>
                  {p.name}
                  {p.canLead === "yes" && <span className="ml-1.5 text-stone-400">lead</span>}
                </Chip>
              ) : null;
            })}
          </div>
        )}
      </Section>

      <Section title="Crew who've worked here">
        {c.crewIds.length === 0 ? <Blank>None recorded.</Blank> : (
          <div className="flex flex-wrap gap-2">
            {c.crewIds.map((id) => {
              const p = personById.get(id);
              return p ? <Chip key={id} onClick={() => jump("people", id)}>{p.name}</Chip> : null;
            })}
          </div>
        )}
      </Section>

      <Section title="Venues">
        {c.venueIds.length === 0 ? <Blank>None recorded.</Blank> : (
          <div className="flex flex-wrap gap-2">
            {c.venueIds.map((id) => {
              const v = venueById.get(id);
              return v ? <Chip key={id} onClick={() => jump("venues", id)}>{v.name}</Chip> : null;
            })}
          </div>
        )}
      </Section>

      {c.events.length > 0 && (
        <Section title="Gigs">
          <ul className="divide-y divide-stone-100">
            {c.events.map((e) => <EventLine key={e.id} {...e} />)}
          </ul>
        </Section>
      )}
    </div>
  );
}

function OrgPanel({
  o, personById, venueById, jump,
}: {
  o: IntelOrg;
  personById: Map<string, IntelPerson>;
  venueById: Map<string, IntelVenue>;
  jump: (a: Axis, id: string) => void;
}) {
  return (
    <div>
      <PanelHead
        title={o.name}
        sub={
          <>
            {o.kind !== "unknown" && <>{o.kind.replace(/_/g, " ")} · </>}
            {o.domains.length ? o.domains.join(", ") : "no domain on file"}
          </>
        }
      />
      <Rule />

      <Section title={`${o.eventCount} ${o.eventCount === 1 ? "gig" : "gigs"}`}>
        {o.events.length === 0 ? <Blank>No gigs linked yet.</Blank> : (
          <ul className="divide-y divide-stone-100">
            {o.events.map((e) => (
              <EventLine
                key={`${e.id}-${e.role}`}
                id={e.id}
                name={e.name}
                date={e.date}
                trailing={
                  <span
                    className="text-[12px] text-stone-500"
                    title="payer is the client; end brand and host are different companies and all three can be true"
                  >
                    {e.role.replace(/_/g, " ")}
                  </span>
                }
              />
            ))}
          </ul>
        )}
      </Section>

      <div className="grid gap-8 sm:grid-cols-2">
        <Section title="Crew who've worked them">
          {o.crewIds.length === 0 ? <Blank>None recorded.</Blank> : (
            <div className="flex flex-wrap gap-2">
              {o.crewIds.map((id) => {
                const p = personById.get(id);
                return p ? <Chip key={id} onClick={() => jump("people", id)}>{p.name}</Chip> : null;
              })}
            </div>
          )}
        </Section>
        <Section title="Venues">
          {o.venueIds.length === 0 ? <Blank>None recorded.</Blank> : (
            <div className="flex flex-wrap gap-2">
              {o.venueIds.map((id) => {
                const v = venueById.get(id);
                return v ? <Chip key={id} onClick={() => jump("venues", id)}>{v.name}</Chip> : null;
              })}
            </div>
          )}
        </Section>
      </div>

      {o.cities.length > 0 && (
        <Section title="Cities">
          <div className="flex flex-wrap gap-2">
            {o.cities.map((c) => (
              <Chip key={c} onClick={() => jump("cities", c.trim().toLowerCase())}>{c}</Chip>
            ))}
          </div>
        </Section>
      )}

      {o.notes && (
        <Section title="Notes">
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-stone-700">{o.notes}</p>
        </Section>
      )}
    </div>
  );
}
