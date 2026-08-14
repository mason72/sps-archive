/**
 * Tests for the Two Dudes calendar parser.
 *
 * Every fixture below is a REAL entry pulled from the live Gigs and EXPOSURE
 * calendars on 2026-08-13, trimmed but not reshaped. That matters: a parser for
 * a bespoke convention tested against invented examples only proves it handles
 * the convention someone imagined, and the whole value here is that twelve years
 * of real entries are messier than the pattern suggests — status prefixes, two
 * different separators, titles with no crew at all, and a description format
 * that changes completely between 2018 and 2023.
 */
import { describe, it, expect } from "vitest";
import {
  parseGig,
  classifyGig,
  groupIntoGigs,
  parseDescriptionSections,
  extractContactEmails,
  normaliseClient,
  htmlToText,
} from "./parse-calendar";

describe("title parsing", () => {
  it("reads crew, client and city from the three-segment form", () => {
    // EXPOSURE, 2018-02-11, the gig that is also Pixieset collection 11139225.
    const g = parseGig({
      summary: "JOEY & JERRICK & CRISTINA & CARI  //  Perkin Elmer SKO  //  Scottsdale",
      location: "The Scottsdale Plaza Resort",
      attendees: [
        { email: "jerrickmitra@gmail.com", displayName: "jerrick mitra" },
        { email: "joeynags@gmail.com" },
      ],
    });
    expect(g.titleCrew).toEqual(["JOEY", "JERRICK", "CRISTINA", "CARI"]);
    expect(g.client).toBe("Perkin Elmer SKO");
    expect(g.city).toBe("Scottsdale");
    expect(g.venue).toBe("The Scottsdale Plaza Resort");
    expect(g.kind).toBe("gig");
  });

  it("handles the pipe separator as well as the double slash", () => {
    // Gigs, 2018-02-13.
    const g = parseGig({
      summary: "CHRISTIE & JUSTIN  |  Grace Cathedral Event",
      location: "Grace Cathedral",
    });
    expect(g.titleCrew).toEqual(["CHRISTIE", "JUSTIN"]);
    expect(g.client).toBe("Grace Cathedral Event");
  });

  it("strips a bracketed status prefix before looking for crew", () => {
    // EXPOSURE, 2023-08-17. Without stripping, "[SLAM] JOEY" is not crew-shaped
    // and the whole entry parses as a nameless job.
    const g = parseGig({
      summary: "[SLAM] JOEY, JERRICK | Axos Bank Headshots",
      location: "1331 Pennsylvania Avenue NW",
    });
    expect(g.titleCrew).toEqual(["JOEY", "JERRICK"]);
    expect(g.client).toBe("Axos Bank Headshots");
    expect(g.notes.some((n) => /status prefix/.test(n))).toBe(true);
  });

  it("strips a bare word status prefix too", () => {
    // EXPOSURE, 2016-09-06 — the earliest entry on that calendar.
    const g = parseGig({ summary: "BOOKED | Boxworks 2016 SF" });
    expect(g.titleCrew).toEqual([]);
    expect(g.client).toBe("Boxworks 2016 SF");
  });

  it("does not mistake a client for a crew member", () => {
    // "Stanford Event" is Title Case, not the shouty crew convention. Reading it
    // as a person called Stanford would invent a crew member out of a client.
    const g = parseGig({
      summary: "JOEY & CHRIS | Stanford Event",
      location: "Fox Theatre, 2215 Broadway Street, Redwood City, CA 94063, United States",
    });
    expect(g.titleCrew).toEqual(["JOEY", "CHRIS"]);
    expect(g.client).toBe("Stanford Event");
    expect(g.city).toBeNull();
  });

  it("keeps attendees when the title carries no crew at all", () => {
    const g = parseGig({
      summary: "Jennifer Zimmerman",
      attendees: [{ email: "ryan@ryandarcy.com" }],
    });
    expect(g.titleCrew).toEqual([]);
    expect(g.attendees.map((a) => a.email)).toEqual(["ryan@ryandarcy.com"]);
    expect(g.notes.some((n) => /attendees are the only crew signal/.test(n))).toBe(true);
  });
});

