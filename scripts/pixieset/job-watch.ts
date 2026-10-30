/**
 * Is a temporary launchd job actually working? The stall check asks this about the
 * re-pull runner and the zip audit, because a job's own alerts die with the job: a
 * hung child, a startup crash or a job that was never loaded emails nobody.
 */
export function jobProblem(input: {
  label: string;
  /** `launchctl list <label>` output, or null when launchctl says it is not loaded. */
  launchctl: string | null;
  /** When the job's log last moved, or null if it has none. Each run prints a heartbeat. */
  logMtimeMs: number | null;
  maxQuietMs: number;
  nowMs: number;
}): string | null {
  const { label, launchctl, logMtimeMs, maxQuietMs, nowMs } = input;
  if (launchctl === null) return `${label} is not loaded`;
  const running = /"PID"\s*=\s*\d+/.test(launchctl);
  const status = launchctl.match(/"LastExitStatus"\s*=\s*(-?\d+)/);
  if (!running && status && Number(status[1]) !== 0) return `${label} last exited with status ${status[1]}`;
  if (logMtimeMs === null) return `${label} has written no log`;
  const quiet = nowMs - logMtimeMs;
  if (quiet > maxQuietMs) return `${label} has been quiet for ${Math.round(quiet / 60_000)} min`;
  return null;
}
