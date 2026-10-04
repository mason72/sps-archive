/**
 * Capacity check: is the database still big enough for the archive, and is the
 * AI lane keeping up? Runs hourly (Inngest `capacity-check`), by hand through
 * `scripts/capacity-check.ts`, and stores every reading in `capacity_snapshots`.
 *
 * Why it exists (lesson 175, 2026-10-04). The archive outgrew its database
 * machine and nothing said so. The compute size was Micro (1 GB); the two HNSW
 * indexes reached 691 MB against 768 MB of cacheable memory, face inserts went
 * to disk, and indexing fell from ~90,000 photos a day to ~10,000 while the
 * backlog grew to 471,923. The error alarm worked exactly as built: it sent 93
 * emails in 48 hours, every one of them "ai-index failing: statement timeout".
 * A symptom repeated 93 times is noise. Nobody was told the one thing that
 * mattered, which is "resize the database", until a gallery sat at Queued for
 * a day and Mason asked why.
 *
 * So this reads CAUSES, not symptoms, and each finding carries its action:
 *   - how full the machine is (vector indexes against memory, data against the
 *     size Supabase recommends for the compute size, connections),
 *   - whether the database is cancelling queries,
 *   - whether the AI lane is alive and gaining on its backlog.
 *
 * What it cannot see: DISK. Free disk space is not readable from SQL, and the
 * app holds no Supabase management token. Supabase grows the disk by itself at
 * 90% full on the Pro plan (it went 8 to 12 GB that way), so disk is the one
 * limit here that already scales without a person.
 */
import type { createServiceClient } from "@/lib/supabase/server";

type SupabaseDB = ReturnType<typeof createServiceClient>;

const GB = 1024 ** 3;
const MB = 1024 ** 2;

/**
 * Supabase compute sizes, from supabase.com/docs/guides/platform/compute-and-disk
 * (read 2026-10-04; prices also confirmed against this project's own
 * /billing/addons listing that day). Memory is what decides which one the
 * database is on: shared_buffers is a quarter of it (measured: Micro 256 MB,
 * Medium 1,024 MB).
 */
export const COMPUTE_SIZES = [
  { name: "Micro", ramGb: 1, maxDbGb: 10, monthlyUsd: 10 },
  { name: "Small", ramGb: 2, maxDbGb: 50, monthlyUsd: 15 },
  { name: "Medium", ramGb: 4, maxDbGb: 100, monthlyUsd: 60 },
  { name: "Large", ramGb: 8, maxDbGb: 200, monthlyUsd: 110 },
  { name: "XL", ramGb: 16, maxDbGb: 500, monthlyUsd: 210 },
  { name: "2XL", ramGb: 32, maxDbGb: 1000, monthlyUsd: 410 },
] as const;

export type ComputeSize = (typeof COMPUTE_SIZES)[number];

/**
 * Thresholds. Judgment calls with ONE calibration point each, stated so the
 * next person can move them on evidence:
 *
 *   vector memory: the collapse was measured at 90% (691 MB of indexes on 768
 *     MB of cache). Where it BEGAN was not measured, so warn sits well below.
 *   db size: Supabase's own recommended ceiling per compute size.
 *   timeouts: an ordinary 6 hours has 0 to 3; the incident ran at ~125.
 *   backlog: the lane clears a normal shoot in under an hour, so a week of
 *     work waiting means the lane has lost to its inflow.
 */
export const THRESHOLDS = {
  vectorMemoryWarn: 0.5,
  vectorMemoryCritical: 0.75,
  dbSizeWarn: 0.7,
  dbSizeCritical: 0.9,
  timeoutsWarn: 10,
  timeoutsCritical: 50,
  sweepFailuresCritical: 2,
  connectionsWarn: 0.8,
  /** Below this the "backlog" is stray videos and given-up photos, not work. */
  backlogFloorPhotos: 500,
  backlogStalledHours: 3,
  backlogSlowPhotos: 20_000,
  backlogSlowDays: 7,
} as const;

