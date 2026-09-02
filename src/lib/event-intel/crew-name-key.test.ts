import { describe, it, expect } from "vitest";
import { crewNameKey } from "./crew-name-key";

describe("crewNameKey", () => {
  // Mason typed "michael" into the confirm card's bare crew field on the Core
  // SJC import (2026-09-02); apply-gig would have created a second Michael.
  it("folds case, spacing, punctuation and accents", () => {
    expect(crewNameKey("Sergio Gomez")).toBe(crewNameKey(" sergio  gomez "));
    expect(crewNameKey("Sergio Gómez")).toBe(crewNameKey("Sergio Gomez"));
    expect(crewNameKey("J. Smith")).toBe(crewNameKey("JSmith"));
  });

  it("keeps different people apart", () => {
    expect(crewNameKey("Michael Chen")).not.toBe(crewNameKey("Michael Cheng"));
    expect(crewNameKey("Joey")).not.toBe(crewNameKey("Joey Nagoshiner"));
  });
});