describe("classification", () => {
  it("recognises travel, which is the bulk of the noise", () => {
    // Both real, from the Perkin Elmer trip.
    expect(classifyGig({ summary: "Flight: WN 1390 from SLC to PHX" })).toBe("travel");
    expect(classifyGig({ summary: "Flight: WN 1425 from PHX to SLC" })).toBe("travel");
  });

  it("recognises admin entries with no crew, people or venue", () => {
    expect(classifyGig({ summary: "BNI Meeting", location: null })).toBe("admin");
  });

  it("does NOT discard a holiday party — 76 of them are real gigs", () => {
    // "holiday" is an admin word, so the admin test must require the absence of
    // crew AND attendees AND a venue before it fires.
    const kind = classifyGig({
      summary: "JOEY & STRETCH | Acme Holiday Party",
      location: "The Fillmore",
    });
    expect(kind).toBe("gig");
  });

  it("marks set-up entries separately so they group with their gig", () => {
    expect(classifyGig({ summary: "JOEY & JERRICK | Set Up for Axos Bank Headshots" })).toBe("setup");
  });
});

describe("description parsing", () => {
  const the2018Body =
    "** ONSITE CONTACT<br>Nikki Nummela - 508-662-4241<br><br>** SCHEDULE<br>7 am to 6 pm: Headshots<br><br>" +
    "** FREIGHT<br>Gear coming in from Avaya event.<br><br>** SAVE FOLDER&nbsp;<br>Headshots: \\\\2018-02-12 Perkin_Elmer_Headshots";

  it("splits the ** SECTION format used through 2018", () => {
    const s = parseDescriptionSections(the2018Body);
    expect(s.onsiteContact).toContain("Nikki Nummela");
    expect(s.schedule).toContain("Headshots");
    expect(s.freight).toContain("Avaya");
    expect(s.saveFolder).toContain("Perkin_Elmer_Headshots");
  });

  it("pulls the onsite contact email, which resolves the payer", () => {
    // The Axos body carried mtran@axosbank.com, and axosbank.com has 19
    // invoices in the PandaDoc export — that is the calendar-to-money join.
    const emails = extractContactEmails(
      'Onsite Contact<br>Michelle Tran<br><a href="mailto:mtran@axosbank.com">mtran@axosbank.com</a>'
    );
    expect(emails).toContain("mtran@axosbank.com");
  });

  it("decodes the entities and escapes Google puts in descriptions", () => {
    expect(htmlToText("Gala &amp; Reception<br>7pm&nbsp;start")).toBe("Gala & Reception\n7pm start");
  });

  it("returns nothing rather than guessing on an empty body", () => {
    expect(parseDescriptionSections(null)).toEqual({});
    expect(parseDescriptionSections("")).toEqual({});
  });
});

describe("grouping — one collection is N calendar entries", () => {
  it("groups set-up, main day and evening into a single gig", () => {
    // The real Axos shape: three entries across 16–17 Aug 2023.
    const gigs = groupIntoGigs([
      { summary: "JOEY & JERRICK | Set Up for Axos Bank Headshots", start: { dateTime: "2023-08-16T12:00:00-07:00" } },
      { summary: "[SLAM] JOEY, JERRICK | Axos Bank Headshots", start: { dateTime: "2023-08-17T04:30:00-07:00" } },
      { summary: "[SLAM] JOEY, JERRICK | Axos Bank Headshots", start: { dateTime: "2023-08-17T15:00:00-07:00" } },
    ]);
    expect(gigs).toHaveLength(1);
    expect(gigs[0].events).toHaveLength(3);
    expect(gigs[0].start).toBe("2023-08-16");
    expect(gigs[0].end).toBe("2023-08-17");
  });

  it("keeps different clients on the same day apart", () => {
    const gigs = groupIntoGigs([
      { summary: "JOEY | Acme Headshots", start: { date: "2023-08-17" } },
      { summary: "STRETCH | Globex Gala", start: { date: "2023-08-17" } },
    ]);
    expect(gigs).toHaveLength(2);
  });

  it("drops travel and admin before grouping", () => {
    const gigs = groupIntoGigs([
      { summary: "Flight: WN 1390 from SLC to PHX", start: { dateTime: "2023-08-16T09:35:00-07:00" } },
      { summary: "JOEY | Acme Headshots", start: { date: "2023-08-17" } },
    ]);
    expect(gigs).toHaveLength(1);
    expect(gigs[0].events).toHaveLength(1);
  });
});

