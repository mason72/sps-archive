import { describe, it, expect } from "vitest";
import {
  EMPTY_JOB_META,
  keepOmittedCaseStudyFields,
  parseJobMeta,
  serializeJob,
  storyNamesClient,
  validateJobMeta,
  type JobMeta,
  type JobStoryMeta,
} from "./jobs";

const ID_A = "87a045a5-9d25-490e-a307-61bf8d63d122";
const ID_B = "f37a9cfa-4b0f-43b4-bd3d-ee7312247772";

const COMPLETE: JobMeta = {
  ...EMPTY_JOB_META,
  client: "Rand Technology",
  city: "Munich",
  services: ["headshot-booth"],
  eventSize: "10000-plus",
  duration: "2-3-days",
  teams: "1",
  industry: "tech",
  year: 2026,
};

const STORY: JobStoryMeta = {
  status: "published",
  source: "claude",
  headline: "Munich asked for us again.",
  dek: "Three days at Messe München.",
  body: "First paragraph.\n\nSecond paragraph.",
  quote: null,
};

const PROOF = { photos: 4964, galleries: 1, people: 284, days: [[1, 2]], countedAt: "2026-11-23T00:00:00.000Z" };

describe("story, special and sources (validateJobMeta)", () => {
  it("accepts a full case-study document and keeps paragraphs", () => {
    const r = validateJobMeta({
      ...COMPLETE,
      special: true,
      story: { ...STORY, body: "One.\r\n\r\n\r\n\r\nTwo.  \nstill two." },
      sources: [{ eventId: ID_A, people: true }, { eventId: ID_B }],
    });
    if ("error" in r) throw new Error(r.error);
    expect(r.meta.special).toBe(true);
    expect(r.meta.story?.body).toBe("One.\n\nTwo.\nstill two.");
    expect(r.meta.sources).toEqual([
      { eventId: ID_A, people: true },
      { eventId: ID_B, people: false },
    ]);
  });

  it("never accepts proof from a request body", () => {
    const r = validateJobMeta({ ...COMPLETE, proof: PROOF });
    if ("error" in r) throw new Error(r.error);
    expect(r.meta.proof).toBeNull();
  });

  it("rejects malformed stories", () => {
    const bad: unknown[] = [
      { ...STORY, status: "live" },
      { ...STORY, source: "intern" },
      { ...STORY, headline: "  " },
      { ...STORY, body: "" },
      { ...STORY, headline: "x".repeat(121) },
      { ...STORY, quote: { text: "Loved it" } }, // a quote needs who said it
      { ...STORY, quote: "Loved it" },
      [STORY],
    ];
    for (const story of bad) {
      expect("error" in validateJobMeta({ ...COMPLETE, story })).toBe(true);
    }
    // null clears the story
    const cleared = validateJobMeta({ ...COMPLETE, story: null });
    expect("error" in cleared ? null : cleared.meta.story).toBeNull();
  });

  it("rejects malformed sources", () => {
    const bad: unknown[] = [
      "not-an-array",
      [{ eventId: "nope" }],
      [{ eventId: ID_A }, { eventId: ID_A.toUpperCase() }],
      [{ eventId: ID_A, people: "yes" }],
      [null],
    ];
    for (const sources of bad) {
      expect("error" in validateJobMeta({ ...COMPLETE, sources })).toBe(true);
    }
  });

  it("reads stored docs leniently: an unreadable status is a draft, never published", () => {
    const meta = parseJobMeta({ ...COMPLETE, story: { ...STORY, status: "PUBLISHED" } });
    expect(meta.story?.status).toBe("draft");
    expect(parseJobMeta({ story: { headline: "No body" } }).story).toBeNull();
    expect(parseJobMeta({ special: "yes" }).special).toBe(false);
    expect(parseJobMeta({ proof: { photos: -1, galleries: 1, countedAt: "x" } }).proof).toBeNull();
  });

  it("legacy documents without the new fields still parse", () => {
    const { special, story, sources, proof } = parseJobMeta({ client: "Acme" });
    expect({ special, story, sources, proof }).toEqual({ special: false, story: null, sources: [], proof: null });
  });
});

describe("serializeJob: story and proof", () => {
  it("sends a published story without its workflow fields", () => {
    const job = serializeJob("x", { ...COMPLETE, story: STORY });
    expect(job.story).toEqual({ headline: STORY.headline, dek: STORY.dek, body: STORY.body, quote: null });
  });

  it("NEVER sends a draft", () => {
    expect(serializeJob("x", { ...COMPLETE, story: { ...STORY, status: "draft" } }).story).toBeNull();
  });

  it("sends proof as counts only: no source ids, no countedAt", () => {
    const job = serializeJob("x", { ...COMPLETE, sources: [{ eventId: ID_A, people: true }], proof: PROOF });
    expect(job.proof).toEqual({ photos: 4964, galleries: 1, people: 284, days: [[1, 2]] });
    expect(JSON.stringify(job)).not.toContain(ID_A);
  });

  it("drops a zero proof (the site would show 0 photos)", () => {
    expect(serializeJob("x", { ...COMPLETE, proof: { ...PROOF, photos: 0 } }).proof).toBeNull();
  });
});

