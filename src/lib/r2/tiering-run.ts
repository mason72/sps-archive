/**
 * The I/O half of src/lib/r2/tiering.ts: the R2 adapter, the exclusion list
 * from the images table, and the walk's cursor in ops_config. The Inngest
 * function `r2-infrequent-access` and scripts/r2-ia-tiering.ts both use it.
 */
import type { createServiceClient } from "@/lib/supabase/server";
import { copyToInfrequentAccess, listObjectsPage } from "./client";
import {
  IA_CURSOR_KEY,
  IA_PREFIX,
  runTieringPass,
  type PassResult,
  type TieringDeps,
} from "./tiering";

type SupabaseClient = ReturnType<typeof createServiceClient>;

export const r2TieringDeps: TieringDeps = {
  list: (startAfter) => listObjectsPage(IA_PREFIX, startAfter),
  copyToIa: copyToInfrequentAccess,
};

/**
 * Originals that must stay on the normal tier: website-published photos (the
 * site lane re-copies them) and cover uploads. A failed read THROWS: moving
 * with a partial list would move exactly the files this list protects.
 * Keyset paging on id (a row unpublished mid-read cannot shift a published one
 * out of the window), stopping only on an EMPTY page so a server row cap below
 * the page size cannot truncate it. ~1,600 rows on 2026-10-20; each page is
 * one ~0.75 s scan of images (no index on either column, measured).
 */
export async function loadIaExclusions(supabase: SupabaseClient): Promise<string[]> {
  const PAGE = 1000;
  const keys: string[] = [];
  let after = "";
  for (;;) {
    let q = supabase
      .from("images")
      .select("id, r2_key")
      .or("site_published_at.not.is.null,is_cover_upload.eq.true")
      .order("id")
      .limit(PAGE);
    if (after) q = q.gt("id", after);
    const { data, error } = await q;
    if (error) throw new Error(`loadIaExclusions: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) if (row.r2_key) keys.push(row.r2_key);
    after = data[data.length - 1].id;
  }
  return keys;
}

export interface IaCursor {
  /** Resume point; null = start of the bucket. */
  startAfter: string | null;
  lapStartedAt: string | null;
  lastLapCompletedAt: string | null;
  lastRunAt: string | null;
  /** Running totals for the lap in progress. */
  lap: { moved: number; movedBytes: number; failed: number };
}

const EMPTY_CURSOR: IaCursor = {
  startAfter: null,
  lapStartedAt: null,
  lastLapCompletedAt: null,
  lastRunAt: null,
  lap: { moved: 0, movedBytes: 0, failed: 0 },
};

export async function readIaCursor(supabase: SupabaseClient): Promise<IaCursor> {
  const { data, error } = await supabase
    .from("ops_config")
    .select("value")
    .eq("key", IA_CURSOR_KEY)
    .maybeSingle();
  if (error) throw new Error(`readIaCursor: ${error.message}`);
  return { ...EMPTY_CURSOR, ...((data?.value as Partial<IaCursor> | null) ?? {}) };
}

async function writeIaCursor(supabase: SupabaseClient, cursor: IaCursor): Promise<void> {
  const { error } = await supabase
    .from("ops_config")
    .upsert({ key: IA_CURSOR_KEY, value: cursor as never, updated_at: new Date().toISOString() });
  if (error) throw new Error(`writeIaCursor: ${error.message}`);
}

/**
 * One bounded slice of the walk: reload the exclusions (so a photo published
 * to the website an hour ago is protected), read the cursor, walk pages until
 * `budgetMs` is spent, and save the cursor after EVERY page, so a step killed
 * mid-slice loses at most one page of progress.
 */
export async function runIaSlice(
  supabase: SupabaseClient,
  budgetMs: number,
  hardMs: number
): Promise<PassResult> {
  const started = Date.now();
  const excluded = new Set(await loadIaExclusions(supabase));
  const cursor = await readIaCursor(supabase);
  const now = new Date();

  const save = async (r: PassResult) => {
    const lap = {
      moved: cursor.lap.moved + r.moved,
      movedBytes: cursor.lap.movedBytes + r.movedBytes,
      failed: cursor.lap.failed + r.failed.length,
    };
    if (r.wrapped) console.log("[r2-ia] lap complete", JSON.stringify(lap));
    await writeIaCursor(supabase, {
      startAfter: r.cursor,
      lapStartedAt: r.wrapped ? null : (cursor.lapStartedAt ?? now.toISOString()),
      lastLapCompletedAt: r.wrapped ? new Date().toISOString() : cursor.lastLapCompletedAt,
      lastRunAt: new Date().toISOString(),
      lap: r.wrapped ? { moved: 0, movedBytes: 0, failed: 0 } : lap,
    });
  };

  return runTieringPass(r2TieringDeps, {
    startAfter: cursor.startAfter,
    excluded,
    now,
    maxPages: Number.MAX_SAFE_INTEGER,
    deadline: started + budgetMs,
    hardDeadline: started + hardMs,
    onPage: save,
  });
}
