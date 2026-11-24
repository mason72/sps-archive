import { describe, it, expect } from "vitest";
import { AUTO_CONFIDENCE, AUTO_MARGIN } from "@/lib/people/identity-suggestions";
import { pickCrewMatches, type CrewRosterEntry } from "./crew-match";

const roster = new Map<string, CrewRosterEntry>([
  ["joey", { id: "joey", display_name: "Joey", primary_email: " Joey@TwoDudesPhoto.com " }],
  ["jerrick", { id: "jerrick", display_name: "Jerrick", primary_email: "jerrick@twodudesphoto.com" }],
  ["cari", { id: "cari", display_name: "Cari", primary_email: null }],
]);
const c = (face_id: string, crew_id: string, similarity: number) => ({ face_id, crew_id, similarity });

describe("pickCrewMatches", () => {
  it("uses the identity engine's own auto-confirm bar", () => {
    expect(AUTO_CONFIDENCE).toBe(0.7);
    expect(AUTO_MARGIN).toBe(0.1);
  });

  it("names a face that clears 0.70 with a 0.10 lead", () => {
    expect(pickCrewMatches([c("f1", "joey", 0.82), c("f1", "jerrick", 0.41)], roster)).toEqual([
      { email: "joey@twodudesphoto.com", display_name: "Joey", confidence: 0.82 },
    ]);
  });

  it("names nobody below the line, or without the lead", () => {
    expect(pickCrewMatches([c("f1", "joey", 0.69)], roster)).toEqual([]);
    expect(pickCrewMatches([c("f1", "joey", 0.8), c("f1", "jerrick", 0.71)], roster)).toEqual([]);
  });

  it("accepts exactly 0.70, and a lead just over 0.10 (same arithmetic as decideAutoConfirm)", () => {
    expect(pickCrewMatches([c("f1", "joey", 0.7)], roster)).toHaveLength(1);
    expect(pickCrewMatches([c("f1", "joey", 0.86), c("f1", "jerrick", 0.75)], roster)).toHaveLength(1);
    expect(pickCrewMatches([c("f1", "joey", 0.84), c("f1", "jerrick", 0.75)], roster)).toHaveLength(0);
  });

  it("decides per face, keeps one entry per person at their best, sorted", () => {
    const out = pickCrewMatches(
      [
        c("f1", "joey", 0.74),
        c("f2", "joey", 0.91),
        c("f3", "jerrick", 0.88),
        c("f4", "cari", 0.55), // a guest who looks a little like Cari: not named
      ],
      roster
    );
    expect(out).toEqual([
      { email: "joey@twodudesphoto.com", display_name: "Joey", confidence: 0.91 },
      { email: "jerrick@twodudesphoto.com", display_name: "Jerrick", confidence: 0.88 },
    ]);
  });

  it("never names an id the roster read did not return, and keeps a crew member with no email", () => {
    expect(pickCrewMatches([c("f1", "stranger", 0.95)], roster)).toEqual([]);
    expect(pickCrewMatches([c("f1", "cari", 0.9)], roster)).toEqual([
      { email: null, display_name: "Cari", confidence: 0.9 },
    ]);
  });

  it("ignores a non-finite similarity rather than ranking it", () => {
    expect(pickCrewMatches([c("f1", "joey", Number.NaN)], roster)).toEqual([]);
  });
});
