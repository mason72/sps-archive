import { describe, it, expect } from "vitest";
import { readHeadshotReference, MIN_REFERENCE_PHOTOS } from "./headshot-reference";
import { EMBEDDING_DIM } from "./direction";

/* A stand-in for the Supabase builder: canned answers per table, every filter
   recorded, so the test can assert what the reader ASKED for. */
function fakeDb(answers: Record<string, unknown[]>) {
  const calls: { table: string; filters: unknown[] }[] = [];
  return {
    calls,
    db: {
      from(table: string) {
        const filters: unknown[] = [];
        calls.push({ table, filters });
        const done = () => Promise.resolve({ data: answers[table] ?? [], error: null });
        const b: Record<string, unknown> = {
          select: (cols: string) => (filters.push(["select", cols]), b),
          eq: (c: string, v: unknown) => (filters.push(["eq", c, v]), b),
          in: (c: string, v: unknown) => (filters.push(["in", c, v]), b),
          not: () => b,
          order: () => b,
          range: () => done(),
          maybeSingle: () => Promise.resolve({ data: (answers[table] ?? [])[0] ?? null, error: null }),
          then: (res: (v: unknown) => void) => done().then(res),
        };
        return b;
      },
    } as never,
  };
}

const vec = (i: number) => `[${Array.from({ length: EMBEDDING_DIM }, (_, k) => (k === i ? 1 : 0)).join(",")}]`;

describe("readHeadshotReference", () => {
  it("is scoped to the owner at the website gallery AND at every photo read", async () => {
    const images = Array.from({ length: MIN_REFERENCE_PHOTOS }, (_, i) => ({ id: `i${i}`, siglip_embedding: vec(i) }));
    const { db, calls } = fakeDb({
      events: [{ id: "site" }],
      sections: [{ id: "s1" }],
      section_images: images.map((im) => ({ section_id: "s1", image_id: im.id })),
      images,
    });
    const ref = await readHeadshotReference(db, "owner-A", new Set(["siglip2"]));
    expect(ref).not.toBeNull();
    expect(calls.find((c) => c.table === "events")!.filters).toContainEqual(["eq", "user_id", "owner-A"]);
    const imageCall = calls.find((c) => c.table === "images")!;
    expect(imageCall.filters).toContainEqual(["eq", "events.user_id", "owner-A"]);
    expect(imageCall.filters).toContainEqual(["in", "embedding_model", ["siglip2"]]);
  });

  it("an owner with no website gallery gets no reference (the learned path is used)", async () => {
    const { db } = fakeDb({ events: [] });
    expect(await readHeadshotReference(db, "owner-B", new Set())).toBeNull();
  });

  it("too few reference photos is no reference", async () => {
    const images = Array.from({ length: MIN_REFERENCE_PHOTOS - 1 }, (_, i) => ({ id: `i${i}`, siglip_embedding: vec(i) }));
    const { db } = fakeDb({
      events: [{ id: "site" }],
      sections: [{ id: "s1" }],
      section_images: images.map((im) => ({ section_id: "s1", image_id: im.id })),
      images,
    });
    expect(await readHeadshotReference(db, "owner-C", new Set())).toBeNull();
  });
});
