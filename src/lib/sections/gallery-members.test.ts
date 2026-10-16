import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  coverUploadIdsAmong,
  eventCoverUploadIds,
  loadSectionLinks,
} from "./gallery-members";

/**
 * A minimal stand-in for the Supabase query builder: every chained call
 * returns the builder, `range`/`in`/`eq` record what was asked, and awaiting
 * it answers from `respond`. Enough to drive paging and error paths without a
 * database.
 */
function fakeClient(
  respond: (
    table: string,
    call: { range?: [number, number]; inValues?: string[]; eqs?: [string, unknown][] }
  ) => {
    data: unknown[] | null;
    error: unknown;
  }
) {
  type Call = { table: string; range?: [number, number]; inValues?: string[]; eqs?: [string, unknown][] };
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, eqs: [] };
      calls.push(call);
      const builder = {
        select: () => builder,
        eq: (col: string, value: unknown) => {
          call.eqs!.push([col, value]);
          return builder;
        },
        order: () => builder,
        in: (_col: string, values: string[]) => {
          call.inValues = values;
          return builder;
        },
        range: (from: number, to: number) => {
          call.range = [from, to];
          return builder;
        },
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(respond(table, call)).then(resolve, reject),
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const link = (s: string, i: string) => ({ section_id: s, image_id: i });

describe("loadSectionLinks", () => {
  it("pages past the 1000-row cap until a short page", async () => {
    const full = Array.from({ length: 1000 }, (_, k) => link("s1", `a${k}`));
    const { client, calls } = fakeClient((_t, call) => ({
      data: call.range?.[0] === 0 ? full : [link("s1", "last")],
      error: null,
    }));
    const links = await loadSectionLinks(client, ["s1"]);
    expect(links).toHaveLength(1001);
    expect(calls.map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("THROWS on a failed page instead of returning what it had", async () => {
    // The whole point: a short membership set hides real photos from a
    // client's gallery. A version that breaks out of the loop on error (as the
    // routes' old inline readers did) must fail this test.
    const full = Array.from({ length: 1000 }, (_, k) => link("s1", `a${k}`));
    const { client } = fakeClient((_t, call) =>
      call.range?.[0] === 0
        ? { data: full, error: null }
        : { data: null, error: { message: "statement timeout" } }
    );
    await expect(loadSectionLinks(client, ["s1"])).rejects.toEqual({
      message: "statement timeout",
    });
  });

  it("asks nothing when there are no sections", async () => {
    const { client, calls } = fakeClient(() => ({ data: [], error: null }));
    expect(await loadSectionLinks(client, [])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("eventCoverUploadIds", () => {
  it("asks for this event's MARKED cover uploads, not rows missing a section", async () => {
    const { client, calls } = fakeClient(() => ({ data: [{ id: "logo-1" }], error: null }));
    expect([...(await eventCoverUploadIds(client, "e1"))]).toEqual(["logo-1"]);
    expect(calls[0].table).toBe("images");
    expect(calls[0].eqs).toEqual([
      ["event_id", "e1"],
      ["is_cover_upload", true],
    ]);
  });

  it("throws on a failed read", async () => {
    const { client } = fakeClient(() => ({ data: null, error: { message: "boom" } }));
    await expect(eventCoverUploadIds(client, "e1")).rejects.toEqual({ message: "boom" });
  });
});

describe("coverUploadIdsAmong", () => {
  it("chunks the id list and throws on a failed chunk", async () => {
    const ids = Array.from({ length: 250 }, (_, k) => `i${k}`);
    const { client, calls } = fakeClient((_t, call) =>
      call.inValues?.[0] === "i200"
        ? { data: null, error: { message: "bad chunk" } }
        : { data: [{ id: "i0" }], error: null }
    );
    await expect(coverUploadIdsAmong(client, ids)).rejects.toEqual({ message: "bad chunk" });
    expect(calls.map((c) => c.inValues?.length)).toEqual([200, 50]);
  });

  it("returns only the marked ids", async () => {
    const { client, calls } = fakeClient(() => ({ data: [{ id: "logo-1" }], error: null }));
    expect([...(await coverUploadIdsAmong(client, ["a", "logo-1", "a"]))]).toEqual(["logo-1"]);
    expect(calls[0].inValues).toEqual(["a", "logo-1"]);
    expect(calls[0].eqs).toEqual([["is_cover_upload", true]]);
  });
});
