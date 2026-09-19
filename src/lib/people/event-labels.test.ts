import { describe, it, expect } from "vitest";
import {
  eventLabelKeys,
  firstNameKeys,
  isLabelCompound,
  isSessionLabelFile,
  looksLikeSingleName,
  nameHasSessionWord,
  EVENT_LABEL_MIN_COUNT,
  EVENT_LABEL_MIN_SHARE,
} from "./event-labels";
import { nameBeforeDate } from "@/lib/gallery/stacks";

const rows = (eventId: string, key: string, n: number) =>
  Array.from({ length: n }, () => ({ eventId, key }));

describe("eventLabelKeys", () => {
  it("names the label of a booth export — every file parses to the job", () => {
    // Core SJC, 2026-09-02: 287 of 287 → "Google Booth".
    const labels = eventLabelKeys(rows("sjc", "googlebooth", 287), new Map([["sjc", 287]]));
    expect(labels.get("sjc")).toEqual(new Set(["googlebooth"]));
  });

  it("leaves a real sitting alone — tens of frames, never a hundred", () => {
    // "Nachi", 48 of 48: the largest single-person sitting in the archive.
    const labels = eventLabelKeys(rows("n", "nachi", 48), new Map([["n", 48]]));
    expect(labels.size).toBe(0);
  });

  it("judges share against the WHOLE event, unnamed frames included", () => {
    // 120 labelled + 1,500 camera-named: 7% — a busy guest, not the label.
    const labels = eventLabelKeys(rows("e", "acme", 120), new Map([["e", 1620]]));
    expect(labels.size).toBe(0);
    // Same 120 in a 600-photo event: 20% — the label.
    expect(eventLabelKeys(rows("e", "acme", 120), new Map([["e", 600]])).get("e")).toEqual(
      new Set(["acme"])
    );
  });

  it("catches a booth's colour labels beside its main one — eBayHR", () => {
    // 348 "eBayHR" + 4 × 317 colour variants across an 1,842-photo day.
    const labels = eventLabelKeys(
      [
        ...rows("ebay", "ebayhr", 348),
        ...rows("ebay", "ebayhrred", 317),
        ...rows("ebay", "ebayhrblue", 317),
      ],
      new Map([["ebay", 1842]])
    );
    expect(labels.get("ebay")).toEqual(new Set(["ebayhr", "ebayhrred", "ebayhrblue"]));
  });

  it("is per event: a name can label one event and be a person in another", () => {
    const labels = eventLabelKeys(
      [...rows("school", "grace", 150), ...rows("headshots", "grace", 12)],
      new Map([
        ["school", 160],
        ["headshots", 40],
      ])
    );
    expect(labels.get("school")).toEqual(new Set(["grace"]));
    expect(labels.has("headshots")).toBe(false);
  });

  it("keeps a heavily photographed guest at a big event", () => {
    // Steven Hughes: 184 frames of DAIS 26's 9,092 — a person, 2% of the day.
    const labels = eventLabelKeys(rows("dais", "stevenhughes", 184), new Map([["dais", 9092]]));
    expect(labels.size).toBe(0);
  });

  it("sits exactly on its documented thresholds", () => {
    const at = eventLabelKeys(
      rows("e", "x", EVENT_LABEL_MIN_COUNT),
      new Map([["e", EVENT_LABEL_MIN_COUNT / EVENT_LABEL_MIN_SHARE]])
    );
    expect(at.get("e")).toEqual(new Set(["x"]));
    const under = eventLabelKeys(
      rows("e", "x", EVENT_LABEL_MIN_COUNT - 1),
      new Map([["e", EVENT_LABEL_MIN_COUNT - 1]])
    );
    expect(under.size).toBe(0);
  });
});

