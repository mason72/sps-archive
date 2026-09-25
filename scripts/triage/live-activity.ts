/**
 * Pre-push check: is a REAL event live right now?
 *
 *   npx tsx scripts/triage/live-activity.ts
 *
 * Exit codes — gate on these, don't eyeball the text:
 *   0  quiet: no live-event uploads in the window, no live event dated today
 *   2  LIVE: a real (non-Pixieset) event has uploads in the window or is dated
 *      today ±1 day. Don't push without Mason's explicit go-ahead.
 *   1  the check itself failed. That is NOT "quiet" — the answer is unknown.
 *
 * "Real" vs migrated: the Pixieset ingest stamps `settings.pixiesetCollectionId`
 * on every event it creates, so those events' uploads are migration traffic
 * (thousands of rows an hour while it runs), not guests. On 2026-09-24 this
 * script printed "images uploaded in last 6h : null" mid-ingest: an exact count
 * over ~600k images hit the statement timeout and the error was never read.
 *
 * Two rules keep that from recurring:
 *   - every query goes through `must()`, which throws on `error` — a Supabase
 *     error is a return value, not a throw;
 *   - image queries are scoped to the live events' ids, so Postgres answers
 *     from idx_images_event_created (event_id, created_at) in ~40ms instead of
 *     scanning the whole table.
 */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local","utf8").split("\n")) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]]===undefined) process.env[m[1]]=m[2]; }

const WINDOW_HOURS = 6;
const SAMPLE = 1000; // rows fetched to attribute recent uploads to events

type Res<T> = { data: T | null; error: { message: string } | null; count?: number | null };

/** Unwrap a Supabase result or throw — a null here must never print as an answer. */
function must<T>(label: string, r: Res<T>): { data: T; count: number | null } {
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  if (r.data === null && r.count == null) throw new Error(`${label}: no data and no error`);
  return { data: r.data as T, count: r.count ?? null };
}

function localDate(offsetDays: number) {
  const d = new Date(Date.now() + offsetDays * 86400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 90 ? `${m}m ago` : `${(m / 60).toFixed(1)}h ago`;
}

async function main(){
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const since = new Date(Date.now() - WINDOW_HOURS*3600*1000).toISOString();

  type Ev = { id: string; name: string; event_date: string | null; settings: Record<string, unknown> | null };
  const { data: events } = must<Ev[]>("events", await db.from("events").select("id,name,event_date,settings"));
  if (events.length === 0) throw new Error("events: table returned 0 rows — refusing to call that quiet");
  const live = events.filter(e => !(e.settings && "pixiesetCollectionId" in e.settings));
  const name = new Map(events.map(e => [e.id, e.name]));
  const liveIds = live.map(e => e.id);

  // Uploads to live events in the window, newest first.
  type Img = { event_id: string; created_at: string };
  const { data: recent } = must<Img[]>("live uploads", await db.from("images")
    .select("event_id,created_at").in("event_id", liveIds).gte("created_at", since)
    .order("created_at", { ascending: false }).limit(SAMPLE));
  const perEvent = new Map<string, { n: number; last: string }>();
  for (const r of recent) {
    const p = perEvent.get(r.event_id);
    if (p) p.n++; else perEvent.set(r.event_id, { n: 1, last: r.created_at });
  }

  const { count: pending } = must("live pending", await db.from("images")
    .select("id", { count: "exact", head: true }).in("event_id", liveIds).eq("processing_status", "pending"));
  if (pending === null) throw new Error("live pending: count came back null");

  // Migration ingest, for context only — it never makes the verdict LIVE.
  const { data: migLatest } = must<{ created_at: string }[]>("latest upload", await db.from("images")
    .select("created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(1));

  const days = [localDate(-1), localDate(0), localDate(1)];
  const dated = live.filter(e => e.event_date && days.includes(e.event_date));

  const liveUploads = recent.length >= SAMPLE ? `${SAMPLE}+` : String(recent.length);
  console.log(`window                          : last ${WINDOW_HOURS}h (since ${since})`);
  console.log(`live events (non-Pixieset)      : ${live.length} of ${events.length}`);
  console.log(`live-event uploads in window    : ${liveUploads}`);
  for (const [id, p] of perEvent) console.log(`    ${name.get(id)} — ${p.n}${recent.length >= SAMPLE ? "+" : ""}, last ${ago(p.last)}`);
  console.log(`live-event images pending       : ${pending}`);
  console.log(`live events dated ${days[0]}..${days[2]}: ${dated.length}${dated.length ? " — " + dated.map(e => `${e.name} (${e.event_date})`).join(", ") : ""}`);
  console.log(`any upload in window (incl. migration): ${migLatest.length ? `yes, latest ${ago(migLatest[0].created_at)}` : "none"}`);

  const isLive = recent.length > 0 || dated.length > 0;
  console.log(isLive ? "\nVERDICT: LIVE — do not push without an explicit go-ahead." : "\nVERDICT: quiet");
  process.exit(isLive ? 2 : 0);
}
main().catch(e=>{console.error(`live-activity FAILED — the answer is unknown, not quiet:\n  ${e.message}`);process.exit(1)});