export interface CapacityReading {
  db_bytes: number;
  shared_buffers_bytes: number;
  effective_cache_bytes: number;
  max_connections: number;
  connections: number;
  vector_index_bytes: number;
  timeouts_6h: number;
  timeout_contexts_6h: Record<string, number>;
  sweep_failures_2h: number;
}

export interface BacklogReading {
  backlog_photos: number;
  backlog_events: number;
  indexed_24h: number;
  newest_indexed_at: string | null;
}

export interface CapacitySnapshot {
  capacity: CapacityReading | null;
  backlog: BacklogReading | null;
  /** Why a reading is missing. A reading that could not be taken is a finding. */
  errors: string[];
}

export type Severity = "warn" | "critical";

export interface Finding {
  /** Stable id; the alert ledger and throttle key on it. */
  key: string;
  severity: Severity;
  /** One line, plain language. */
  headline: string;
  /** The numbers behind it. */
  detail: string;
  /** What to do about it. */
  action: string;
}

/** The compute size whose memory matches the database's shared_buffers. */
export function computeSizeFor(sharedBuffersBytes: number): ComputeSize {
  const ramGb = (sharedBuffersBytes * 4) / GB;
  let best: ComputeSize = COMPUTE_SIZES[0];
  for (const size of COMPUTE_SIZES) {
    if (Math.abs(size.ramGb - ramGb) < Math.abs(best.ramGb - ramGb)) best = size;
  }
  return best;
}

/**
 * The smallest size on which this reading would be back under every warn
 * threshold, and always at least one step up. It clears today's numbers only:
 * how much growth to buy on top is a judgment for the person reading the alert.
 */
export function recommendedSize(reading: CapacityReading): ComputeSize | null {
  const current = computeSizeFor(reading.shared_buffers_bytes);
  const from = COMPUTE_SIZES.findIndex((s) => s.name === current.name) + 1;
  const larger = COMPUTE_SIZES.slice(from);
  if (!larger.length) return null;
  const fits = larger.find((s) => {
    // effective_cache_size is three quarters of memory (measured on Micro and Medium).
    const cacheBytes = s.ramGb * GB * 0.75;
    return (
      reading.vector_index_bytes < cacheBytes * THRESHOLDS.vectorMemoryWarn &&
      reading.db_bytes < s.maxDbGb * GB * THRESHOLDS.dbSizeWarn
    );
  });
  return fits ?? larger[larger.length - 1];
}

function resizeAction(reading: CapacityReading): string {
  const size = computeSizeFor(reading.shared_buffers_bytes);
  const next = recommendedSize(reading);
  if (!next) return `Already on ${size.name}, the largest size listed here. This needs a real look.`;
  return (
    `Move the database from ${size.name} to ${next.name} ` +
    `(${next.ramGb} GB memory, about $${next.monthlyUsd}/month instead of $${size.monthlyUsd}). ` +
    `That is the smallest size that clears today's numbers; growth is extra. ` +
    `It is a restart of under two minutes, and it can be stepped back down.`
  );
}

const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;
const mb = (bytes: number) => `${Math.round(bytes / MB).toLocaleString("en-US")} MB`;
const gb = (bytes: number) => `${(bytes / GB).toFixed(1)} GB`;
const n = (v: number) => Math.round(v).toLocaleString("en-US");

export interface AssessOptions {
  now?: Date;
  /** False when the AI kill switch is off: a stopped lane is then deliberate. */
  aiEnabled?: boolean;
  /**
   * Photos that were waiting at the check about `backlogStalledHours` ago, or
   * null when there is no reading that old. "Stalled" needs it: see ai-stalled.
   */
  earlierBacklogPhotos?: number | null;
  /** Set when the stored readings could not be read at all. */
  historyError?: string | null;
}

