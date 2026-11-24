import { describe, it, expect } from "vitest";
import { buildRosterIndex, gigCrewFor, gigsInWindow, resolveTitleName, type RosterRow } from "./gig-crew";

const roster: RosterRow[] = [
  {
    id: "joey",
    display_name: "Joey",
    full_name: "Joseph Nagel",
    primary_email: "joey@twodudesphoto.com",
    aliases: ["joeynags@gmail.com"],
  },
  { id: "jerrick", display_name: "Jerrick", full_name: null, primary_email: "Jerrick@TwoDudesPhoto.com", aliases: [] },
  { id: "cari", display_name: "Cari Lopez", full_name: null, primary_email: "cari@example.com", aliases: null },
  { id: "stretch", display_name: "Stretch", full_name: "Robert Long", primary_email: "stretch@example.com", aliases: [] },
  // Two Alexes: the first name alone is ambiguous.
  { id: "alex1", display_name: "Alex Kim", full_name: null, primary_email: "alexk@example.com", aliases: [] },
  { id: "alex2", display_name: "Alex Ruiz", full_name: null, primary_email: "alexr@example.com", aliases: [] },
];
const index = buildRosterIndex(roster);

describe("resolveTitleName", () => {
  it("matches a shouted first name, a nickname, a full name and an accent", () => {
    expect(resolveTitleName("JOEY", index)?.id).toBe("joey");
    expect(resolveTitleName("Joseph", index)?.id).toBe("joey"); // first word of the full name
    expect(resolveTitleName("STRETCH", index)?.id).toBe("stretch");
    expect(resolveTitleName("CARI", index)?.id).toBe("cari");
    expect(resolveTitleName("Alex Kím", index)?.id).toBe("alex1");
  });
  it("resolves nobody when two people answer, or nobody does", () => {
    expect(resolveTitleName("ALEX", index)).toBeNull();
    expect(resolveTitleName("CRISTINA", index)).toBeNull();
    expect(resolveTitleName("", index)).toBeNull();
  });
});

describe("gigCrewFor", () => {
  const ev = {
    id: "cal-1",
    summary: "JOEY & JERRICK & ALEX & CRISTINA // Perkin Elmer SKO // Scottsdale",
    location: "The Scottsdale Plaza Resort",
    start: { dateTime: "2026-11-20T08:00:00-07:00" },
    end: { dateTime: "2026-11-20T17:00:00-07:00" },
    attendees: [
      { email: "JoeyNags@Gmail.com", displayName: "Joey N" }, // an alias of Joey
      { email: "joey@twodudesphoto.com" }, // Joey again, primary: one person once
      { email: "out00v9tpf06eldqsquh8m8d7s@group.calendar.google.com" }, // the calendar itself
      { email: "freelancer@example.com", displayName: "Pat Freelance" }, // not on the roster
    ],
  };

  it("passes attendee emails through lower-cased, named from the roster by alias", () => {
    const g = gigCrewFor(ev, index);
    expect(g.crew.filter((m) => m.source === "attendee")).toEqual([
      { email: "joeynags@gmail.com", display_name: "Joey", source: "attendee", on_roster: true },
      { email: "freelancer@example.com", display_name: "Pat Freelance", source: "attendee", on_roster: false },
    ]);
  });

  it("adds title crew not already present, with email null for names that do not resolve", () => {
    const g = gigCrewFor(ev, index);
    expect(g.crew.filter((m) => m.source === "title")).toEqual([
      { email: "jerrick@twodudesphoto.com", display_name: "Jerrick", source: "title", on_roster: true },
      { email: null, display_name: "ALEX", source: "title", on_roster: false }, // ambiguous: never guessed
      { email: null, display_name: "CRISTINA", source: "title", on_roster: false },
    ]);
    expect(g.crew.filter((m) => m.display_name === "Joey")).toHaveLength(1); // JOEY in the title = the attendee
  });

  it("carries the calendar's id, times, title, city and venue", () => {
    const g = gigCrewFor(ev, index);
    expect(g).toMatchObject({
      calendar_event_id: "cal-1",
      start: "2026-11-20T08:00:00-07:00",
      end: "2026-11-20T17:00:00-07:00",
      title: ev.summary,
      city: "Scottsdale",
      venue: "The Scottsdale Plaza Resort",
      kind: "gig",
    });
  });
});

describe("gigsInWindow", () => {
  const gig = (id: string, day: string, summary = "JOEY // Acme Headshots // Austin") => ({
    id,
    summary,
    start: { date: day },
    end: { date: day },
  });

  it("keeps jobs that start inside the window, on the calendar's own day", () => {
    const out = gigsInWindow(
      [
        gig("before", "2026-10-31"),
        gig("first", "2026-11-01"),
        gig("last", "2026-11-30"),
        gig("after", "2026-12-01"),
        { id: "late", summary: "JOEY // Acme Party // Austin", start: { dateTime: "2026-11-30T23:30:00-08:00" } },
      ],
      { from: "2026-11-01", to: "2026-11-30" },
      index
    );
    expect(out.map((g) => g.calendar_event_id)).toEqual(["first", "last", "late"]);
  });

  it("drops entries with no id and entries that are not work", () => {
    const out = gigsInWindow(
      [
        { summary: "JOEY // Acme // Austin", start: { date: "2026-11-02" } },
        gig("flight", "2026-11-02", "Flight to Austin"),
      ],
      { from: "2026-11-01", to: "2026-11-30" },
      index
    );
    expect(out).toEqual([]);
  });
});
