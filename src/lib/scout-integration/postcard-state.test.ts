import { describe, it, expect } from "vitest";
import { parseFilename } from "@/lib/upload/parse-filename";
import { NON_PERSON_GALLERIES, looksLikePersonName } from "@/lib/people/index-people";
import { SCOUT_ROAD_NAME } from "./validate";
import {
  claimOutcome,
  ingestDecision,
  postcardFilename,
  postcardStatus,
  type PostcardLink,
} from "./postcard-state";

const link: PostcardLink = {
  postcard_id: "3f2a9c1e-0b7d-4e7a-9a51-2c4d6e8f0a1b",
  image_id: "img-1",
  event_id: "ev-1",
  section_id: "sec-1",
  gig_id: "gig-1",
  author_email: null,
  created_at: "2026-11-23T00:00:00Z",
  published_target: null,
  published_at: null,
};

describe("idempotency", () => {
  it("returns an existing link as the answer, and ingests only when there is none", () => {
    expect(ingestDecision(link)).toEqual({ action: "return-existing", link });
    expect(ingestDecision(null)).toEqual({ action: "ingest" });
  });

  it("treats a unique violation on the claim as a lost race, anything else as an error", () => {
    expect(claimOutcome(null)).toBe("won");
    expect(claimOutcome({ code: "23505" })).toBe("lost");
    expect(claimOutcome({ code: "23503" })).toBe("error"); // FK: the image row vanished
    expect(claimOutcome({ code: null })).toBe("error");
    expect(claimOutcome({})).toBe("error");
  });
});

describe("postcardStatus", () => {
  const row = (over: Partial<Parameters<typeof postcardStatus>[0]>) => ({
    processing_status: "complete",
    ai_indexed_at: null,
    ai_index_attempts: 0,
    ...over,
  });
  it("reads the three states", () => {
    expect(postcardStatus(row({ processing_status: "pending" }))).toBe("processing");
    expect(postcardStatus(row({}))).toBe("processing");
    expect(postcardStatus(row({ ai_index_attempts: 2 }))).toBe("processing");
    expect(postcardStatus(row({ ai_indexed_at: "2026-11-23T01:00:00Z" }))).toBe("ready");
    expect(postcardStatus(row({ processing_status: "failed" }))).toBe("failed");
    expect(postcardStatus(row({ ai_index_attempts: 3 }))).toBe("failed"); // the lane gave up
  });
});

describe("postcardFilename", () => {
  it("carries no person name for /people to read", () => {
    const name = postcardFilename(link.postcard_id);
    expect(name).toBe(`scout-postcard-${link.postcard_id}.jpg`);
    // The parser reads words out of it, but no reader takes them for a person
    // (digits), and the row stores parsed_name null regardless.
    expect(looksLikePersonName(parseFilename(name).name ?? "")).toBe(false);
  });

  it("files postcards in a gallery /people and the namer skip", () => {
    expect(NON_PERSON_GALLERIES.has(SCOUT_ROAD_NAME)).toBe(true);
  });
});
