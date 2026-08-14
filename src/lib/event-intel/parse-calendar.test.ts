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
  classifyGig,
  extractContactEmails,
  groupIntoGigs,
  htmlToText,
  isCompanyShoot,
  isShoutedName,
  normaliseClient,
  parseDescriptionSections,
  parseGig,
  parseStudioSession,
  parseVenue,
  suggestEventName,
  titleCaseEventName,
  venueKey,
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

describe("venue parsing — every fixture a real calendar location", () => {
  it("splits the full Google address form", () => {
    const v = parseVenue("Fox Theatre, 2215 Broadway Street, Redwood City, CA 94063, United States")!;
    expect(v.name).toBe("Fox Theatre");
    expect(v.city).toBe("Redwood City");
    expect(v.region).toBe("CA");
    expect(v.postal).toBe("94063");
    expect(v.country).toBe("United States");
  });

  it("names no venue when the string is a bare street address", () => {
    // Inventing a venue called "301 Battery St" would create one venue per
    // street address and defeat the point of the registry.
    const v = parseVenue("301 Battery St, San Francisco, CA 94111, United States")!;
    expect(v.name).toBeNull();
    expect(v.street).toBe("301 Battery St");
    expect(v.city).toBe("San Francisco");
  });

  it("handles a state with no ZIP", () => {
    const v = parseVenue("Asian Art Museum, 200 Larkin Street, San Francisco, CA, United States")!;
    expect(v.name).toBe("Asian Art Museum");
    expect(v.city).toBe("San Francisco");
    expect(v.postal).toBeNull();
  });

  it("treats a lone token as a name, not a city", () => {
    const v = parseVenue("Four seasons")!;
    expect(v.name).toBe("Four seasons");
    expect(v.city).toBeNull();
  });

  it("handles a name with a partial address", () => {
    const v = parseVenue("Alumni House Parking Lot, Berkeley, CA")!;
    expect(v.name).toBe("Alumni House Parking Lot");
    expect(v.city).toBe("Berkeley");
    expect(v.region).toBe("CA");
  });

  it("always keeps the raw string, because the parse is a convenience", () => {
    const raw = "Casa Real at Ruby Hill Winery, 410 Vineyard Avenue, Pleasanton, CA, United States";
    expect(parseVenue(raw)!.raw).toBe(raw);
  });

  it("groups the same venue written two ways", () => {
    const a = parseVenue("The Westin St Francis, Powell Street, San Francisco, CA, United States")!;
    const b = parseVenue("The Westin St Francis, 335 Powell St, San Francisco, CA 94102, United States")!;
    expect(venueKey(a)).toBe(venueKey(b));
  });

  it("does not group different venues in the same city", () => {
    const a = parseVenue("Asian Art Museum, San Francisco, CA")!;
    const b = parseVenue("The Westin St Francis, San Francisco, CA")!;
    expect(venueKey(a)).not.toBe(venueKey(b));
  });

  it("returns null for nothing at all", () => {
    expect(parseVenue(null)).toBeNull();
    expect(parseVenue("")).toBeNull();
  });
});

describe("studio sessions — a third format the gig parser cannot read", () => {
  const nick = {
    summary: "Nick Lombardo: Standard Headshot Session // $375 (Two Dudes Photo)",
    location: "Two Dudes Photo",
    description:
      "June 19, 2026 9:00am PDT\nCalendar: Two Dudes Photo\nName: Nick Lombardo\n" +
      "Phone: +12039801010\nEmail: nicholas.lombardo12@gmail.com\nPrice: $375.00\n",
  };

  it("reads the client, email, session type and price", () => {
    const s = parseStudioSession(nick);
    expect(s.clientName).toBe("Nick Lombardo");
    expect(s.email).toBe("nicholas.lombardo12@gmail.com");
    expect(s.sessionType).toBe("Standard Headshot Session");
    expect(s.price).toBe(375);
    expect(s.isBooking).toBe(true);
  });

  it("falls back to the title when there is no Acuity body", () => {
    const s = parseStudioSession({ summary: "Chris Barnet: Standard Headshot Session // $375" });
    expect(s.clientName).toBe("Chris Barnet");
    expect(s.price).toBe(375);
  });

  it("does not treat a studio hold as a booking", () => {
    // "Studio Busy" is a block, and counting it as a client would invent one.
    expect(parseStudioSession({ summary: "Studio Busy" }).isBooking).toBe(false);
  });

  it("the gig parser finds no client here, which is why this exists", () => {
    // Demonstrates the gap rather than asserting it in prose.
    expect(parseGig(nick).titleCrew).toEqual([]);
  });
});

