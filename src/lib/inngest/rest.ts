/**
 * Inngest's REST API — for the one thing the SDK cannot do: see and cancel
 * runs that are ALREADY stuck.
 *
 * Proven by hand on 2026-09-18 before it was written down here: listing
 * `sps/pull.requested` events, reading each one's runs, and DELETE-ing the one
 * that had sat "Running" for 4h20m freed the job's concurrency slot, and a
 * re-sent event resumed the import within five minutes.
 *
 * Authenticates with INNGEST_SIGNING_KEY — the same key `serve()` already
 * reads, so production has it by construction. It travels in a fetch header,
 * never argv.
 */

const API = "https://api.inngest.com/v1";

/** Terminal run states. Anything else still holds (or is waiting for) a slot. */
const TERMINAL = new Set(["Completed", "Failed", "Cancelled"]);

function headers(): Record<string, string> {
  const key = process.env.INNGEST_SIGNING_KEY;
  if (!key) throw new Error("INNGEST_SIGNING_KEY is not set — cannot reach the Inngest API");
  return { Authorization: `Bearer ${key}` };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Inngest API ${res.status} on ${url.replace(API, "")}`);
  return (await res.json()) as T;
}

interface ApiEvent {
  internal_id: string;
  data?: Record<string, unknown>;
}
interface ApiRun {
  run_id: string;
  status: string;
  run_started_at?: string | null;
}

export interface CancelResult {
  /** Runs that had started and were cancelled — the zombies. */
  cancelled: string[];
  /** Live runs that have not started yet: waiting their turn, left alone. */
  waiting: string[];
  /** Per-run cancel failures; the other runs were still attempted. */
  errors: string[];
}

/**
 * Cancel every STARTED, non-terminal run triggered by an event named
 * `eventName` whose `data[key] === value`, received after `since`.
 *
 * A run that has not started is only waiting for the concurrency slot, so it
 * is reported in `waiting` and never cancelled — cancelling it would push the
 * job to the back of the queue for nothing (caught in review).
 *
 * Throws if it cannot LOOK (listing failed, or the window holds too many
 * events to see whole): a caller that cannot tell "nothing was live" from
 * "could not look" must not act as if it knows.
 */
export async function cancelLiveRuns(opts: {
  eventName: string;
  key: string;
  value: string;
  since: Date;
}): Promise<CancelResult> {
  const result: CancelResult = { cancelled: [], waiting: [], errors: [] };
  const qs = new URLSearchParams({
    name: opts.eventName,
    received_after: opts.since.toISOString(),
    limit: "100",
  });
  const events = await getJson<{ data?: ApiEvent[] }>(`${API}/events?${qs}`);
  const list = events.data ?? [];
  // The listing is by NAME across every job. A full page means there may be
  // more, and the API's cursor shape is unverified here — so refuse rather
  // than cancel from a partial view.
  if (list.length >= 100) {
    throw new Error(`Inngest API: 100+ "${opts.eventName}" events since ${opts.since.toISOString()}; narrow the window`);
  }

  for (const ev of list) {
    if (ev.data?.[opts.key] !== opts.value) continue;
    const runs = await getJson<{ data?: ApiRun[] }>(`${API}/events/${ev.internal_id}/runs`);
    for (const run of runs.data ?? []) {
      if (TERMINAL.has(run.status)) continue;
      if (!run.run_started_at) {
        result.waiting.push(run.run_id);
        continue;
      }
      try {
        const res = await fetch(`${API}/runs/${run.run_id}`, {
          method: "DELETE",
          headers: headers(),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        result.cancelled.push(run.run_id);
      } catch (err) {
        result.errors.push(`${run.run_id} (${run.status}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return result;
}
