/**
 * Prove that creating an auth user still provisions its rows.
 *
 * auth.users carries three triggers, two of which fire
 * handle_new_user_subscription() on every signup — a duplicate pair. Dropping
 * the redundant one is a one-line change to the alpha's FRONT DOOR, so it does
 * not ship on reasoning. This creates a real user, checks the rows the triggers
 * are supposed to write, and deletes it again.
 *
 * Safe by construction:
 *  - the address is on example.com, which IANA reserves and which routes
 *    nowhere, so no mail can reach a real person;
 *  - `email_confirm: true` means Supabase sends no confirmation email;
 *  - subscriptions and user_profiles both cascade on user delete, so the
 *    cleanup is the database's own, not a list of deletes I might get wrong;
 *  - it verifies the user is GONE at the end and shouts if not.
 *
 *   npx tsx scripts/triage/signup-trigger-test.ts
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const stamp = process.argv[2] ?? String(Date.now());
  const email = `pixeltrunk-trigger-check-${stamp}@example.com`;

  const triggers = await s.rpc("database_footprint"); // cheap liveness check
  if (triggers.error) throw new Error(`db unreachable: ${triggers.error.message}`);

  console.log(`creating ${email} …`);
  const { data: created, error: createErr } = await s.auth.admin.createUser({
    email,
    password: crypto.randomUUID() + "Aa1!",
    email_confirm: true,
  });
  if (createErr || !created.user) throw new Error(`createUser: ${createErr?.message}`);
  const uid = created.user.id;

  // The triggers are AFTER INSERT in the same transaction, so the rows exist by
  // the time createUser returns. A short retry only guards against replication
  // lag on the read path, not against a missing trigger.
  let sub: unknown = null;
  let prof: unknown = null;
  for (let i = 0; i < 5; i++) {
    const [{ data: sRow }, { data: pRow }] = await Promise.all([
      s.from("subscriptions").select("user_id, plan, status").eq("user_id", uid).maybeSingle(),
      s.from("user_profiles").select("user_id").eq("user_id", uid).maybeSingle(),
    ]);
    sub = sRow;
    prof = pRow;
    if (sub && prof) break;
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`  subscriptions row: ${sub ? JSON.stringify(sub) : "MISSING"}`);
  console.log(`  user_profiles row: ${prof ? "present" : "MISSING"}`);

  // How many subscription rows? The duplicate trigger inserts twice; the
  // function's ON CONFLICT DO NOTHING is what keeps that to one. If this ever
  // reads 2, the conflict guard has stopped working.
  const { count } = await s
    .from("subscriptions")
    .select("user_id", { count: "exact", head: true })
    .eq("user_id", uid);
  console.log(`  subscription row count: ${count}`);

  console.log(`deleting ${uid} …`);
  const { error: delErr } = await s.auth.admin.deleteUser(uid);
  if (delErr) throw new Error(`deleteUser FAILED (clean up by hand): ${delErr.message}`);

  const { data: after } = await s
    .from("subscriptions")
    .select("user_id")
    .eq("user_id", uid)
    .maybeSingle();
  const { data: profAfter } = await s
    .from("user_profiles")
    .select("user_id")
    .eq("user_id", uid)
    .maybeSingle();

  console.log(`  cascade cleanup: subscriptions ${after ? "STILL PRESENT" : "gone"}, profile ${profAfter ? "STILL PRESENT" : "gone"}`);

  const ok = !!sub && !!prof && count === 1 && !after && !profAfter;
  console.log(ok ? "\nPASS — signup provisioning works and the test left nothing behind." : "\nFAIL — read the lines above.");
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
