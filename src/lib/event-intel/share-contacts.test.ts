import { describe, expect, it } from "vitest";
import { clientNameMatches, rankShareContacts } from "./share-contacts";

const none = () => false;

describe("rankShareContacts", () => {
  it("puts the calendar contact first, then the client's most recent past recipients", () => {
    const out = rankShareContacts({
      calendar: ["Jen@Docusign.com"],
      history: [
        { email: "old@docusign.com", eventName: "Docusign // Jan 2025", sentAt: "2025-01-10" },
        { email: "new@docusign.com", eventName: "Docusign // Jun 2026", sentAt: "2026-06-10" },
      ],
      sentHere: [],
      exclude: none,
    });
    expect(out.map((c) => [c.email, c.source])).toEqual([
      ["jen@docusign.com", "calendar"],
      ["new@docusign.com", "client"],
      ["old@docusign.com", "client"],
    ]);
  });

  it("marks an address already sent this gallery instead of hiding it", () => {
    const out = rankShareContacts({ calendar: ["jen@docusign.com"], history: [], sentHere: ["JEN@docusign.com"], exclude: none });
    expect(out).toEqual([{ email: "jen@docusign.com", source: "sent", detail: "Already sent this gallery" }]);
  });

  it("never suggests an excluded address (ours, the crew)", () => {
    const out = rankShareContacts({
      calendar: ["info@twodudesphoto.com", "client@acme.com"],
      history: [{ email: "photog@crew.com", eventName: "x", sentAt: "2026-01-01" }],
      sentHere: [],
      exclude: (e) => e.endsWith("@twodudesphoto.com") || e === "photog@crew.com",
    });
    expect(out.map((c) => c.email)).toEqual(["client@acme.com"]);
  });

  it("caps the client history at three distinct people, counting after dedupe", () => {
    const history = ["a", "a", "b", "c", "d"].map((n, i) => ({
      email: `${n}@acme.com`,
      eventName: `E${i}`,
      sentAt: `2026-0${9 - i}-01`,
    }));
    const out = rankShareContacts({ calendar: [], history, sentHere: [], exclude: none });
    expect(out.map((c) => c.email)).toEqual(["a@acme.com", "b@acme.com", "c@acme.com"]);
  });

  it("returns nothing when there is nothing to go on", () => {
    expect(rankShareContacts({ calendar: [], history: [], sentHere: [], exclude: none })).toEqual([]);
  });
});

describe("clientNameMatches", () => {
  it("matches a stored client named by the calendar's leading words", () => {
    expect(clientNameMatches("Appfolio SB", "Appfolio")).toBe(true);
    expect(clientNameMatches("FM Headshots", "FM")).toBe(true);
    expect(clientNameMatches("Episode.1 Agency", "Episode.1")).toBe(true);
  });
  it("never matches part of a word, or an empty name", () => {
    expect(clientNameMatches("Appfolios", "Appfolio")).toBe(false);
    expect(clientNameMatches("Sonya Headshots", "Sony")).toBe(false);
    expect(clientNameMatches("Anything", "")).toBe(false);
  });
});