describe("anonymized stories never name the client", () => {
  const anon: JobMeta = { ...COMPLETE, anonymize: true, alias: "Enterprise tech client" };

  it("withholds a story that names the client, in any field", () => {
    for (const story of [
      { ...STORY, body: "Rand Technology brought us back." },
      { ...STORY, headline: "Rand asked for us again" },
      { ...STORY, quote: { text: "Great", by: "Jo, RAND" , role: null } },
    ]) {
      const meta = { ...anon, story };
      expect(storyNamesClient(meta)).toBe(true);
      expect(serializeJob("x", meta).story).toBeNull();
      expect(JSON.stringify(serializeJob("x", meta))).not.toMatch(/rand technology|\brand\b/i);
    }
  });

  it("does not trip on words that merely contain the name", () => {
    const meta = { ...anon, story: { ...STORY, body: "Our brand of lounge, grand halls." } };
    expect(storyNamesClient(meta)).toBe(false);
    expect(serializeJob("x", meta).story).not.toBeNull();
  });

  it("a named (not anonymized) client may appear in its own story", () => {
    const meta = { ...COMPLETE, story: { ...STORY, body: "Rand Technology brought us back." } };
    expect(serializeJob("x", meta).story).not.toBeNull();
  });
});

describe("name guard: the forms review found it missed", () => {
  const cases: Array<[string, string]> = [
    ["Salesforce, Inc.", "Salesforce brought us back."],
    ["HP Inc.", "HP's people team booked the lounge."],
    ["Amazon.com", "Amazon flew us out."],
    ["GE Aerospace", "GE booked us for a week."],
    ["Coca-Cola", "The CocaCola team loved it."],
    ["Atlassian", "One headshot lounge at Atlassian's Team 26."],
  ];
  for (const [client, body] of cases) {
    it(`${client} vs "${body}"`, () => {
      const meta: JobMeta = { ...COMPLETE, client, anonymize: true, alias: "Enterprise client", story: { ...STORY, body } };
      expect(storyNamesClient(meta)).toBe(true);
      expect(serializeJob("x", meta).story).toBeNull();
    });
  }

  it("generic words in the name do not trip it (Rand Technology vs 'technology')", () => {
    const meta: JobMeta = {
      ...COMPLETE,
      anonymize: true,
      alias: "Enterprise tech client",
      story: { ...STORY, body: "An enterprise technology client, a global trade fair, the brand team." },
    };
    expect(storyNamesClient(meta)).toBe(false);
  });

  it("the validator refuses to PUBLISH such a story, but a draft may hold it while being edited", () => {
    const base = { ...COMPLETE, anonymize: true, alias: "Enterprise tech client" };
    const named = { ...STORY, body: "Rand brought us back." };
    expect(validateJobMeta({ ...base, story: named })).toEqual({
      error: expect.stringMatching(/names the client/),
    });
    expect("error" in validateJobMeta({ ...base, story: { ...named, status: "draft" } })).toBe(false);
  });
});

describe("keepOmittedCaseStudyFields (a stale browser tab must not erase a story)", () => {
  const stored: JobMeta = {
    ...COMPLETE,
    special: true,
    story: STORY,
    sources: [{ eventId: ID_A, people: true }],
  };

  it("a body without the new keys keeps the stored ones", () => {
    const oldTabBody = { ...COMPLETE, city: "Berlin" }; // the pre-deploy form's shape
    for (const k of ["special", "story", "sources"]) delete (oldTabBody as Record<string, unknown>)[k];
    const r = validateJobMeta(keepOmittedCaseStudyFields(oldTabBody, stored));
    if ("error" in r) throw new Error(r.error);
    expect(r.meta.city).toBe("Berlin");
    expect(r.meta.story).toEqual(STORY);
    expect(r.meta.special).toBe(true);
    expect(r.meta.sources).toEqual(stored.sources);
  });

  it("an explicit null / [] / false still changes the field", () => {
    const r = validateJobMeta(
      keepOmittedCaseStudyFields({ ...COMPLETE, story: null, sources: [], special: false }, stored)
    );
    if ("error" in r) throw new Error(r.error);
    expect([r.meta.story, r.meta.sources, r.meta.special]).toEqual([null, [], false]);
  });

  it("passes garbage through for the validator to reject", () => {
    expect("error" in validateJobMeta(keepOmittedCaseStudyFields("nope", stored))).toBe(true);
  });
});
