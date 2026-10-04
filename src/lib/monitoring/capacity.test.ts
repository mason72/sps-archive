import { describe, expect, it } from "vitest";
import {
  assessCapacity,
  computeSizeFor,
  findingsToAlert,
  type BacklogReading,
  type CapacityReading,
  type Finding,
} from "./capacity";

const MB = 1024 ** 2;
const GB = 1024 ** 3;
const NOW = new Date("2026-10-04T18:00:00Z");

/** A healthy Medium database. Each test bends one number. */
const healthy: CapacityReading = {
  db_bytes: 10 * GB,
  shared_buffers_bytes: 1024 * MB,
  effective_cache_bytes: 3072 * MB,
  max_connections: 120,
  connections: 12,
  vector_index_bytes: 700 * MB,
  timeouts_6h: 1,
  timeout_contexts_6h: { "api/stats": 1 },
  sweep_failures_2h: 0,
};

const quietBacklog: BacklogReading = {
  backlog_photos: 0,
  backlog_events: 0,
  indexed_24h: 4000,
  newest_indexed_at: "2026-10-04T17:50:00Z",
};

const keys = (findings: Finding[]) => findings.map((f) => `${f.key}:${f.severity}`);
const assess = (capacity: CapacityReading | null, backlog: BacklogReading | null, errors: string[] = []) =>
  assessCapacity({ capacity, backlog, errors }, { now: NOW });

describe("computeSizeFor", () => {
  it("reads the compute size from shared_buffers (a quarter of memory)", () => {
    expect(computeSizeFor(256 * MB).name).toBe("Micro"); // measured 2026-10-04
    expect(computeSizeFor(1024 * MB).name).toBe("Medium"); // measured 2026-10-04
    expect(computeSizeFor(2048 * MB).name).toBe("Large");
  });
});