describe("hand-typed studio entries", () => {
  it("accepts a job typed straight into the calendar", () => {
    // "PG&E Headshots" is a real 234-photo job with no Acuity booking behind it.
    // Requiring the "Name: Session // $price" shape discarded it as a hold.
    const s = parseStudioSession({ summary: "PG&E Headshots" });
    expect(s.isBooking).toBe(true);
    expect(s.clientName).toBe("PG&E Headshots");
  });

  it("still rejects the housekeeping entries that share the calendar", () => {
    for (const chore of ["Studio Busy", "Put Studio Trash & Recycle Out", "Studio Blocked"]) {
      expect(parseStudioSession({ summary: chore }).isBooking).toBe(false);
    }
  });

  it("prefers the Acuity name over the title when both exist", () => {
    const s = parseStudioSession({
      summary: "Nick Lombardo: Standard Headshot Session // $375 (Two Dudes Photo)",
      description: "Name: Nick Lombardo\nEmail: n@example.com\nPrice: $375.00",
    });
    expect(s.clientName).toBe("Nick Lombardo");
  });
});

describe("suggesting a gallery name — spelling, not wording", () => {
  it("de-shouts and fixes the misspelled name, keeping Mason's words", () => {
    const s = suggestEventName("NICK LAMBARDO'S HEADSHOTS", { client: "Nick Lombardo" });
    expect(s.suggested).toBe("Nick Lombardo's Headshots");
    expect(s.worthChanging).toBe(true);
  });

  it("does NOT replace a good client-facing name with the internal label", () => {
    // The calendar calls this "NYC Photo Booth"; Mason's name is far better and
    // a tool that argues with him every time gets ignored.
    const s = suggestEventName("Jordan x Kids Foot Locker Back to School // NYC", {
      client: "NYC Photo Booth", city: "Bronx",
    });
    expect(s.suggested).toBe("Jordan x Kids Foot Locker Back to School // NYC");
    expect(s.worthChanging).toBe(false);
  });

  it("does not shorten a readable name to the calendar's acronym", () => {
    const s = suggestEventName("Hotel Data Conference 2026", { client: "HDC 2026" });
    expect(s.suggested).toBe("Hotel Data Conference 2026");
  });

  it("keeps a subject the calendar never knew about", () => {
    const s = suggestEventName("CollegeBoard // A Dream Deferred HBCU", { client: "College Board" });
    expect(s.suggested).toContain("A Dream Deferred HBCU");
  });

  it("offers the city as a hint rather than editing it in", () => {
    const s = suggestEventName("Clario Headshots", { client: "Clario Headshots", city: "Palo Alto" });
    expect(s.suggested).toBe("Clario Headshots");
    expect(s.cityHint).toBe("Palo Alto");
  });

  it("does not offer a city the name already carries", () => {
    const s = suggestEventName("Appfolio // Goleta", { client: "Appfolio", city: "Goleta" });
    expect(s.cityHint).toBeNull();
  });

  it("keeps acronyms shouting — Nyc would be a different kind of wrong", () => {
    expect(titleCaseEventName("NYC PHOTO BOOTH")).toBe("NYC Photo Booth");
    expect(titleCaseEventName("PG&E HEADSHOTS")).toBe("PG&E Headshots");
    expect(titleCaseEventName("EBAY HEADSHOTS")).toBe("eBay Headshots");
  });

  it("treats 'us' as a word, not the country", () => {
    // "Future of Us Festival" is a name; FUTURE OF US FESTIVAL must not become
    // "Future of US Festival".
    expect(titleCaseEventName("FUTURE OF US FESTIVAL")).toBe("Future of Us Festival");
  });

  it("stays quiet when the name is already fine", () => {
    const s = suggestEventName("Clario Headshots", { client: "Clario Headshots" });
    expect(s.worthChanging).toBe(false);
  });
});

