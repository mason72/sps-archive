import { Nav } from "@/components/layout/Nav";
import { AppNav } from "@/components/layout/AppNav";
import { IntelBoard } from "@/app/intel/IntelBoard";
import type { IntelIndex } from "@/lib/event-intel/index-intel";

export const metadata = { title: "Intel playground — Pixeltrunk" };

/**
 * /dev/intel — the Intel board on FIXTURES.
 *
 * /intel is behind the login wall, which makes it awkward to review the design
 * without a session. This renders the same component against invented data so
 * the layout, the empty states and the cross-axis jumps can all be looked at.
 *
 * THE DATA HERE IS FAKE ON PURPOSE. Every name, venue and rebook judgement is
 * invented. The real board carries personnel opinions about named people who do
 * not work here, and /dev used to be reachable from the open internet — it is
 * now dev-only (see middleware), but a playground should not be the thing
 * standing between that data and the world.
 *
 * It also deliberately shows the AWKWARD cases: a person with no gigs, a venue
 * with no notes, a city with no local crew, a client with one gig. Those are
 * most of the real board today and they are what the empty states are for.
 */
const p = (
  id: string,
  name: string,
  over: Partial<IntelIndex["people"][number]> = {}
): IntelIndex["people"][number] => ({
  id, name, fullName: null, email: `${id}@example.com`, kind: "staff",
  homeCity: null, canLead: null, travels: null, archived: false, notes: null,
  eventCount: 0, events: [], roleCounts: {}, inferredRoleCount: 0, cities: [], venueIds: [],
  orgIds: [], coCrewIds: [], standing: { headline: null, tally: { first_call: 0, solid: 0, last_resort: 0, never: 0 }, total: 0, hardNo: false, fromBaseline: false }, isRegular: false, rehireBaseline: null, lastHired: null, lastHiredStored: null, ...over,
});

const EVENTS = [
  { coverUrl: null, coverFocal: null, id: "e1", name: "Northwind Summit 2026", date: "2026-08-05" },
  { coverUrl: null, coverFocal: null, id: "e2", name: "Harbor Labs Headshots // Jul 2026", date: "2026-07-12" },
  { coverUrl: null, coverFocal: null, id: "e3", name: "Northwind Holiday Party 2025", date: "2025-12-11" },
  { coverUrl: null, coverFocal: null, id: "e4", name: "Delta Mutual // All Hands 2026", date: "2026-04-02" },
];

