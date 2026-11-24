import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFilename } from "@/lib/upload/parse-filename";
import { looksLikePersonName } from "@/lib/people/index-people";
import { postcardFilename } from "./postcard-state";
import { buildStacks } from "@/lib/gallery/stacks";

/**
 * A crew BTS copy in a client's gallery (`images.is_crew_bts`) is shown and
 * downloaded, but must never be read as one of the client's photos. These are
 * the readers that exclude it explicitly, with the number of image queries in
 * each that must carry `.eq("is_crew_bts", false)`. Removing a filter (or
 * adding a query to one of these readers without it) turns this red.
 *
 * Excluded BY CONSTRUCTION, and so not listed: anything driven by faces or
 * embeddings (face clustering itself, selfie search, identity scan, smart
 * sections, scene embeddings, Highlights picks), because the copy is inserted
 * with `ai_indexed_at` set and never gets either; and the AI queue RPCs, which
 * count only rows with `ai_indexed_at` null.
 *
 * Deliberately INCLUDED (the client must see and download it): the guest
 * gallery and preview, share scope, favorites, ZIP and single downloads.
 */
const EXCLUDING_READERS: Record<string, number> = {
  "src/lib/ai-index/index-event.ts": 2, // the batch select and its remaining-count twin
  "src/lib/people/index-people.ts": 3, // /people: wall, extra ids, one event's detail
  "src/lib/faces/cluster-event.ts": 1, // face-cluster naming frames
  "src/lib/highlights/propose.ts": 2, // Highlights pool and its indexed count
  "src/lib/cover/pool.ts": 1, // the event's mosaic cover pool
  "src/lib/recap/payload.ts": 1, // the delivery recap's photo count
  "src/app/api/events/[eventId]/auto-sections/route.ts": 1, // Sort into sections / Rebuild
  "src/app/api/events/[eventId]/section-plan/route.ts": 1, // the Rebuild preview
  "src/app/api/events/[eventId]/scene-plan/route.ts": 1, // scene planner population
};

const root = join(__dirname, "../../..");
const FILTER = /\.eq\("is_crew_bts",\s*false\)/g;

describe("crew BTS copies are excluded from the client's photo readers", () => {
  for (const [file, expected] of Object.entries(EXCLUDING_READERS)) {
    it(`${file} filters is_crew_bts in ${expected} quer${expected === 1 ? "y" : "ies"}`, () => {
      const src = readFileSync(join(root, file), "utf8");
      expect(src.match(FILTER)?.length ?? 0).toBe(expected);
    });
  }

  it("the copy's filename can never become a person on /people or join a person stack", () => {
    for (const kind of ["photo", "video"] as const) {
      const name = parseFilename(postcardFilename("3f2a9c1e-0b7d-4e7a-9a51-2c4d6e8f0a1b", kind)).name;
      expect(looksLikePersonName(name ?? "")).toBe(false);
    }
    // Two copies beside a guest's photos: every copy stays a singleton (which
    // renders as a plain card) and no guest stack gains a crew photo.
    const imgs = [
      { parsedName: "Jane Doe", originalFilename: "Jane Doe 01.jpg" },
      { parsedName: "Jane Doe", originalFilename: "Jane Doe 02.jpg" },
      { parsedName: null, originalFilename: postcardFilename("3f2a9c1e-0b7d-4e7a-9a51-2c4d6e8f0a1b") },
      { parsedName: null, originalFilename: postcardFilename("4f2a9c1e-0b7d-4e7a-9a51-2c4d6e8f0a1b") },
    ];
    expect(buildStacks(imgs).map((s) => s.images.length)).toEqual([2, 1, 1]);
  });
});