describe("the spelling rescue must not invent corrections", () => {
  it("never rewrites a short word — Foot must not become Booth", () => {
    // foot→booth is two edits and "Booth" is in half the calendar titles. The
    // permissive version silently produced "Kids Booth Locker".
    const s = suggestEventName("Jordan x Kids Foot Locker Back to School // NYC", {
      client: "NYC Photo Booth",
    });
    expect(s.suggested).toContain("Kids Foot Locker");
    expect(s.suggested).not.toContain("Booth Locker");
  });

  it("still fixes a long misspelled surname through a possessive", () => {
    const s = suggestEventName("NICK LAMBARDO'S HEADSHOTS", { client: "Nick Lombardo" });
    expect(s.suggested).toBe("Nick Lombardo's Headshots");
  });

  it("leaves a correctly spelled name entirely alone", () => {
    const s = suggestEventName("Clario Headshots", { client: "Clario Headshots", city: "Palo Alto" });
    expect(s.suggested).toBe("Clario Headshots");
  });
});

describe("wording is Mason's; only spelling is the calendar's", () => {
  it("does not pluralise or singularise his words", () => {
    // "Headshot" → "Headshots" and "INTERNS" → "Intern" are wording changes
    // dressed up as spelling fixes.
    const a = suggestEventName("Island HQ Headshot Day", { client: "Island Headshots" });
    expect(a.suggested).toBe("Island HQ Headshot Day");
    const b = suggestEventName("eBay NATIONAL INTERNS DAY", { client: "ebay Intern Photo Booth" });
    expect(b.suggested).not.toContain("Intern DAY");
  });

  it("de-shouts a name a lowercase brand letter would otherwise hide", () => {
    // "eBay NATIONAL INTERNS DAY" is not 100% uppercase, and a strict test left
    // the loudest name in the archive untouched.
    const s = suggestEventName("eBay NATIONAL INTERNS DAY", { client: "ebay Intern Photo Booth" });
    expect(s.suggested).toBe("eBay National Interns Day");
  });

  it("offers nothing when the result equals the input", () => {
    const s = suggestEventName("DAIS 26", { client: "DAIS 26" });
    expect(s.worthChanging).toBe(false);
  });
});

describe("Mason's dating convention", () => {
  it("offers the year for an annual event", () => {
    const s = suggestEventName("eBay National Interns Day", { client: "ebay Intern Photo Booth", date: "2026-07-30" });
    expect(s.dateHint).toBe("2026");
  });

  it("offers month and year for a client shot repeatedly", () => {
    // "since we may do multiple shoots throughout the year" — a bare company
    // name collides with itself the second time.
    const s = suggestEventName("PG&E Headshots", { client: "PG&E Headshots", date: "2026-07-01", companyShoot: true });
    expect(s.dateHint).toBe("// Jul 2026");
  });

  it("offers nothing for an individual sitting", () => {
    // A person is not an annual event.
    const s = suggestEventName("Chris Barnet's Headshots", { client: "Chris Barnet", date: "2026-07-10", isIndividual: true });
    expect(s.dateHint).toBeNull();
  });

  it("offers nothing when the name is already dated", () => {
    for (const name of ["Hotel Data Conference 2026", "Appfolio // Jul 2026", "DAIS 26"]) {
      expect(suggestEventName(name, { client: name, date: "2026-06-15" }).dateHint).toBeNull();
    }
  });

  it("never edits the date in — the bucket is a judgement, not a fact", () => {
    const s = suggestEventName("Clario Headshots", { client: "Clario Headshots", date: "2026-06-17" });
    expect(s.suggested).toBe("Clario Headshots");
  });
});

describe("individual sitting vs company shoot on the studio calendar", () => {
  const acuity = (name: string, type: string, price: string) => ({
    summary: `${name}: ${type} // $${price} (Two Dudes Photo)`,
    description: `Name: ${name}\nEmail: someone@example.com\nPrice: $${price}`,
  });

  it("an Acuity sitting is an individual", () => {
    for (const n of ["Nick Lombardo", "Chris Barnet"]) {
      const s = parseStudioSession(acuity(n, "Standard Headshot Session", "375"));
      expect(s.isIndividual).toBe(true);
    }
  });

  it("a hand-typed company entry is NOT, even when it reads like a name", () => {
    // "Clario Headshots" passes looksLikePersonName on its own — two
    // capitalised words, no digits. The missing Acuity shape is what saves it.
    for (const title of ["PG&E Headshots", "Clario Headshots"]) {
      const s = parseStudioSession({ summary: title, description: "" });
      expect(s.isBooking).toBe(true);
      expect(s.isIndividual).toBe(false);
    }
  });

  it("a hold is neither", () => {
    const s = parseStudioSession({ summary: "Studio Busy", description: "" });
    expect(s.isBooking).toBe(false);
    expect(s.isIndividual).toBe(false);
  });
});