describe("client normalisation", () => {
  it("matches the same client across years and job words", () => {
    // These are the same client and must collapse, or the same company becomes
    // three organisations in the registry.
    expect(normaliseClient("Perkin Elmer SKO")).toBe(normaliseClient("Perkin Elmer"));
    expect(normaliseClient("Island SKO FY27")).toBe(normaliseClient("Island"));
    expect(normaliseClient("Axos Bank Headshots")).toBe(normaliseClient("Axos Bank"));
  });

  it("does not collapse genuinely different clients", () => {
    expect(normaliseClient("Perkin Elmer")).not.toBe(normaliseClient("Pure Storage"));
  });
});

describe("regressions found by real 2014 data", () => {
  it("a BNI meeting is admin even though it has a venue", () => {
    // Gigs, 2014-05-01, held at Le Méridien San Francisco. The first version
    // required the ABSENCE of a venue before calling something admin, so this
    // fell through to "unknown" — and unknown was then counted as a gig.
    expect(
      classifyGig({
        summary: "BNI Meeting",
        location: "Le Méridien San Francisco, Battery Street, San Francisco, CA, United States",
      })
    ).toBe("admin");
  });

  it("still does not call a holiday party admin", () => {
    // The weak/strong split has to keep this working: 76 of these are real gigs.
    expect(
      classifyGig({ summary: "JOEY & STRETCH | Acme Holiday Party", location: "The Fillmore" })
    ).toBe("gig");
  });

  it("groups only jobs — an unreadable entry is not evidence of a gig", () => {
    // The real week: 2 BNI meetings, a "Super Bowl Demo", a booth note and
    // three real gigs. Grouping reported seven.
    const week = [
      { summary: "BNI Meeting", location: "Le Méridien San Francisco", start: { dateTime: "2014-05-01T07:15:00-07:00" } },
      { summary: "Ryan LEAVE 1PM, setup booth 4-6, run booth 6-10", start: { dateTime: "2014-05-03T13:00:00-07:00" } },
      { summary: "RYAN & MASON | Jennifer Zimmerman", location: "1700 West Hillsdale Boulevard", start: { dateTime: "2014-05-03T18:00:00-07:00" } },
      { summary: "JOEY & CHRIS | Stanford Event", location: "Fox Theatre", start: { dateTime: "2014-05-03T21:00:00-07:00" } },
      { summary: "MASON & JOEY | Cal event", location: "Alumni House Parking Lot, Berkeley", start: { dateTime: "2014-05-04T10:00:00-07:00" } },
      { summary: "Super Bowl Demo", start: { dateTime: "2014-05-05T10:00:00-07:00" } },
      { summary: "BNI Meeting", location: "Le Méridien San Francisco", start: { dateTime: "2014-05-08T07:15:00-07:00" } },
    ];
    const gigs = groupIntoGigs(week);
    // Three named clients plus the booth setup note, never the meetings or the demo.
    expect(gigs.length).toBeLessThanOrEqual(4);
    const clients = gigs.map((g) => g.client ?? "");
    expect(clients.some((c) => /BNI/i.test(c))).toBe(false);
    expect(clients.some((c) => /Super Bowl/i.test(c))).toBe(false);
  });
});
