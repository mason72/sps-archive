import { describe, expect, it } from "vitest";
import { orderCrew } from "./CrewFaceTag";

const roster = ["Anna", "Ben", "Cara", "Dan", "Eve"].map((n) => ({ id: n.toLowerCase(), display_name: `${n} Smith` }));
const names = (rows: { display_name: string }[]) => rows.map((r) => r.display_name.split(" ")[0]);

describe("orderCrew", () => {
  it("leads with the job's crew, latest pick first, then recent off-job, then everyone else", () => {
    const o = orderCrew(roster, ["cara", "ben"], ["ben", "eve"], "");
    expect(names(o.onJob)).toEqual(["Ben", "Cara"]);
    expect(names(o.recentOff)).toEqual(["Eve"]);
    expect(names(o.rest)).toEqual(["Anna", "Dan"]);
  });

  it("lists nobody twice", () => {
    const o = orderCrew(roster, ["ben"], ["ben"], "");
    const all = [...o.onJob, ...o.recentOff, ...o.rest].map((r) => r.id);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(roster.length);
  });

  it("typing searches the whole roster and drops the shortcuts", () => {
    const o = orderCrew(roster, ["cara"], ["ben"], "  da ");
    expect(o.onJob).toEqual([]);
    expect(o.recentOff).toEqual([]);
    expect(names(o.rest)).toEqual(["Dan"]);
  });

  it("drops ids that are no longer on the roster", () => {
    const o = orderCrew(roster, ["gone"], ["also-gone", "anna"], "");
    expect(o.onJob).toEqual([]);
    expect(names(o.recentOff)).toEqual(["Anna"]);
  });

  it("with no job and no history it is just the roster", () => {
    const o = orderCrew(roster, [], [], "");
    expect(o.onJob).toEqual([]);
    expect(o.recentOff).toEqual([]);
    expect(o.rest).toHaveLength(5);
  });
});