describe("date hint suppression", () => {
  const at = (name: string) => suggestEventName(name, { client: name, date: "2026-07-15" });

  it("a possessive names a person, so no date", () => {
    // The calendar flag is keyed on "Chris Barnet"; the gallery is "Chris
    // Barnet's Headshots". The name has to carry this on its own.
    for (const n of ["Chris Barnet's Headshots", "Nachi's Headshots", "Nick Lombardo's Headshots"]) {
      expect(at(n).dateHint).toBeNull();
    }
  });

  it("internal buckets get nothing", () => {
    for (const n of ["TDP Website", "TDP Work", "Two Dudes Samples", "Two Dudes Sample Images"]) {
      expect(at(n).dateHint).toBeNull();
    }
  });

  it("a real client still gets one", () => {
    expect(at("Island HQ Headshot Day").dateHint).toBe("2026");
  });
});

describe("suggester defects found by the live corpus (2026-08-13)", () => {
  it("a possessive is never a misspelling", () => {
    // Produced "Nick Lombardo's's Headshots" — the calendar word carried the
    // possessive, so "Lombardo" read as an edit-distance-2 typo for it.
    const s = suggestEventName("Nick Lombardo's Headshots", {
      client: "Nick Lombardo's Headshots",
      date: "2026-06-19",
    });
    expect(s.suggested).toBe("Nick Lombardo's Headshots");
    expect(s.worthChanging).toBe(false);
  });

  it("a brand's mandated lowercase is not evidence against shouting", () => {
    // "eBay HEADSHOTS" measured 77% uppercase and slipped under the threshold
    // solely because of eBay's lowercase e.
    expect(isShoutedName("eBay HEADSHOTS")).toBe(true);
    expect(titleCaseEventName("eBay HEADSHOTS")).toBe("eBay Headshots");
  });

  it("still does not call a genuinely mixed-case name shouting", () => {
    expect(isShoutedName("eBay Intern Photo Booth")).toBe(false);
    expect(isShoutedName("Appfolio Headshots // Goleta office")).toBe(false);
  });
});

describe("brand spelling applies without shouting", () => {
  it("fixes a run-on brand in a mixed-case name", () => {
    const s = suggestEventName("CollegeBoard // A Dream Deferred HBCU", {
      client: "CollegeBoard // A Dream Deferred HBCU",
      date: "2026-03-17",
    });
    expect(s.suggested).toBe("College Board // A Dream Deferred HBCU");
  });

  it("leaves his wording alone while fixing the brand", () => {
    // Appfolio is deliberately absent from BRAND_CASE — the company writes
    // AppFolio, Mason writes Appfolio, and his house style wins.
    const s = suggestEventName("Appfolio Headshots // Goleta office", {
      client: "Appfolio Headshots",
      date: "2026-08-05",
    });
    expect(s.suggested).toBe("Appfolio Headshots // Goleta office");
  });
});

describe("named event vs company shoot", () => {
  it("a shoot is what it is called when it is not called anything", () => {
    for (const n of ["PG&E Headshots", "Clario Headshots", "eBay Headshots",
                     "Appfolio Headshots // Goleta office"]) {
      expect(isCompanyShoot(n)).toBe(true);
    }
  });

  it("an event noun wins, however many headshots were taken there", () => {
    // "Island HQ Headshot Day" is a day, not a sitting.
    for (const n of ["Island HQ Headshot Day", "What If? Summit", "Future of Us Festival",
                     "Jordan x Kids Foot Locker Back to School // NYC",
                     "CollegeBoard // A Dream Deferred HBCU"]) {
      expect(isCompanyShoot(n)).toBe(false);
    }
  });

  it("drives the two date forms", () => {
    expect(suggestEventName("Clario Headshots", { client: "Clario Headshots", date: "2026-06-18" }).dateHint)
      .toBe("// Jun 2026");
    expect(suggestEventName("What If? Summit", { client: "What If? Summit", date: "2026-08-05" }).dateHint)
      .toBe("2026");
  });
});
