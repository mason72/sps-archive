/**
 * Walk the archive bucket the way the daily `r2-infrequent-access` job does,
 * and report (or, with --apply, move) originals that qualify for R2
 * Infrequent Access. See src/lib/r2/tiering.ts for the rules.
 *
 *   npx tsx scripts/r2-ia-tiering.ts                 # dry run: counts only, moves nothing
 *   npx tsx scripts/r2-ia-tiering.ts --pages 50      # dry run over the first 50 listing pages
 *   npx tsx scripts/r2-ia-tiering.ts --apply         # move what qualifies
 *   ... --concurrency 32                             # copies in flight (default 16)
 *
 * It never reads or writes the job's cursor in ops_config, so it can run
 * beside the job: a moved object lists as STANDARD_IA and the other walker
 * skips it, and every copy is guarded by the ETag it was listed with.
 * Listing is a Class A operation: a full lap is roughly 4,500 calls, ~$0.02.
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const pagesArg = args.indexOf("--pages");
const maxPages = pagesArg >= 0 ? Number(args[pagesArg + 1]) : 100_000;
const concArg = args.indexOf("--concurrency");
const concurrency = concArg >= 0 ? Number(args[concArg + 1]) : 16;
if (!Number.isInteger(concurrency) || concurrency <= 0) {
  console.error("--concurrency needs a positive whole number");
  process.exit(2);
}
if (!Number.isInteger(maxPages) || maxPages <= 0) {
  console.error("--pages needs a positive whole number");
  process.exit(2);
}

async function main() {
  // Imported after the env is loaded: the R2 client reads it at import time.
  const { runTieringPass } = await import("../src/lib/r2/tiering");
  const { r2TieringDeps, loadIaExclusions } = await import("../src/lib/r2/tiering-run");

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const excluded = new Set(await loadIaExclusions(supabase as never));
  console.log(`${apply ? "APPLY" : "DRY RUN"}: ${excluded.size} originals excluded (website / cover uploads)`);

  // A dry run's "copy" does nothing, so the pass's moved counts read as "would move".
  const deps = apply ? r2TieringDeps : { list: r2TieringDeps.list, copyToIa: async () => {} };

  const started = Date.now();
  const result = await runTieringPass(deps, { startAfter: null, excluded, now: new Date(), maxPages, concurrency });

  console.log({
    pages: result.pages,
    listed: result.listed,
    [apply ? "moved" : "wouldMove"]: result.moved,
    [apply ? "movedGB" : "wouldMoveGB"]: (result.movedBytes / 1e9).toFixed(1),
    savingPerMonth: `$${((result.movedBytes / 1e9) * 0.005).toFixed(2)}`,
    oneTimeCopyCost: `$${((result.moved / 1e6) * 9).toFixed(2)}`,
    skipped: result.counts,
    failed: result.failed.length,
    reachedEnd: result.wrapped,
    stalled: result.stalled,
    seconds: Math.round((Date.now() - started) / 1000),
  });
  for (const f of result.failed.slice(0, 10)) console.log("  failed:", f.key, f.error);
  process.exit(result.failed.length > 0 || result.stalled ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
