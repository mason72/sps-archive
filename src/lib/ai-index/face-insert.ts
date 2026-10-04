/**
 * Writing face rows without losing a paid Modal pass to a slow database.
 * Split out of index-event.ts so the retry logic can be tested without the
 * server-only imports that file carries.
 */

/**
 * Rows per `faces` INSERT statement.
 *
 * `faces` carries an HNSW index on the binary-quantized embedding, so every
 * inserted row is woven into that graph at a per-row cost that climbs as the
 * graph grows (173,647 faces / 59 MB at the time of writing). Writing a whole
 * 100-image batch as one statement lost to PostgREST's 8s statement_timeout
 * four times — 57014 on 2026-08-12 (02:30 and 04:10 UTC), 08-29 and 08-30
 * (both 09:47) — each one throwing away a Modal pass that had already been
 * metered.
 *
 * SIZED AGAINST THE EXCURSION, NOT THE ROW COUNT, because the row count turned
 * out not to be the problem. The four failing events run 1.0, 1.0, 2.0 and 3.2
 * faces per image (DAIS 26, Island HQ Headshot Day, Power Rangers, Ivana's
 * Bridal Shower) — headshot days, not group shots. So the failing statements
 * were roughly 100-320 rows, and warm that is ~0.2-0.7s against an 8s ceiling.
 * They still timed out, which means a >10x excursion did it, not the volume.
 * Measured directly: warm cost is flatly linear at ~2.1ms/row (50 rows 107ms,
 * 100 rows 223ms, 150 rows 360ms), but the session's first write ran 8,606ms
 * for 150 rows — a ~24x excursion, one observation.
 *
 * Chunking helps because the timeout is PER STATEMENT: cutting the work per
 * statement by 2-6x is what moves the same excursion from over the ceiling to
 * under it. At 50 rows a 20x excursion lands at ~2.1s; at 150 it lands at
 * ~7.2s, which passes and tells you nothing about the next one. A single
 * observation cannot characterise a tail, which is the argument FOR headroom
 * rather than against it.
 *
 * Do NOT re-derive this as a density story. The archive does reach 9.7 faces
 * per image on some galleries (one frame holds 129), and those batches are
 * genuinely ~1,000 rows — but none of them is what failed. Chasing group shots
 * would be looking in the wrong place.
 *
 * Cost is ~20 statements instead of 7 on a 1,000-row batch, about 2s of extra
 * round-trips in a job that runs for minutes — cheaper than shrinking
 * AI_INDEX_BATCH, which would buy the same safety by paying Modal for more GPU
 * round-trips.
 *
 * THE CHUNK NOW SHRINKS ON A TIMEOUT (2026-10-04, lesson 175). A fixed 50 was
 * sized for a ~24x excursion over a 2.1ms row. When the HNSW index outgrew the
 * database's memory (360 MB against 256 MB of shared buffers on the Micro
 * instance), the ROW itself went to ~167ms and 50 rows averaged 8.3s against a
 * 15s ceiling: 1,017 timeouts in 48 hours, about four of every five batches,
 * each one discarding a Modal pass that had already been paid for. A timed-out
 * INSERT is one cancelled statement, so nothing from it landed and the same
 * rows can be re-sent in smaller pieces. Halving turns a slow database into a
 * slow batch instead of a wasted one. It does not make the database fast; the
 * capacity check (src/lib/monitoring/capacity.ts) is what says when to resize.
 */
export const FACE_INSERT_CHUNK = 50;

/** Smallest chunk tried before a timeout is treated as a real failure. */
export const FACE_INSERT_MIN_CHUNK = 5;

export interface DbError {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
}

/** Postgres cancelled the statement for running past statement_timeout. */
export function isStatementTimeout(err: DbError | null | undefined): boolean {
  if (!err) return false;
  return err.code === "57014" || /statement timeout/i.test(err.message ?? "");
}

export interface ChunkedInsertResult {
  /** INSERT statements that succeeded. */
  statements: number;
  /** Times the chunk was halved after a timeout. 0 on a healthy database. */
  shrinks: number;
  /** Chunk size in use when the last row landed. */
  finalChunk: number;
}

/** Thrown when the time allowed for the insert runs out before the rows do. */
export class FaceInsertOutOfTime extends Error {
  constructor(landed: number, total: number, chunk: number) {
    super(
      `out of time after ${landed} of ${total} rows (chunk ${chunk}); ` +
        `the database is too slow to finish this batch inside the run`
    );
    this.name = "FaceInsertOutOfTime";
  }
}

export interface ChunkedInsertOptions {
  /** Chunk to start at. A run passes the size its previous batch ended on. */
  startChunk?: number;
  minChunk?: number;
  /**
   * Epoch ms after which no further statement is started. Without it a slow
   * database can carry a batch past the serverless limit, where the platform
   * kills the run: the Modal pass is lost anyway and nothing is reported,
   * because the catch never runs.
   */
  deadline?: number;
}

/**
 * Insert `rows` in chunks, halving the chunk whenever a statement times out.
 *
 * `insert` sends ONE statement and returns its error, or null. The smaller size
 * is kept for the rest of the call: a database slow enough to time out once is
 * slow for the whole batch. Any other error, or a timeout at the floor, is
 * thrown as the raw database error for the caller to label.
 */
export async function insertInShrinkingChunks<T>(
  rows: T[],
  insert: (slice: T[]) => Promise<DbError | null>,
  options: ChunkedInsertOptions = {}
): Promise<ChunkedInsertResult> {
  // Floors of 1: a zero or NaN chunk would slice nothing and never advance.
  const minChunk = Math.max(1, Math.floor(options.minChunk ?? FACE_INSERT_MIN_CHUNK) || 1);
  let chunk = Math.max(
    minChunk,
    Math.floor(options.startChunk ?? FACE_INSERT_CHUNK) || FACE_INSERT_CHUNK
  );
  let statements = 0;
  let shrinks = 0;
  for (let i = 0; i < rows.length; ) {
    if (options.deadline !== undefined && Date.now() > options.deadline) {
      throw new FaceInsertOutOfTime(i, rows.length, chunk);
    }
    const slice = rows.slice(i, i + chunk);
    const err = await insert(slice);
    if (!err) {
      i += slice.length;
      statements++;
      continue;
    }
    if (isStatementTimeout(err) && chunk > minChunk) {
      chunk = Math.max(minChunk, Math.floor(chunk / 2));
      shrinks++;
      continue;
    }
    throw err;
  }
  return { statements, shrinks, finalChunk: chunk };
}
