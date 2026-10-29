import { describe, expect, it } from "vitest";
import { payerDomains } from "./apply-gig";

describe("payerDomains", () => {
  it("drops our own and consumer mail domains", () => {
    expect(
      payerDomains([
        "info@twodudesphoto.com",
        "a@gmail.com",
        "b@yahoo.co.uk",
        "c@me.com",
        "d@att.net",
        "e@outlook.com",
      ])
    ).toEqual([]);
  });

  it("keeps a client whose domain merely CONTAINS one of those (the old substring bug)", () => {
    expect(payerDomains(["x@acme.com", "y@chime.com", "z@matt.net", "w@outlookgroup.com"])).toEqual([
      "acme.com",
      "chime.com",
      "matt.net",
      "outlookgroup.com",
    ]);
  });

  it("is distinct and lower-cased", () => {
    expect(payerDomains(["A@Docusign.com", "b@docusign.com"])).toEqual(["docusign.com"]);
  });
});

/**
 * A table-backed stand-in for the Supabase client: enough of the builder for
 * applyGigIntel's venue and client legs, and it records every write.
 */
function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  const writes: { table: string; row: Record<string, unknown> }[] = [];
  const from = (table: string) => {
    const filters: ((r: Record<string, unknown>) => boolean)[] = [];
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const b = {
      select: () => b,
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
      in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b; },
      contains: (c: string, vs: unknown[]) => { filters.push((r) => vs.every((v) => (r[c] as unknown[] | undefined)?.includes(v))); return b; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      upsert: async (row: Record<string, unknown>) => { writes.push({ table, row }); return { error: null }; },
      then: (ok: (v: { data: Record<string, unknown>[]; error: null }) => unknown) => ok({ data: rows(), error: null }),
    };
    return b;
  };
  return { db: { from } as never, writes };
}

describe("applyGigIntel: venue and clients picked on the card (2026-10-29)", () => {
  const tables = {
    venues: [
      { id: "00000000-0000-4000-8000-0000000000a1", user_id: "me", name: "Caesars Forum", city: "Las Vegas" },
      { id: "00000000-0000-4000-8000-0000000000a2", user_id: "someone-else", name: "Elsewhere", city: null },
    ],
    organizations: [
      { id: "00000000-0000-4000-8000-0000000000b1", user_id: "me", name: "Guidewire", domains: [] },
      { id: "00000000-0000-4000-8000-0000000000b2", user_id: "someone-else", name: "Not yours", domains: [] },
    ],
  };

  it("links a picked venue and picked clients the account owns", async () => {
    const { applyGigIntel } = await import("./apply-gig");
    const { db, writes } = fakeDb(tables);
    const r = await applyGigIntel(db, {
      userId: "me", eventId: "e1", confirmed: true, venueId: "00000000-0000-4000-8000-0000000000a1", orgIds: ["00000000-0000-4000-8000-0000000000b1", "00000000-0000-4000-8000-0000000000b1"],
    });
    expect(r.venueId).toBe("00000000-0000-4000-8000-0000000000a1");
    expect(writes.find((w) => w.table === "event_intel")?.row.venue_id).toBe("00000000-0000-4000-8000-0000000000a1");
    expect(writes.filter((w) => w.table === "event_orgs").map((w) => w.row.org_id)).toEqual(["00000000-0000-4000-8000-0000000000b1"]);
    expect(r.warnings).toEqual([]);
  });

  it("refuses ids from another account, and says so", async () => {
    const { applyGigIntel } = await import("./apply-gig");
    const { db, writes } = fakeDb(tables);
    const r = await applyGigIntel(db, {
      userId: "me", eventId: "e1", confirmed: true, venueId: "00000000-0000-4000-8000-0000000000a2", orgIds: ["00000000-0000-4000-8000-0000000000b2"],
    });
    expect(r.venueId).toBeNull();
    expect(writes.find((w) => w.table === "event_intel")?.row.venue_id).toBeUndefined();
    expect(writes.some((w) => w.table === "event_orgs")).toBe(false);
    expect(r.warnings).toHaveLength(2);
  });
  it("drops a malformed client id instead of letting it sink the good ones", async () => {
    const { applyGigIntel } = await import("./apply-gig");
    const { db, writes } = fakeDb(tables);
    await applyGigIntel(db, {
      userId: "me", eventId: "e1", confirmed: true, orgIds: ["not-a-uuid", "00000000-0000-4000-8000-0000000000b1"],
    });
    expect(writes.filter((w) => w.table === "event_orgs").map((w) => w.row.org_id)).toEqual(["00000000-0000-4000-8000-0000000000b1"]);
  });
});