describe("isSessionLabelFile (lesson 153)", () => {
  // First names the archive knows from dated files, measured 2026-09-14.
  const known = firstNameKeys(["Julia Chambers", "Kelly Bottarini", "Bill Birdsall", "Tessa Smith"]);
  const session = (file: string, event: string, first: ReadonlySet<string> = known) =>
    isSessionLabelFile(file, event, first, nameBeforeDate(file));

  it("flags the session exports measured on /people", () => {
    const cases: [string, string][] = [
      ["Guardant_Team-Spirit-Night_13.jpg", "Guardant Event Photos"],
      ["Guardant_General-Session_25.jpg", "Guardant Event Photos"],
      ["Atlassian_Partner_Welcome-3.jpg", "Atlassian Partner Accelerator"],
      ["Atlassian_Breakouts_1_Highlights-17.jpg", "Atlassian Partner Accelerator"],
      ["Atlassian-Champions-Breakouts-Day-2-highlights-11.jpg", "Atlassian Champions"],
      ["CEMA_Recep_0053.jpg", "CEMA Summit"],
      ["eBay_HR_6503.jpg", "eBay Staff Photos"],
    ];
    for (const [file, event] of cases) expect(session(file, event), file).toBe(true);
  });

  it("keeps a person whose file leads with their own name", () => {
    expect(session("KellyBottarini_063.jpg", "KELLY BOTTARINI'S HEADSHOTS")).toBe(false);
    expect(session("TESSA_CHIME_10811.jpg", "CHIME // Headshots 2026")).toBe(false);
    expect(session("260508_BillBirdsall_0129.jpg", "Bill, Dinah, and Steve")).toBe(false);
  });

  it("keeps a dated file even when it leads with the event's word", () => {
    expect(session("Guardant_26-03-10_Booth_0012.jpg", "Guardant Event Photos")).toBe(false);
  });

  it("a known first name guards a gallery titled for its sitter", () => {
    // The shape the rejected "shares a word" rule broke, spelled with separators.
    expect(session("Kelly_Bottarini_001.jpg", "KELLY BOTTARINI'S HEADSHOTS")).toBe(false);
    expect(session("Julia_Chambers_01.jpg", "CoStar Group // Julia & Tom")).toBe(false);
    // …and it is the guard doing it: without the known names both would go.
    expect(session("Julia_Chambers_01.jpg", "CoStar Group // Julia & Tom", new Set())).toBe(true);
  });

  it("matches the lead token whole, never a prefix of an event word", () => {
    expect(session("Guard_Team_12.jpg", "Guardant Event Photos")).toBe(false);
  });
});

describe("looksLikeSingleName", () => {
  it("admits the single-name sittings the two-word rule kept off /people", () => {
    for (const n of ["Nachi", "Sunita", "Leo", "josh", "Dimitry", "O'Neil", "Anne-Marie"]) {
      expect(looksLikeSingleName(n), n).toBe(true);
    }
  });

  it("rejects the tag shapes measured beside them", () => {
    // Shouting, digits, too short, gallery words, studio tags with digits.
    for (const n of ["MS", "KARN", "2D", "2DudesWF", "untitled", "Highlights", "STAFF", "Lo", "", "RangersLaserTag2"]) {
      expect(looksLikeSingleName(n), n).toBe(false);
    }
  });

  it("is a single word only — two-word names have their own rule", () => {
    expect(looksLikeSingleName("Brittany Reed")).toBe(false);
  });
});

describe("nameHasSessionWord", () => {
  it("catches the session labels measured on the wall", () => {
    for (const n of [
      "Guardant General Session", "Atlassian Breakouts", "Team Shots", "CEMA Recep",
      "ChampionsDinner Stepandrepeat", "Name Unknown", "Guardant After Party", "Tori Group",
      "Atlassian impact maker awards highlights",
    ]) {
      expect(nameHasSessionWord(n), n).toBe(true);
    }
  });

  it("leaves real people alone, including surnames that are also event words", () => {
    for (const n of [
      "Brittany Reed", "John Booth", "Dhairya Gala", "Melissa Hall", "Charlie Holiday",
      "Mitchell Brand", "Austin Lewis", "Christopher San Agustin", "Kelly Bottarini",
    ]) {
      expect(nameHasSessionWord(n), n).toBe(false);
    }
  });
});

describe("isLabelCompound (lesson 162)", () => {
  it("catches labels typed as one word — every compound measured in the archive", () => {
    for (const w of [
      "Teamphoto", "teamphotos", "Teamshots", "teamshot", "Groupphoto", "Groupshot",
      "Awardsdinner",
    ]) {
      expect(isLabelCompound(w), w).toBe(true);
    }
  });

  it("needs a COMPLETE breakdown into two or more pieces, so surnames survive", () => {
    for (const w of [
      "Shotwell", "Partyka", "Grouper", "Booth", "Teamer", "Photon", "Team", "Photo",
      "Brittany", "Paneloff",
    ]) {
      expect(isLabelCompound(w), w).toBe(false);
    }
  });

  it("closes both doors: the one-word person and the multi-word veto", () => {
    expect(looksLikeSingleName("Teamphoto")).toBe(false);
    expect(nameHasSessionWord("Sidecar Teamphoto")).toBe(true);
    // and still admits a real one-word person
    expect(looksLikeSingleName("Nachi")).toBe(true);
  });
});
