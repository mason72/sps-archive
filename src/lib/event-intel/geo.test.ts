import { describe, expect, it } from "vitest";
import {
  distanceBand,
  isMappable,
  metroDistance,
  metroKeys,
  metroPoints,
  unmappableLocations,
} from "./geo";

/**
 * The coordinate table is hand-typed, so it needs a check that does NOT share
 * its assumption.
 *
 * Asserting "SF to LA is whatever my table says" would only prove the code
 * agrees with itself. These figures are the well-known great-circle distances
 * between those city centres, taken from outside this repo — so a fat-fingered
 * digit in a latitude fails here instead of quietly placing somebody in the
 * wrong state. Tolerances are ±3%, wide enough for a difference of opinion
 * about where a city centre is and far too tight to survive a typo.
 */
describe("metro coordinates, checked against known distances", () => {
  const KNOWN: [string, string, number][] = [
    ["Bay Area", "Los Angeles", 347],
    ["Los Angeles", "Las Vegas", 228],
    ["Los Angeles", "San Diego", 111],
    ["NYC", "Boston", 190],
    ["NYC", "Washington DC", 204],
    ["Chicago", "Detroit", 238],
    ["Bay Area", "Seattle", 679],
    ["Bay Area", "NYC", 2565],
    ["Seattle", "Miami", 2724],
    ["Dallas", "Austin", 182],
    ["Austin", "San Antonio", 74],
    // 86, not the 83 first written here — the tolerance caught the reference
    // figure rather than the table, which is the check working as intended.
    ["Bay Area", "Monterey", 86],
    ["Nashville", "Atlanta", 214],
    ["Toronto", "Detroit", 208],
  ];

  for (const [from, to, expected] of KNOWN) {
    it(`${from} → ${to} is about ${expected} miles`, () => {
      const d = metroDistance(from, to);
      expect(d).not.toBeNull();
      expect(d!.miles).toBeGreaterThan(expected * 0.97);
      expect(d!.miles).toBeLessThan(expected * 1.03);
    });
  }
});

describe("bands", () => {
  it("names how you would get there", () => {
    expect(distanceBand(0)).toBe("drivable");
    expect(distanceBand(300)).toBe("drivable");
    expect(distanceBand(301)).toBe("short flight");
    expect(distanceBand(1200)).toBe("short flight");
    expect(distanceBand(1201)).toBe("long haul");
  });

  it("puts the Bay Area and LA on a plane, and LA and Vegas in a car", () => {
    // Documented on purpose: this is the boundary case Mason will notice, and
    // it is the honest answer for a one-day booking.
    expect(metroDistance("Bay Area", "LA")!.band).toBe("short flight");
    expect(metroDistance("LA", "Las Vegas")!.band).toBe("drivable");
  });
});

describe("a person with several markets", () => {
  it("measures from the nearest one, and says which", () => {
    // Caroline Sanchez, on the live roster.
    const d = metroDistance("Seattle/LV/NYC", "Los Angeles");
    expect(d).not.toBeNull();
    expect(d!.fromKey).toBe("las vegas");
    expect(d!.band).toBe("drivable");
  });

  it("reads roster shorthand and Google city names as the same place", () => {
    expect(metroKeys("SF")).toEqual(["bay area"]);
    expect(metroKeys("Walnut Creek")).toEqual(["bay area"]);
    expect(metroDistance("Oakland", "San Jose")!.miles).toBe(0);
  });
});

describe("what cannot be placed is REPORTED, never dropped", () => {
  // The three on the live roster, 2026-08-15.
  const UNMAPPABLE = ["EU", "Kentucky", "Orlando? Florida?"];

  for (const city of UNMAPPABLE) {
    it(`"${city}" is not silently treated as somewhere`, () => {
      expect(isMappable(city)).toBe(false);
      expect(metroPoints(city)).toEqual([]);
      expect(metroDistance(city, "Los Angeles")).toBeNull();
    });
  }

  it("lists them with the person, so the fix is nameable work", () => {
    expect(
      unmappableLocations([
        { display_name: "Joel Mink", city: "EU" },
        { display_name: "Stretch", city: "Las Vegas" },
        { display_name: "Callie Joy", city: "Orlando? Florida?" },
        // A blank city is a different problem — nothing to fix, nothing to say.
        { display_name: "Nobody", city: "" },
      ])
    ).toEqual([
      { name: "Joel Mink", city: "EU" },
      { name: "Callie Joy", city: "Orlando? Florida?" },
    ]);
  });
});
