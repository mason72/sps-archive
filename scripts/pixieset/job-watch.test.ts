/** npx tsx --test scripts/pixieset/job-watch.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { jobProblem } from "./job-watch";

const NOW = 1_800_000_000_000;
const base = { label: "job", logMtimeMs: NOW - 60_000, maxQuietMs: 7_200_000, nowMs: NOW };
const list = (status: number, pid?: number) => `{\n${pid ? `\t"PID" = ${pid};\n` : ""}\t"LastExitStatus" = ${status};\n};`;

test("a loaded job with a clean exit and a fresh log is fine", () => {
  assert.equal(jobProblem({ ...base, launchctl: list(0) }), null);
});
test("not loaded", () => {
  assert.match(jobProblem({ ...base, launchctl: null })!, /not loaded/);
});
test("a crash at startup: fresh log, bad exit", () => {
  assert.match(jobProblem({ ...base, launchctl: list(256) })!, /status 256/);
});
test("a bad previous exit does not count while a new run is going", () => {
  assert.equal(jobProblem({ ...base, launchctl: list(256, 123) }), null);
});
test("a hang: running, but the log stopped", () => {
  assert.match(jobProblem({ ...base, launchctl: list(0, 123), logMtimeMs: NOW - 3 * 3_600_000 })!, /quiet for 180 min/);
});
test("never wrote a log", () => {
  assert.match(jobProblem({ ...base, launchctl: list(0), logMtimeMs: null })!, /no log/);
});
