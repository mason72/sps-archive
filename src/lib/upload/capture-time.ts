/**
 * EXIF capture time → one UTC instant. The ONE home for turning a camera clock
 * into `images.taken_at` (2026-09-24).
 *
 * EXIF `DateTimeOriginal` is a wall clock with no zone ("2026:09:17 01:27:35").
 * exifr's default revives it with `new Date(...)`, which reads it in the zone of
 * WHATEVER PROCESS IS RUNNING, so one function stored three different answers
 * for the same file:
 *   - SPS pull on Vercel (UTC)        → 01:27:35Z
 *   - browser upload in Los Angeles   → 08:27:35Z (and 4–5h off from a laptop
 *                                        that was travelling at the time)
 *   - Pixieset ingest on the mini (LA) → 08:27:35Z
 * The file itself said `OffsetTimeOriginal: -08:00`, which reads as 09:27:35Z
 * (that body's clock was wrong too; see below). Measured over one frame per event: 62% of events carry the offset tag, with
 * offsets from -04:00 to +00:00, so the gap is hours on travel shoots
 * (`scripts/triage/taken-at-offset-probe.ts`).
 *
 * Rule: the offset tag wins, EXCEPT `+00:00`. Without a usable one, the wall
 * clock is read as `FALLBACK_CAPTURE_ZONE` (Mason's call, 2026-09-24) — a FIXED
 * zone, never the runtime's, so every machine now agrees. Pacific was chosen because it is what
 * the mini and the laptop already produced for untagged files, so it does not
 * move the ~40% of migrated galleries that have no tag. Untagged travel shoots
 * stay hours off; the venue's zone would fix that and is not built.
 *
 * Why `+00:00` is not trusted (measured 2026-09-24): it is what a Canon writes
 * when its zone was never set. The bodies that wrote it also wrote clocks of
 * 2000-01-01 and 2023 dates on 2025 shoots, and Kinexions (Las Vegas) reads
 * 9am-4pm as a Pacific clock but 2am-9am if the tag is believed. A real
 * London shoot is the one casualty, and this studio shoots the US.
 *
 * What this CANNOT fix: a clock that is simply wrong. The AU 2026 R3 (Venetian,
 * Las Vegas) wrote `-08:00`, and its raw clock runs 19:00-06:00 for a booth
 * that was open by day: it was ~11h fast. Both paths now store the SAME wrong
 * instant, which is what cross-path matching needs, but not the true one.
 * Tags ARE right on well-set bodies: an R1/R3 left on Eastern put Hotel Data
 * (Dallas, -05:00) at 8am-4pm local and PG&E (SF) at 10am-4pm, where reading
 * the clock as Pacific said 1pm-7pm.
 *
 * ⚠️ Changing this moves capture-second keys (`twin-skip.ts`,
 * `consolidate-duplicates.ts`). Rows written before 2026-09-24 were NOT
 * backfilled; see `legacyCaptureInstants()` for matching against them.
 */

/** The zone an untagged camera clock is read in. */
export const FALLBACK_CAPTURE_ZONE = "America/Los_Angeles";

const WALL_CLOCK = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
const OFFSET = /^([+-])(\d{2}):?(\d{2})$/;

type WallClock = [y: number, mo: number, d: number, h: number, mi: number, s: number];

/** "2026:09:17 01:27:35" → its parts, or null for blanks like "0000:00:00 00:00:00". */
function parseWallClock(raw: unknown): WallClock | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(WALL_CLOCK);
  if (!m) return null;
  const p = m.slice(1).map(Number) as WallClock;
  const [y, mo, d, h, mi, s] = p;
  if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return null;
  return p;
}

/**
 * "-08:00" → -480 minutes; null when absent, not a real offset, or `+00:00`
 * (a camera whose zone was never set — see the header).
 */
export function parseOffsetMinutes(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(OFFSET);
  if (!m) return null;
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  if (Number(m[3]) > 59 || minutes > 14 * 60) return null;
  if (minutes === 0) return null;
  return m[1] === "-" ? -minutes : minutes;
}

/** Minutes a zone is ahead of UTC at instant `t` (negative west of Greenwich). */
function zoneOffsetMinutes(t: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - t) / 60000);
}

/**
 * A wall clock read in `timeZone`, DST-aware, as a UTC epoch.
 *
 * Two candidates settle the DST edges, matching what the old `new Date()`
 * reader did so legacy keys line up: the fall-back hour (it happens twice)
 * takes its FIRST occurrence, and the spring-forward hour (it never happens)
 * moves forward, so 02:30 on that night reads as 03:30 daylight time.
 */
function wallClockInZone(naiveUtc: number, timeZone: string): number {
  const t1 = naiveUtc - zoneOffsetMinutes(naiveUtc, timeZone) * 60000;
  const t2 = naiveUtc - zoneOffsetMinutes(t1, timeZone) * 60000;
  const roundTrips = (t: number) => t + zoneOffsetMinutes(t, timeZone) * 60000 === naiveUtc;
  const hits = [t1, t2].filter(roundTrips);
  if (hits.length) return Math.min(...hits);
  return Math.max(t1, t2);
}

/**
 * The capture instant as an ISO string, or null when the file has no usable
 * date. `dateTimeOriginal` must be the RAW EXIF string (parse with
 * `reviveValues: false`) — a revived Date has already been read in the
 * runtime's zone, which is the bug this exists to remove.
 */
export function captureInstant(
  dateTimeOriginal: unknown,
  offsetTimeOriginal: unknown,
  fallbackZone: string = FALLBACK_CAPTURE_ZONE
): string | null {
  const wall = parseWallClock(dateTimeOriginal);
  if (!wall) return null;
  const [y, mo, d, h, mi, s] = wall;
  const naiveUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  const offset = parseOffsetMinutes(offsetTimeOriginal);
  const t = offset != null ? naiveUtc - offset * 60000 : wallClockInZone(naiveUtc, fallbackZone);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * Every value the OLD reader could have stored for this wall clock: read in
 * UTC (SPS pull on Vercel) and read in Pacific (the mini, and browser uploads
 * from home). For capture-second matching against rows written before
 * 2026-09-24, which were never backfilled. Browser uploads from a laptop
 * outside Pacific are not covered; nothing can recover which zone that was.
 */
export function legacyCaptureInstants(dateTimeOriginal: unknown): string[] {
  const wall = parseWallClock(dateTimeOriginal);
  if (!wall) return [];
  const [y, mo, d, h, mi, s] = wall;
  const naiveUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  return [...new Set([naiveUtc, wallClockInZone(naiveUtc, FALLBACK_CAPTURE_ZONE)])].map((t) =>
    new Date(t).toISOString()
  );
}
