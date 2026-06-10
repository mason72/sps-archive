import { describe, it, expect } from "vitest";
import {
  parseJobMeta,
  validateJobMeta,
  jobMissingFields,
  isJobComplete,
  serializeJob,
  jobSlugFromName,
  isValidJobSlug,
  isJobSceneKey,
  jobSlugFromKey,
  suggestIndustryForClient,
  suggestAlias,
  EMPTY_JOB_META,
  type JobMeta,
} from "./jobs";

const COMPLETE: JobMeta = {
  ...EMPTY_JOB_META,
  client: "ServiceNow",
  eventName: "Knowledge 25",
  city: "Las Vegas",
  venue: "MGM Grand",
  services: ["headshot-booth", "event-photography"],
  eventSize: "2000-10000",
  duration: "2-3-days",
  teams: "3",
  ballpark: "24-48k",
  industry: "tech",
  year: 2025,
};

describe("parseJobMeta", () => {
  it("returns an empty document for null/garbage", () => {
    expect(parseJobMeta(null)).toEqual(EMPTY_JOB_META);
    expect(parseJobMeta("nope")).toEqual(EMPTY_JOB_META);
    expect(parseJobMeta(42)).toEqual(EMPTY_JOB_META);
  });

  it("drops unknown services and bad enum values instead of crashing", () => {
    const meta = parseJobMeta({
      services: ["photo-booth", "environmental-portraits", "bogus"],
      eventSize: "huge",
      teams: "100",
      year: "2025",
    });
    expect(meta.services).toEqual(["photo-booth"]);
    expect(meta.eventSize).toBeNull();
    expect(meta.teams).toBeNull();
    expect(meta.year).toBeNull();
  });

  it("trims strings to null and clears industryOther unless industry is other", () => {
    const meta = parseJobMeta({ client: "  ", industry: "tech", industryOther: "Food" });
    expect(meta.client).toBeNull();
    expect(meta.industryOther).toBeNull();
    const other = parseJobMeta({ industry: "other", industryOther: " Food & beverage " });
    expect(other.industryOther).toBe("Food & beverage");
  });
});

describe("validateJobMeta", () => {
  it("accepts a complete document", () => {
    const result = validateJobMeta(COMPLETE);
    expect(result).toHaveProperty("meta");
    if ("meta" in result) expect(result.meta).toEqual(COMPLETE);
  });

  it("accepts a partial document (drafts are allowed)", () => {
    const result = validateJobMeta({ client: "Acme" });
    expect(result).toHaveProperty("meta");
  });

  it("rejects bad enum values and malformed fields", () => {
    expect(validateJobMeta({ eventSize: "massive" })).toHaveProperty("error");
    expect(validateJobMeta({ touchups: "yes" })).toHaveProperty("error");
    expect(validateJobMeta({ services: ["nope"] })).toHaveProperty("error");
    expect(validateJobMeta({ services: "photo-booth" })).toHaveProperty("error");
    expect(validateJobMeta({ anonymize: "yes" })).toHaveProperty("error");
    expect(validateJobMeta({ year: 25 })).toHaveProperty("error");
    expect(validateJobMeta({ client: 7 })).toHaveProperty("error");
    expect(validateJobMeta(null)).toHaveProperty("error");
    expect(validateJobMeta([])).toHaveProperty("error");
  });
});

describe("completeness", () => {
  it("a complete job has no missing fields", () => {
    expect(jobMissingFields(COMPLETE)).toEqual([]);
    expect(isJobComplete(COMPLETE)).toBe(true);
  });

  it("lists required fields by human label", () => {
    expect(jobMissingFields(EMPTY_JOB_META)).toEqual([
      "client",
      "city",
      "services",
      "event size",
      "duration",
      "team size",
      "industry",
    ]);
  });

  it("requires alias when anonymized, and industry name when other", () => {
    expect(
      jobMissingFields({ ...COMPLETE, anonymize: true, alias: null })
    ).toContain("alias");
    expect(
      jobMissingFields({ ...COMPLETE, industry: "other", industryOther: null })
    ).toContain("industry name");
  });

  it("does not require the optional fields", () => {
    const meta = { ...COMPLETE, eventName: null, venue: null, ballpark: null, year: null };
    expect(isJobComplete(meta)).toBe(true);
  });
});

