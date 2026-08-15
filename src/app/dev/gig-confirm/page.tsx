"use client";

import { useState } from "react";
import { Nav } from "@/components/layout/Nav";
import { AppNav } from "@/components/layout/AppNav";
import {
  GigConfirmCard,
  GigDropdown,
  type GigIntelPayload,
  type SuggestedGig,
} from "@/components/events/CreateGigConfirm";

/**
 * /dev/gig-confirm — the create-screen gig picker on FIXTURES.
 *
 * `/events/new` is behind the login wall, and a local dev server has no session
 * even when the browser is signed in to production — cookies do not cross
 * origins. That leaves the design of this card unreviewable locally, which is
 * exactly the gap that let four layout bugs ship on 2026-08-14/15: verified at
 * the types, data and build layer, never looked at.
 *
 * THE DATA HERE IS FAKE. Names, venues and domains are invented — see
 * /dev/intel for why a playground must not carry the real personnel data.
 *
 * It deliberately shows the awkward rows: a gig with nobody on the roster, a
 * gig the calendar gave no venue, a person whose discipline cannot be guessed,
 * and a multi-day gig. Those are the states the empty copy is for.
 */

const GIGS: SuggestedGig[] = [
  {
    key: "g1",
    client: "Northwind SKO",
    title: "ALEX & RIVER & SAM  //  Northwind SKO  //  Scottsdale",
    start: "2026-08-11",
    end: "2026-08-12",
    // The 11th is the set-up; the job is the 12th.
    shootDate: "2026-08-12",
    entryCount: 3,
    city: "Scottsdale",
    venue: {
      name: "The Cactus Bluff Resort",
      street: "5401 N Example Rd",
      city: "Paradise Valley",
      raw: "The Cactus Bluff Resort, 5401 N Example Rd, Paradise Valley, AZ 85253, United States",
    },
    crew: [
      { crewId: "c1", name: "Alex Doyle", isRegular: true, kind: "photographer" },
      { crewId: "c2", name: "River Baptiste", isRegular: true, kind: "photographer" },
      { crewId: "c3", name: "Sam Okonkwo", isRegular: false, kind: "stylist" },
      // No `kind` on the roster — nothing to guess, so all three sit outline.
      { crewId: "c4", name: "Wren Halloran", isRegular: false, kind: null },
    ],
    unresolvedCrew: [{ email: "someone@example.com", displayName: "Someone Else" }],
    orgs: [{ domain: "northwind.example", orgId: "o1", name: "Northwind" }],
    calendarEventIds: ["cal1", "cal2", "cal3"],
    alreadyIn: null,
    score: 1,
    matchedOn: ["northwind"],
    dayGap: 0,
  },
  {
    key: "g2",
    client: "Harbor Labs",
    title: "ALEX | Harbor Labs Headshots",
    start: "2026-08-11",
    end: "2026-08-11",
    shootDate: "2026-08-11",
    entryCount: 1,
    city: null,
    // No venue and an unknown payer — the two empty states side by side.
    venue: null,
    crew: [{ crewId: "c1", name: "Alex Doyle", isRegular: true, kind: "photographer" }],
    unresolvedCrew: [],
    orgs: [{ domain: "harborlabs.example", orgId: null, name: null }],
    calendarEventIds: ["cal4"],
    // The already-claimed case: greyed in the dropdown, sunk to the bottom.
    alreadyIn: { eventId: "e9", eventName: "Harbor Labs // Aug 2026" },
    score: 0.86,
    matchedOn: ["harbor"],
    dayGap: 0,
  },
  {
    key: "g3",
    client: "Delta Mutual All Hands",
    title: "Delta Mutual All Hands // Coppell",
    start: "2026-08-09",
    end: "2026-08-09",
    shootDate: "2026-08-09",
    entryCount: 1,
    city: "Coppell",
    venue: { name: null, street: "2065 E Hamilton Ave", city: "Coppell", raw: "2065 E Hamilton Ave, Coppell, TX" },
    // Nobody matched — the roster gap, stated rather than rendered as an empty list.
    crew: [],
    unresolvedCrew: [
      { email: "a@example.com", displayName: "A Person" },
      { email: "b@example.com", displayName: null },
    ],
    orgs: [],
    calendarEventIds: ["cal5"],
    alreadyIn: null,
    score: 0.72,
    matchedOn: ["delta"],
    dayGap: 2,
  },
];

export default function GigConfirmPlayground() {
  const [name, setName] = useState("north");
  const [date, setDate] = useState("");
  const [picked, setPicked] = useState<SuggestedGig | null>(null);
  const [active, setActive] = useState(0);
  const [payload, setPayload] = useState<GigIntelPayload | null>(null);

  return (
    <div className="min-h-screen flex flex-col">
      <Nav>
        <AppNav />
      </Nav>
      <main className="px-8 md:px-16 pt-16 pb-24 max-w-2xl">
        <p className="label-caps mb-4">Playground · fixtures</p>
        <h1 className="font-editorial text-[clamp(28px,4vw,40px)] leading-[1.05] text-stone-900 mb-10">
          Create-screen gig confirm
        </h1>

        <div className="space-y-12">
          <div>
            <label htmlFor="pg-name" className="label-caps mb-3 block">
              Event name
            </label>
            <div className="relative">
              <input
                id="pg-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-12 w-full border-b border-stone-200 bg-transparent text-[18px] text-stone-900 placeholder:text-stone-300 focus:border-stone-900 focus:outline-none transition-colors duration-300"
              />
              <GigDropdown
                gigs={picked ? [] : GIGS}
                activeIndex={active}
                onPick={(g) => setPicked(g)}
                onHover={setActive}
              />
            </div>
          </div>

          <div>
            <label className="label-caps mb-3 block">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-12 border-b border-stone-200 bg-transparent text-[16px] text-stone-900 focus:border-stone-900 focus:outline-none"
            />
          </div>

          {picked && (
            <GigConfirmCard
              gig={picked}
              typedName={name}
              typedDate={date}
              onUseName={setName}
              onUseDate={setDate}
              onClear={() => { setPicked(null); setPayload(null); }}
              onChange={setPayload}
            />
          )}

          {/* What would actually be POSTed. The whole point of the card is that
              a guess and a decision are different, so show which is which. */}
          {payload && (
            <pre className="overflow-x-auto border border-stone-200 bg-stone-50 p-4 text-[11px] leading-relaxed text-stone-600">
              {JSON.stringify(payload, null, 2)}
            </pre>
          )}
        </div>
      </main>
    </div>
  );
}
