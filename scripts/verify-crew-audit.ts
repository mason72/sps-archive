/**
 * Acceptance test for the crew judgement log (migration 073).
 *
 *   npx tsx scripts/verify-crew-audit.ts
 *
 * Creates a throwaway crew row, exercises every path the trigger has, asserts
 * each one, then deletes the row (the FK cascade takes its log rows with it).
 * Leaves the database exactly as it found it — the final check asserts that.
 *
 * ⚠️ Runs against PRODUCTION, like everything else here (.env.local points at
 * it; there is no dev database). It only ever touches the row it created, and
 * that row's id is a fixed sentinel so a crashed run is trivially cleanable.
 *
 * Why this exists as a script rather than a one-off: the trigger is now on the
 * write path of every roster and event-intel save. If it throws, it does not
 * corrupt anything — it BLOCKS the write, and the symptom is "saving a rating
 * silently fails", three layers from the cause. This is the thing to run after
 * touching the trigger, the watched-field list, or either plumbing column.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

/* eslint-disable @typescript-eslint/no-explicit-any */

const SENTINEL = "00000000-dead-4000-8000-0000000000a7";

function env(): { url: string; key: string } {
  // .env.local is not loaded for a bare tsx run.
  const raw = fs.readFileSync(".env.local", "utf8");
  const get = (k: string) =>
    raw.split("\n").find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? "";
  const url = get("NEXT_PUBLIC_SUPABASE_URL");
  const key = get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
  return { url, key };
}

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) {
    failures++;
    if (detail !== undefined) console.log(`      got: ${JSON.stringify(detail)}`);
  }
}

async function main() {
  const { url, key } = env();
  const db = createClient(url, key) as any;

  // The archive owner every crew row belongs to, and a second real account to
  // stand in as the actor. Read live rather than hardcoded.
  const { data: owner } = await db.from("crew").select("user_id").limit(1).single();
  const ownerId = owner.user_id as string;
  const { data: someoneElse } = await db
    .from("user_profiles").select("user_id").neq("user_id", ownerId).limit(1).maybeSingle();
  const actorId = (someoneElse?.user_id as string | undefined) ?? ownerId;

  console.log("\ncrew_change_log — acceptance\n");

  // Clean any residue from a crashed run before starting.
  await db.from("crew").delete().eq("id", SENTINEL);

  const log = async () =>
    (
      await db
        .from("crew_change_log")
        .select("seq, field, old_value, new_value, actor_id, source, event_id")
        .eq("crew_id", SENTINEL)
        .order("seq")
    ).data as any[];

  // ── 1. INSERT ─────────────────────────────────────────────────────────────
  await db.from("crew").insert({
    id: SENTINEL, user_id: ownerId, display_name: "ZZ Audit Probe",
    kind: "photographer", last_actor_id: actorId, last_actor_source: "roster",
  });
  let rows = await log();
  check("a new person opens their history with one 'created' row",
    rows.length === 1 && rows[0].field === "created", rows);
  check("the default is_regular=false is NOT logged as a judgement",
    !rows.some((r) => r.field === "is_regular"), rows);
  check("the creation is attributed", rows[0]?.actor_id === actorId, rows[0]?.actor_id);

  // ── 2. A watched field, signed ────────────────────────────────────────────
  await db.from("crew").update({
    is_regular: true, last_actor_id: actorId, last_actor_source: "roster",
  }).eq("id", SENTINEL);
  rows = await log();
  const starred = rows.find((r) => r.field === "is_regular");
  check("starring someone is logged false → true",
    starred?.old_value === "false" && starred?.new_value === "true", starred);
  check("…with its actor and surface",
    starred?.actor_id === actorId && starred?.source === "roster", starred);

  // ── 3. An UNWATCHED field ─────────────────────────────────────────────────
  const before = rows.length;
  await db.from("crew").update({ city: "Nowhere" }).eq("id", SENTINEL);
  rows = await log();
  check("a plain correction (city) writes no history row", rows.length === before, rows.length);

  // ── 4. Unsigned write — the out-of-app case ───────────────────────────────
  await db.from("crew").update({
    rehire: "never", last_actor_id: null, last_actor_source: null,
  }).eq("id", SENTINEL);
  rows = await log();
  const unsigned = rows.find((r) => r.field === "rehire");
  check("an unsigned write is still recorded, with a null actor",
    !!unsigned && unsigned.actor_id === null, unsigned);

  // ── 5. Two watched fields in ONE update — the ordering trap ───────────────
  //
  // Both rows carry an identical `changed_at`: the default is `now()`, which is
  // the TRANSACTION timestamp. `seq` is what gives them an order, and this is
  // the case that proves it — the first version of this table sorted on the
  // clock and returned its rows scrambled.
  await db.from("crew").update({
    rehire: "solid", notes: "second thoughts",
    last_actor_id: actorId, last_actor_source: "roster",
  }).eq("id", SENTINEL);
  const paired = (
    await db.from("crew_change_log")
      .select("seq, field, changed_at").eq("crew_id", SENTINEL)
      .in("field", ["rehire", "notes"]).order("seq")
  ).data as any[];
  const tied = paired.filter((r) => r.field === "notes" || r.seq > (unsigned?.seq ?? 0));
  check("two fields in one UPDATE both log", tied.length >= 2, tied);
  check("…share a changed_at exactly (so the clock cannot order them)",
    new Set(tied.map((r) => r.changed_at)).size === 1, tied.map((r) => r.changed_at));
  /**
   * `tied.length >= 2` is part of the assertion, not a precondition: without
   * it `[].every(…)` is `true` and this check passes on a completely dead
   * trigger. Caught by running the harness against a disabled trigger — the
   * negative test that a guard needs before it can be believed.
   */
  check("…and seq orders them anyway",
    tied.length >= 2 && tied.every((r, i) => i === 0 || r.seq > tied[i - 1].seq),
    tied.map((r) => r.seq));

  // ── 6. Cleanup, and the cascade ───────────────────────────────────────────
  await db.from("crew").delete().eq("id", SENTINEL);
  rows = await log();
  check("deleting the person takes their history with them", rows.length === 0, rows.length);

  console.log(
    failures === 0
      ? "\nPASS — the log records every judgement, ignores corrections, and orders correctly.\n"
      : `\nFAIL — ${failures} check(s) failed.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
