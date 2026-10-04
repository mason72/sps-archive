import { describe, it, expect } from "vitest";
import { importHeading, isSettledStatus } from "./import-heading";

/**
 * One page serves an import that is running and one that finished a month
 * ago. The words over it have to follow the job, or a finished import reads
 * as one still in flight (which it did until 2026-10-04).
 */
describe("importHeading", () => {
  const base = { name: "Summit Headshots", finishedOn: "Oct 4, 2026" };

  it("a finished import says so, names the event and gives the date", () => {
    expect(importHeading({ ...base, status: "completed" })).toEqual({
      title: "Import finished",
      caption: "Summit Headshots · finished Oct 4, 2026",
    });
  });

  it("a finished import never promises it is still going", () => {
    const { title, caption } = importHeading({ ...base, status: "completed" });
    expect(`${title} ${caption}`).not.toMatch(/pulling|keeps going|copied a page/i);
  });

  it("degrades without a name or a date, and never prints a stray separator", () => {
    expect(importHeading({ status: "completed", name: null, finishedOn: "Oct 4, 2026" }).caption).toBe(
      "finished Oct 4, 2026"
    );
    expect(importHeading({ status: "completed", name: "  ", finishedOn: null }).caption).toBe(
      "The camera files are in the archive."
    );
    expect(importHeading({ status: "completed", name: "Summit", finishedOn: null }).caption).toBe("Summit");
  });

  it("a stopped or failed import is 'stopped', with the event's name", () => {
    for (const status of ["cancelled", "failed"]) {
      expect(importHeading({ ...base, status })).toEqual({
        title: "Import stopped",
        caption: "Summit Headshots",
      });
    }
  });

  it("an import in flight, or one not heard from yet, is being pulled", () => {
    for (const status of ["queued", "running", null]) {
      const heading = importHeading({ ...base, status });
      expect(heading.title).toBe("Pulling camera files");
      expect(heading.caption).toMatch(/You can leave this screen/);
    }
  });
});

describe("isSettledStatus", () => {
  it("separates a job that is over from one that is starting", () => {
    expect(["completed", "cancelled", "failed"].map(isSettledStatus)).toEqual([true, true, true]);
    expect(["queued", "running", null, undefined].map(isSettledStatus)).toEqual([false, false, false, false]);
  });
});