describe("serializeJob (anonymity contract)", () => {
  it("returns the client and a null alias when not anonymized", () => {
    const job = serializeJob("servicenow-knowledge-25", COMPLETE);
    expect(job.client).toBe("ServiceNow");
    expect(job.alias).toBeNull();
  });

  it("NEVER leaks the client name when anonymized", () => {
    const meta: JobMeta = {
      ...COMPLETE,
      anonymize: true,
      alias: "Fortune 100 tech company",
    };
    const job = serializeJob("a-job", meta);
    expect(job.client).toBeNull();
    expect(job.alias).toBe("Fortune 100 tech company");
    expect(JSON.stringify(job)).not.toContain("ServiceNow");
  });

  it("always returns touchups as a boolean (false when unset)", () => {
    // Legacy/partial stored docs have no touchups key — the API must say false.
    expect(serializeJob("x", parseJobMeta({ client: "Acme" })).touchups).toBe(false);
    expect(serializeJob("x", { ...COMPLETE, touchups: true }).touchups).toBe(true);
    expect(parseJobMeta({ touchups: "yes" }).touchups).toBe(false);
  });

  it("only serializes industryOther when industry is other", () => {
    const job = serializeJob("x", { ...COMPLETE, industryOther: "Stale" });
    expect(job.industryOther).toBeNull();
    const other = serializeJob("x", {
      ...COMPLETE,
      industry: "other",
      industryOther: "Food & beverage",
    });
    expect(other.industryOther).toBe("Food & beverage");
  });
});

describe("slugs", () => {
  it("derives clean slugs from section names", () => {
    expect(jobSlugFromName("ServiceNow Knowledge 25")).toBe("servicenow-knowledge-25");
    expect(jobSlugFromName("  Café & Crème!!  ")).toBe("cafe-and-creme");
    expect(jobSlugFromName("***")).toBe("job");
  });

  it("validates slug shape", () => {
    expect(isValidJobSlug("servicenow-knowledge-25")).toBe(true);
    expect(isValidJobSlug("-leading")).toBe(false);
    expect(isValidJobSlug("UPPER")).toBe(false);
    expect(isValidJobSlug("a--b")).toBe(false);
    expect(isValidJobSlug("")).toBe(false);
  });

  it("round-trips through the scene-key namespace", () => {
    expect(isJobSceneKey("job/acme-summit")).toBe(true);
    expect(isJobSceneKey("featured-work")).toBe(false);
    expect(isJobSceneKey(null)).toBe(false);
    expect(jobSlugFromKey("job/acme-summit")).toBe("acme-summit");
  });
});

describe("suggestions", () => {
  it("recognizes known brands regardless of punctuation/case", () => {
    expect(suggestIndustryForClient("Google")).toEqual({
      industry: "tech",
      industryOther: null,
    });
    expect(suggestIndustryForClient("Coca-Cola")).toEqual({
      industry: "other",
      industryOther: "Food & beverage",
    });
    expect(suggestIndustryForClient("Totally Unknown LLC")).toBeNull();
  });

  it("suggests the curated alias for known clients", () => {
    expect(suggestAlias({ ...COMPLETE, client: "ServiceNow" })).toBe(
      "Enterprise software company"
    );
  });

  it("composes from size + industry for unknown clients", () => {
    const meta = { ...COMPLETE, client: "Initech" };
    expect(suggestAlias(meta)).toBe("Enterprise tech client");
    expect(suggestAlias({ ...meta, eventSize: "500-2000" })).toBe(
      "Mid-size tech client"
    );
    expect(suggestAlias({ ...meta, eventSize: null })).toBe("Tech client");
    expect(
      suggestAlias({
        ...meta,
        industry: "other",
        industryOther: "Food & beverage",
      })
    ).toBe("Enterprise food & beverage client");
    expect(suggestAlias({ ...meta, eventSize: null, industry: null })).toBe(
      "Private client"
    );
  });
});
