/**
 * Run the daily cost-anomaly check against production and print what it WOULD
 * flag. Unlike scripts/verify-ops-crons.ts this sends no pricing-summary email,
 * so it is safe to run any time you have changed the threshold.
 *
 * Note it still calls reportSystemError if something genuinely trips — that is
 * the real function, not a simulation, which is the point.
 *
 *   npx tsx scripts/triage/anomaly-dry-run.ts
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
async function main() {
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { runDailyAnomalyCheck } = await import("../../src/lib/usage/anomaly");
  const r = await runDailyAnomalyCheck(createServiceClient());
  console.log("config read from ops_config:", JSON.stringify(r.config));
  console.log("accounts checked:", r.checked);
  console.log(
    "flagged:",
    r.flagged.length,
    r.flagged.map((f) => `${f.email} $${f.yesterdayCost.toFixed(2)} > $${f.threshold.toFixed(2)}`)
  );
}
main().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