/** Turn one reading into the list of things worth telling a person. Pure. */
export function assessCapacity(
  snapshot: CapacitySnapshot,
  options: AssessOptions = {}
): Finding[] {
  const now = options.now ?? new Date();
  const aiEnabled = options.aiEnabled ?? true;
  const findings: Finding[] = [];
  const { capacity, backlog } = snapshot;
  const T = THRESHOLDS;

  if (!capacity) {
    findings.push({
      key: "unreadable",
      severity: "critical",
      headline: "The capacity check could not read the database",
      detail: snapshot.errors.join(" | ") || "no reading returned",
      action:
        "A catalog query that normally takes milliseconds failed. Check database health first; " +
        "a database too slow to answer this is usually out of memory or frozen.",
    });
  } else {
    const size = computeSizeFor(capacity.shared_buffers_bytes);

    const vectorRatio = capacity.vector_index_bytes / Math.max(1, capacity.effective_cache_bytes);
    if (vectorRatio >= T.vectorMemoryWarn) {
      const critical = vectorRatio >= T.vectorMemoryCritical;
      findings.push({
        key: "vector-memory",
        severity: critical ? "critical" : "warn",
        headline: critical
          ? "The face and search indexes no longer fit in the database's memory"
          : "The face and search indexes are filling the database's memory",
        detail:
          `The vector indexes are ${mb(capacity.vector_index_bytes)}, ${pct(vectorRatio)} of the ` +
          `${mb(capacity.effective_cache_bytes)} the ${size.name} size can keep in memory. ` +
          `On 2026-10-04 indexing collapsed at 90%: every new face was written from disk.`,
        action: resizeAction(capacity),
      });
    }

    const dbRatio = capacity.db_bytes / (size.maxDbGb * GB);
    if (dbRatio >= T.dbSizeWarn) {
      findings.push({
        key: "db-size",
        severity: dbRatio >= T.dbSizeCritical ? "critical" : "warn",
        headline: `The database is at ${pct(dbRatio)} of the size recommended for ${size.name}`,
        detail:
          `${gb(capacity.db_bytes)} of data against Supabase's recommended ` +
          `${size.maxDbGb} GB for the ${size.name} compute size.`,
        action: resizeAction(capacity),
      });
    }

    if (capacity.timeouts_6h >= T.timeoutsWarn) {
      const contexts = Object.entries(capacity.timeout_contexts_6h)
        .sort((a, b) => b[1] - a[1])
        .map(([context, count]) => `${context} ${count}`)
        .join(", ");
      findings.push({
        key: "timeouts",
        severity: capacity.timeouts_6h >= T.timeoutsCritical ? "critical" : "warn",
        headline: `The database cancelled ${n(capacity.timeouts_6h)} queries for running too long in the last 6 hours`,
        detail: `Where: ${contexts || "unknown"}. An ordinary 6 hours has 0 to 3.`,
        action:
          "One context alone points at one slow query. Several at once means the whole database " +
          "is slow, which is a capacity problem: read the other findings in this message, then " +
          "`npx tsx scripts/capacity-check.ts` for the full reading.",
      });
    }

    if (capacity.sweep_failures_2h >= T.sweepFailuresCritical) {
      findings.push({
        key: "sweep-failing",
        severity: "critical",
        headline: "The job that requests AI indexing for waiting galleries is failing",
        detail:
          `ai-index-sweep failed ${capacity.sweep_failures_2h} times in the last 2 hours. ` +
          `While it fails, a gallery that is not already being indexed is never started.`,
        action:
          "Read the newest system_errors row with context inngest.ai-index-sweep. In October " +
          "2026 its query had outgrown the statement timeout (migration 090).",
      });
    }

    const connectionRatio = capacity.connections / Math.max(1, capacity.max_connections);
    if (connectionRatio >= T.connectionsWarn) {
      findings.push({
        key: "connections",
        severity: "warn",
        headline: `The database is using ${pct(connectionRatio)} of its connections`,
        detail: `${capacity.connections} of ${capacity.max_connections} on the ${size.name} size.`,
        action: resizeAction(capacity),
      });
    }
  }

  if (!backlog) {
    findings.push({
      key: "backlog-unreadable",
      severity: "warn",
      headline: "The capacity check could not count the AI backlog",
      detail: snapshot.errors.join(" | ") || "no reading returned",
      action:
        "The count reads only the unindexed photos, so failing here usually means the database " +
        "is slow or the backlog is very large. Both are worth a look.",
    });
  } else if (aiEnabled && backlog.backlog_photos >= T.backlogFloorPhotos) {
    const newestMs = backlog.newest_indexed_at ? Date.parse(backlog.newest_indexed_at) : 0;
    const idleHours = (now.getTime() - newestMs) / 3_600_000;
    // STALLED means work WAITED and nothing happened, not merely that the lane
    // has been quiet. Time since the last index alone fires falsely every busy
    // morning: lane idle overnight, a 1,500-photo upload begins at 9:00, and by
    // 9:23 there are 600 photos "waiting" behind a 15-hour-old last index while
    // the indexer is correctly holding for the upload to settle. So the backlog
    // must also have been there at the reading from that long ago. With no
    // reading that old (the first hours after deploy) this stays quiet.
    const waitedThatLong = (options.earlierBacklogPhotos ?? 0) >= T.backlogFloorPhotos;
    if (idleHours >= T.backlogStalledHours && waitedThatLong) {
      findings.push({
        key: "ai-stalled",
        severity: "critical",
        headline: "AI indexing has stopped with photos still waiting",
        detail:
          `${n(backlog.backlog_photos)} photos in ${n(backlog.backlog_events)} galleries are waiting, ` +
          (backlog.newest_indexed_at
            ? `and nothing has been indexed for ${Math.floor(idleHours)} hours.`
            : `and nothing has ever been indexed.`),
        action:
          "Use the pt-stall-triage skill. Check the Modal app, the ai-index runs in Inngest, and " +
          "whether one gallery at the front of the plan keeps failing (src/lib/ai-index/plan.ts). " +
          "An upload that has run for hours without a pause also holds its own gallery back.",
      });
    } else if (backlog.backlog_photos >= T.backlogSlowPhotos) {
      const perDay = backlog.indexed_24h;
      const days = perDay > 0 ? backlog.backlog_photos / perDay : Infinity;
      if (days > T.backlogSlowDays) {
        findings.push({
          key: "ai-backlog",
          severity: "warn",
          headline: Number.isFinite(days)
            ? `The AI backlog would take about ${Math.round(days)} days to clear at today's pace`
            : "The AI backlog is not being worked",
          detail:
            `${n(backlog.backlog_photos)} photos in ${n(backlog.backlog_events)} galleries are waiting. ` +
            `${n(perDay)} were indexed in the last 24 hours.`,
          action:
            "If the database findings above are also firing, fix those first: a slow database is " +
            "what slowed the lane in October 2026. If the database is healthy, the lane is simply " +
            "outnumbered, and raising the ai-index concurrency from 1 is the lever (lesson 168 " +
            "says why it is 1).",
        });
      }
    }
  }

  if (options.historyError) {
    findings.push({
      key: "history-unreadable",
      severity: "warn",
      headline: "The capacity check could not read its own earlier readings",
      detail: options.historyError,
      action:
        "Without them it cannot tell a stalled AI lane from a quiet one, so that alarm is off " +
        "until this clears. Check the capacity_snapshots table.",
    });
  }

  return findings;
}

