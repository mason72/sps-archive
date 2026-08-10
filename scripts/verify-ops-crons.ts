/**
 * First-run proof of the Phase 3 ops crons — invokes the exact functions the
 * Inngest jobs run, against production data.
 *
 *   ADMIN_ALERT_EMAIL=<you> npx tsx scripts/verify-ops-crons.ts
 *
 * The pricing summary SENDS ITS REAL EMAIL (that's the verification); the
 * anomaly check reports what it would flag. ADMIN_ALERT_EMAIL lives in
 * Vercel, not .env.local, so pass it explicitly.
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const { createServiceClient } = await import("../src/lib/supabase/server");
  const { runDailyAnomalyCheck } = await import("../src/lib/usage/anomaly");
  const { sendPricingSummary } = await import("../src/lib/usage/pricing-summary");
  const supabase = createServiceClient();

  console.log("1) anomaly check…");
  const anomaly = await runDailyAnomalyCheck(supabase);
  console.log(
    `   checked ${anomaly.checked} active account(s), flagged ${anomaly.flagged.length}`,
    anomaly.flagged.map((f) => `${f.email}: $${f.yesterdayCost.toFixed(2)} > $${f.threshold.toFixed(2)}`)
  );
  console.log(`   config: ${JSON.stringify(anomaly.config)}`);

  console.log("2) pricing summary…");
  const summary = await sendPricingSummary(supabase);
  if (!summary.sent) throw new Error("summary NOT sent — ADMIN_ALERT_EMAIL/RESEND_API_KEY missing");
  console.log(`   sent for ${summary.users} account(s) to ${process.env.ADMIN_ALERT_EMAIL}`);

  console.log("ALL PASS");
}

main().catch((e) => {
  console.error("VERIFY FAILED:", e);
  process.exit(1);
});