describe("assessCapacity", () => {
  it("says nothing about a healthy database", () => {
    expect(assess(healthy, quietBacklog)).toEqual([]);
  });

  it("reproduces the 2026-10-04 incident from its real readings", () => {
    // Micro, measured that morning: 691 MB of vector indexes on 768 MB of
    // cache, 9.9 GB of data, ~125 timeouts per 6 hours, a dead sweep, and a
    // 471,923-photo backlog moving ~11,000 a day.
    const incident: CapacityReading = {
      db_bytes: 9.9 * GB,
      shared_buffers_bytes: 256 * MB,
      effective_cache_bytes: 768 * MB,
      max_connections: 60,
      connections: 26,
      vector_index_bytes: 691 * MB,
      timeouts_6h: 127,
      timeout_contexts_6h: { "ai-index": 115, "inngest.ai-index-sweep": 12 },
      sweep_failures_2h: 4,
    };
    const backlog: BacklogReading = {
      backlog_photos: 471923,
      backlog_events: 333,
      indexed_24h: 11152,
      newest_indexed_at: "2026-10-04T17:59:00Z",
    };
    const findings = assess(incident, backlog);
    expect(keys(findings)).toEqual([
      "vector-memory:critical",
      "db-size:critical",
      "timeouts:critical",
      "sweep-failing:critical",
      "ai-backlog:warn",
    ]);
    // The action names the next size up and what it costs.
    expect(findings[0].action).toContain("Micro to Small");
    expect(findings[4].headline).toContain("42 days");
  });

  it("warns before the vector indexes outgrow memory, and names the next size", () => {
    const f = assess({ ...healthy, vector_index_bytes: 1700 * MB }, quietBacklog);
    expect(keys(f)).toEqual(["vector-memory:warn"]);
    expect(f[0].action).toContain("Medium to Large");
    expect(f[0].action).toContain("$110");
  });

  it("recommends the size that clears the numbers, not just the next one", () => {
    // 3 GB of vector indexes: Large (6 GB cache) would sit at exactly the warn
    // line, so the recommendation skips it.
    const f = assess({ ...healthy, vector_index_bytes: 3072 * MB }, quietBacklog);
    expect(keys(f)).toEqual(["vector-memory:critical"]);
    expect(f[0].action).toContain("Medium to XL");
  });

  it("flags a database too slow to read as critical, with the reason", () => {
    const f = assess(null, quietBacklog, ["capacity_snapshot: statement timeout"]);
    expect(keys(f)).toEqual(["unreadable:critical"]);
    expect(f[0].detail).toContain("statement timeout");
  });

  it("keeps reporting capacity when only the backlog count fails", () => {
    const f = assess({ ...healthy, timeouts_6h: 60 }, null, ["ai_backlog_snapshot: timeout"]);
    expect(keys(f)).toEqual(["timeouts:critical", "backlog-unreadable:warn"]);
  });

  it("calls a stopped lane stalled only when work has waited the whole time", () => {
    const idle = { ...quietBacklog, newest_indexed_at: "2026-10-04T10:00:00Z" };
    const waiting = { ...idle, backlog_photos: 7104, backlog_events: 1 };
    const at = (backlog: BacklogReading, earlier: number | null) =>
      keys(
        assessCapacity(
          { capacity: healthy, backlog, errors: [] },
          { now: NOW, earlierBacklogPhotos: earlier }
        )
      );
    // A few stray videos or given-up photos are not a backlog.
    expect(at({ ...idle, backlog_photos: 40, backlog_events: 3 }, 40)).toEqual([]);
    // The busy-morning case: lane idle overnight, an upload began 20 minutes
    // ago, nothing was waiting three hours ago. Not stalled.
    expect(at(waiting, 0)).toEqual([]);
    // No reading that old yet (first hours after deploy): not claimed.
    expect(at(waiting, null)).toEqual([]);
    // The same photos were already waiting three hours ago: stalled.
    expect(at(waiting, 7104)).toEqual(["ai-stalled:critical"]);
  });

  it("does not call the lane stalled when the kill switch is off", () => {
    const stopped = {
      capacity: healthy,
      backlog: { ...quietBacklog, backlog_photos: 7104, newest_indexed_at: "2026-10-01T00:00:00Z" },
      errors: [],
    };
    expect(
      assessCapacity(stopped, { now: NOW, aiEnabled: false, earlierBacklogPhotos: 7104 })
    ).toEqual([]);
  });

  it("says so when its own history cannot be read, instead of going quiet", () => {
    const f = assessCapacity(
      { capacity: healthy, backlog: quietBacklog, errors: [] },
      { now: NOW, historyError: "capacity_snapshots: statement timeout" }
    );
    expect(keys(f)).toEqual(["history-unreadable:warn"]);
  });

  it("does not flag a big backlog that is clearing within the week", () => {
    const f = assess(healthy, {
      backlog_photos: 300_000,
      backlog_events: 200,
      indexed_24h: 70_000,
      newest_indexed_at: "2026-10-04T17:59:00Z",
    });
    expect(f).toEqual([]);
  });
});

describe("findingsToAlert", () => {
  const f = (key: string, severity: "warn" | "critical"): Finding => ({
    key,
    severity,
    headline: key,
    detail: "",
    action: "",
  });

  it("sends a finding that has not been alerted", () => {
    expect(findingsToAlert([f("db-size", "warn")], new Map())).toHaveLength(1);
  });

  it("stays quiet about one already alerted at the same or higher severity", () => {
    expect(findingsToAlert([f("db-size", "warn")], new Map([["db-size", "warn"]]))).toEqual([]);
    expect(findingsToAlert([f("db-size", "warn")], new Map([["db-size", "critical"]]))).toEqual([]);
    expect(findingsToAlert([f("db-size", "critical")], new Map([["db-size", "critical"]]))).toEqual([]);
  });

  it("sends again when a warning becomes critical", () => {
    expect(findingsToAlert([f("db-size", "critical")], new Map([["db-size", "warn"]]))).toHaveLength(1);
  });
});