/** One finding as plain text, for the email and the CLI. */
export function formatFinding(f: Finding): string {
  return [
    `${f.severity === "critical" ? "CRITICAL" : "WARNING"}: ${f.headline}`,
    `  ${f.detail}`,
    `  What to do: ${f.action}`,
  ].join("\n");
}

/** Take both readings. Never throws: a failed reading is recorded as an error. */
export async function readCapacity(supabase: SupabaseDB): Promise<CapacitySnapshot> {
  const errors: string[] = [];
  let capacity: CapacityReading | null = null;
  let backlog: BacklogReading | null = null;

  try {
    const { data, error } = await supabase.rpc("capacity_snapshot");
    if (error) errors.push(`capacity_snapshot: ${error.message}`);
    else capacity = data as unknown as CapacityReading;
  } catch (err) {
    errors.push(`capacity_snapshot: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const { data, error } = await supabase.rpc("ai_backlog_snapshot");
    if (error) errors.push(`ai_backlog_snapshot: ${error.message}`);
    else backlog = data as unknown as BacklogReading;
  } catch (err) {
    errors.push(`ai_backlog_snapshot: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { capacity, backlog, errors };
}

/** How long a finding stays quiet after it has been emailed, unless it worsens. */
const REALERT_HOURS = 24;

/**
 * Which findings deserve an email now: ones not alerted in the last 24 hours,
 * and ones that have gone from warn to critical since their last alert.
 * `lastAlerts` maps a finding key to the severity it was last emailed at.
 */
export function findingsToAlert(
  findings: Finding[],
  lastAlerts: Map<string, Severity>
): Finding[] {
  return findings.filter((f) => {
    const last = lastAlerts.get(f.key);
    if (!last) return true;
    return last === "warn" && f.severity === "critical";
  });
}

export interface CapacityCheckResult {
  findings: Finding[];
  alerted: string[];
  emailed: boolean;
  snapshot: CapacitySnapshot;
}

/**
 * The whole check: read, record, decide, tell. `notify: false` reads and
 * assesses only (the CLI's default), writing nothing.
 */
export async function runCapacityCheck(
  supabase: SupabaseDB,
  options: { notify?: boolean; aiEnabled?: boolean } = {}
): Promise<CapacityCheckResult> {
  const notify = options.notify ?? true;
  const snapshot = await readCapacity(supabase);
  const earlier = await earlierBacklog(supabase);
  const findings = assessCapacity(snapshot, {
    aiEnabled: options.aiEnabled,
    earlierBacklogPhotos: earlier.photos,
    historyError: earlier.error,
  });
  if (!notify) return { findings, alerted: [], emailed: false, snapshot };

  // The reading is kept whether or not anything is wrong: the trend is the
  // record that had to be rebuilt by hand in October 2026.
  const { error: storeError } = await supabase.from("capacity_snapshots").insert({
    data: JSON.parse(
      JSON.stringify({
        ...snapshot,
        findings: findings.map((f) => ({ key: f.key, severity: f.severity })),
      })
    ),
  });
  // Not stored means no history, which later reads as "no earlier reading"
  // and keeps the stalled alarm off. Say so in the run's own output.
  if (storeError) {
    console.error("capacity snapshot not stored:", storeError.message);
    snapshot.errors.push(`capacity_snapshots insert: ${storeError.message}`);
  }

  if (!findings.length) return { findings, alerted: [], emailed: false, snapshot };

  // Alert ledger: system_errors rows with context `capacity.<key>`, written
  // only when an email goes out. The message starts with the severity.
  const since = new Date(Date.now() - REALERT_HOURS * 3_600_000).toISOString();
  // Exact contexts, not a LIKE: this is what the (context, created_at) index
  // serves, so the read stays cheap on a database that is already struggling.
  const { data: recent, error: ledgerError } = await supabase
    .from("system_errors")
    .select("context, message, created_at")
    .in("context", findings.map((f) => `capacity.${f.key}`))
    .gte("created_at", since)
    .order("created_at", { ascending: true });
  if (ledgerError) {
    // The ledger is unreadable, so "already told him" cannot be known. For a
    // WARNING, stay quiet: guessing "not sent" would email every hour. For a
    // CRITICAL finding, send anyway. A database too broken to read its own
    // error table is the case this check exists for, and an hourly email
    // while that lasts is the right amount of noise.
    console.error("capacity alert ledger unreadable:", ledgerError.message);
    const critical = findings.filter((f) => f.severity === "critical");
    if (!critical.length) return { findings, alerted: [], emailed: false, snapshot };
    const sent = await sendCapacityEmail(critical, findings);
    return { findings, alerted: sent ? critical.map((f) => f.key) : [], emailed: sent, snapshot };
  }
  const lastAlerts = new Map<string, Severity>();
  for (const row of recent ?? []) {
    const key = String(row.context).slice("capacity.".length);
    lastAlerts.set(key, String(row.message).startsWith("critical") ? "critical" : "warn");
  }

  const toAlert = findingsToAlert(findings, lastAlerts);
  if (!toAlert.length) return { findings, alerted: [], emailed: false, snapshot };

  const emailed = await sendCapacityEmail(toAlert, findings);
  // Ledger rows are written only for a sent email. If the send failed, the
  // next hourly run tries again instead of believing it was delivered.
  if (emailed) {
    const { error: writeError } = await supabase.from("system_errors").insert(
      toAlert.map((f) => ({
        context: `capacity.${f.key}`,
        message: `${f.severity}: ${f.headline}`,
        detail: { detail: f.detail, action: f.action },
        notified: true,
      }))
    );
    // Sent but not recorded: the next run will send it again. That is the
    // loud direction, and it needs a database that can read but not write.
    if (writeError) console.error("capacity alert ledger not written:", writeError.message);
  }
  // `alerted` is what was actually delivered, not what was due.
  return { findings, alerted: emailed ? toAlert.map((f) => f.key) : [], emailed, snapshot };
}

/**
 * Photos waiting at the newest stored reading that is at least
 * `backlogStalledHours` old (and no more than twice that) and HAS a backlog
 * count. `photos: null` means there is no such reading yet, and "stalled" is
 * then not claimed. A read that fails is returned as an error, because a
 * history that cannot be read would otherwise switch "stalled" off in silence.
 */
async function earlierBacklog(
  supabase: SupabaseDB
): Promise<{ photos: number | null; error: string | null }> {
  const hours = THRESHOLDS.backlogStalledHours;
  const newest = new Date(Date.now() - hours * 3_600_000).toISOString();
  const oldest = new Date(Date.now() - hours * 2 * 3_600_000).toISOString();
  const { data, error } = await supabase
    .from("capacity_snapshots")
    .select("data")
    .lte("taken_at", newest)
    .gte("taken_at", oldest)
    .not("data->backlog", "is", null)
    .order("taken_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { photos: null, error: `capacity_snapshots: ${error.message}` };
  const photos = (data?.data as { backlog?: { backlog_photos?: unknown } } | null | undefined)
    ?.backlog?.backlog_photos;
  // PostgREST hands a jsonb number back as a number; accept a numeric string too.
  const value = typeof photos === "string" ? Number(photos) : photos;
  return { photos: typeof value === "number" && Number.isFinite(value) ? value : null, error: null };
}

async function sendCapacityEmail(toAlert: Finding[], all: Finding[]): Promise<boolean> {
  const adminEmail = process.env.ADMIN_ALERT_EMAIL;
  const resendKey = process.env.RESEND_API_KEY;
  if (!adminEmail || !resendKey) {
    console.error("capacity alert not sent: ADMIN_ALERT_EMAIL or RESEND_API_KEY is not set");
    return false;
  }
  const top = toAlert.find((f) => f.severity === "critical") ?? toAlert[0];
  const standing = all.filter((f) => !toAlert.includes(f));
  const text = [
    "Pixeltrunk capacity check",
    "",
    ...toAlert.map(formatFinding).flatMap((block) => [block, ""]),
    standing.length ? "Still true from earlier alerts:" : null,
    ...standing.map((f) => `  ${f.severity === "critical" ? "CRITICAL" : "WARNING"}: ${f.headline}`),
    standing.length ? "" : null,
    "Each finding is emailed once a day at most, or sooner if it gets worse.",
    "Full reading: npx tsx scripts/capacity-check.ts",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `Pixeltrunk Alerts <${process.env.RESEND_FROM_EMAIL || "gallery@resend.dev"}>`,
        to: [adminEmail],
        subject: `[Pixeltrunk] Capacity: ${top.headline}`.slice(0, 180),
        text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) console.error("capacity alert send failed: http", res.status);
    return res.ok;
  } catch (err) {
    console.error("capacity alert send failed:", err);
    return false;
  }
}