const INDEX: IntelIndex = {
  events: [],
  people: [
    p("dana", "Dana Whitfield", {
      fullName: "Dana R. Whitfield", kind: "staff", homeCity: "Bay Area",
      canLead: "yes", travels: true, eventCount: 3,
      events: [
        { ...EVENTS[0], roles: ["lead", "photographer"], rolesSource: "manual", wouldRebook: "yes", note: null },
        { ...EVENTS[1], roles: ["photographer"], rolesSource: "manual", wouldRebook: "yes", note: null },
        // A machine's guess — italic and question-marked in the UI, never counted.
        { ...EVENTS[3], roles: ["lead"], rolesSource: "inferred", wouldRebook: null, note: null },
      ],
      roleCounts: { lead: 1, photographer: 2 }, inferredRoleCount: 1,
      cities: ["San Jose", "Oakland"], venueIds: ["v1", "v2"], orgIds: ["o1", "o2"],
      coCrewIds: ["milo", "reyna"], standing: { headline: "first_call", tally: { first_call: 2, solid: 0, last_resort: 0, never: 0 }, total: 2, hardNo: false, fromBaseline: false }, isRegular: true, rehireBaseline: null,
    }),
    p("milo", "Milo Vance", {
      kind: "local", homeCity: "Phoenix", canLead: "maybe", travels: false,
      eventCount: 2,
      events: [
        { ...EVENTS[0], roles: ["digital tech"], rolesSource: "manual", wouldRebook: "maybe", note: "Strong on set, slow to load out." },
        { ...EVENTS[2], roles: ["assistant"], rolesSource: "inferred", wouldRebook: "no", note: null },
      ],
      roleCounts: { "digital tech": 1 }, inferredRoleCount: 1,
      cities: ["San Jose"], venueIds: ["v1"], orgIds: ["o1"],
      coCrewIds: ["dana"], standing: { headline: "never", tally: { first_call: 0, solid: 0, last_resort: 1, never: 1 }, total: 2, hardNo: true, fromBaseline: false }, isRegular: false, rehireBaseline: null,
      notes: "Referred by Reyna. Owns his own lighting kit.",
    }),
    p("reyna", "Reyna Okafor", {
      kind: "local", homeCity: "Phoenix", canLead: "yes", travels: true,
      eventCount: 1,
      events: [{ ...EVENTS[1], roles: [], rolesSource: "manual", wouldRebook: "yes", note: null }],
      cities: ["Oakland"], venueIds: ["v2"], orgIds: ["o2"], coCrewIds: ["dana"],
      standing: { headline: "first_call", tally: { first_call: 1, solid: 0, last_resort: 0, never: 0 }, total: 1, hardNo: false, fromBaseline: false }, isRegular: false, rehireBaseline: null,
    }),
    // The common case today: on the roster, never yet linked to a gig.
    p("tobias", "Tobias Lund", { kind: "local", homeCity: "Seattle", canLead: "no" }),
  ],
  venues: [
    {
      id: "v1", name: "The Alder Room", address: "418 Wharf St", city: "San Jose",
      region: "CA",
      notes: "Loading dock is on the alley side and shuts at 6. Security needs names 48h ahead — badge desk will not improvise.",
      eventCount: 2,
      events: [EVENTS[0], EVENTS[2]],
      crewIds: ["dana", "milo"], orgIds: ["o1"],
    },
    {
      id: "v2", name: "1200 Kestrel Ave", address: "1200 Kestrel Ave", city: "Oakland",
      region: "CA", notes: null, eventCount: 1, events: [EVENTS[1]],
      crewIds: ["dana", "reyna"], orgIds: ["o2"],
    },
  ],
  cities: [
    { key: "san jose", name: "San Jose", region: "CA", eventCount: 2, events: [EVENTS[0], EVENTS[2]], venueIds: ["v1"], crewIds: ["dana", "milo"], localCrewIds: ["dana"] },
    { key: "oakland", name: "Oakland", region: "CA", eventCount: 1, events: [EVENTS[1]], venueIds: ["v2"], crewIds: ["dana", "reyna"], localCrewIds: ["dana"] },
    { key: "phoenix", name: "Phoenix", region: null, eventCount: 0, events: [], venueIds: [], crewIds: [], localCrewIds: ["milo", "reyna"] },
    { key: "seattle", name: "Seattle", region: null, eventCount: 0, events: [], venueIds: [], crewIds: [], localCrewIds: ["tobias"] },
  ],
  orgs: [
    { id: "o1", name: "Northwind", kind: "brand", domains: ["northwind.example"], notes: null, eventCount: 2, events: [{ ...EVENTS[0], role: "payer" }, { ...EVENTS[2], role: "payer" }], venueIds: ["v1"], cities: ["San Jose"], crewIds: ["dana", "milo"] },
    { id: "o2", name: "Harbor Labs", kind: "brand", domains: ["harborlabs.example"], notes: null, eventCount: 1, events: [{ ...EVENTS[1], role: "end_brand" }], venueIds: ["v2"], cities: ["Oakland"], crewIds: ["dana", "reyna"] },
    { id: "o3", name: "Delta Mutual", kind: "agency", domains: [], notes: null, eventCount: 0, events: [], venueIds: [], cities: [], crewIds: [] },
  ],
  uncoveredEventCount: 4,
  totalEventCount: 8,
};

export default function DevIntelPage() {
  return (
    <div className="min-h-screen bg-stone-50">
      {/* The real nav, so the playground shows the page as it actually ships. */}
      <Nav>
        <AppNav isAdmin current="intel" />
      </Nav>
      <div className="mx-auto max-w-[1400px] px-8 py-12 md:px-16">
        <p className="mb-8 inline-block rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[12px] text-amber-800">
          Fixtures — every name here is invented
        </p>
        <IntelBoard index={INDEX} />
      </div>
    </div>
  );
}
