/**
 * Pre-push check: is a REAL event live right now?
 *
 *   npx tsx scripts/triage/live-activity.ts [--hours N]
 *
 * Exit codes — gate on these, don't eyeball the text:
 *   0  quiet: nobody uploading, no live event dated today, no SPS pull running
 *   2  LIVE: a real (non-Pixieset) event has a person's uploads in the window,
 *      or is dated today ±1 day, or an SPS pull is queued or running. The
 *      verdict line says which. Don't push without Mason's explicit go-ahead.
 *   1  the check itself failed. That is NOT "quiet" — the answer is unknown.
 *
 * SPS pulls are named separately (2026-10-04, lesson 176). A pull IN FLIGHT
 * gates the push, because a deploy kills the step it is running. The rows a
 * pull has already LANDED do not: they are an importer's work, not a person
 * uploading, and counting them made this read LIVE for six hours after every
 * import, about an import that had finished. They print on their own line.
 * The verdict itself is `liveVerdict()` in src/lib/monitoring/live-activity.ts,
 * where it is tested.
 *
 * `--hours N` widens the window. It exists to prove the check can still say
 * LIVE: `--hours 2000` must exit 2 and name a real event's uploads.
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

const hoursFlag = process.argv.indexOf("--hours");
const WINDOW_HOURS = hoursFlag !== -1 ? Number(process.argv[hoursFlag + 1]) : 6;
if (!Number.isFinite(WINDOW_HOURS) || WINDOW_HOURS <= 0) {
  console.error("live-activity FAILED — --hours takes a positive number");
  process.exit(1);
}
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
  const { liveVerdict } = await import("../../src/lib/monitoring/live-activity");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const since = new Date(Date.now() - WINDOW_HOURS*3600*1000).toISOString();

  type Ev = { id: string; name: string; event_date: string | null; settings: Record<string, unknown> | null };
  const { data: events } = must<Ev[]>("events", await db.from("events").select("id,name,event_date,settings"));
  if (events.length === 0) throw new Error("events: table returned 0 rows — refusing to call that quiet");
  const live = events.filter(e => !(e.settings && "pixiesetCollectionId" in e.settings));
  const name = new Map(events.map(e => [e.id, e.name]));
  const liveIds = live.map(e => e.id);

  // Rows landed in live events in the window, newest first, as TWO questions.
  // Each gets its own sample: one combined read capped at SAMPLE would let a
  // 5,000-photo pull crowd a person's uploads out of the rows it returned, and
  // the check would say quiet.
  type Img = { event_id: string; created_at: string };
  const tally = (rows: Img[]) => {
    const per = new Map<string, { n: number; last: string }>();
    for (const r of rows) {
      const p = per.get(r.event_id);
      if (p) p.n++; else per.set(r.event_id, { n: 1, last: r.created_at });
    }
    return per;
  };
  const windowed = () => db.from("images")
    .select("event_id,created_at").in("event_id", liveIds).gte("created_at", since)
    .order("created_at", { ascending: false }).limit(SAMPLE);

  // A person uploading: no SPS id on the row.
  const { data: recent } = must<Img[]>("live uploads", await windowed().is("sps_image_id", null));
  const perEvent = tally(recent);

  // Landed by an SPS pull: counted and shown, never part of the verdict.
  const { data: pulled } = must<Img[]>("pulled rows", await windowed().not("sps_image_id", "is", null));
  const perPulled = tally(pulled);

  // Pulls running right now. These DO gate: a deploy kills the step in flight.
  type Pull = { sps_event_name: string | null; event_id: string; status: string; images_done: number; expected_total: number | null; updated_at: string };
  const { data: pulls } = must<Pull[]>("pulls in flight", await db.from("sps_pull_jobs")
    .select("sps_event_name,event_id,status,images_done,expected_total,updated_at")
    .in("status", ["queued", "running"]));

  const { count: pending } = must("live pending", await db.from("images")
    .select("id", { count: "exact", head: true }).in("event_id", liveIds).eq("processing_status", "pending"));
  if (pending === null) throw new Error("live pending: count came back null");

  // Migration ingest, for context only — it never makes the verdict LIVE.
  const { data: migLatest } = must<{ created_at: string }[]>("latest upload", await db.from("images")
    .select("created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(1));

  const days = [localDate(-1), localDate(0), localDate(1)];
  const dated = live.filter(e => e.event_date && days.includes(e.event_date));

  const shown = (rows: Img[]) => (rows.length >= SAMPLE ? `${SAMPLE}+` : String(rows.length));
  const lines = (per: Map<string, { n: number; last: string }>, capped: boolean) => {
    for (const [id, p] of per) console.log(`    ${name.get(id)} — ${p.n}${capped ? "+" : ""}, last ${ago(p.last)}`);
  };
  console.log(`window                          : last ${WINDOW_HOURS}h (since ${since})`);
  console.log(`live events (non-Pixieset)      : ${live.length} of ${events.length}`);
  console.log(`live-event uploads in window    : ${shown(recent)}`);
  lines(perEvent, recent.length >= SAMPLE);
  console.log(`rows landed by SPS pulls        : ${shown(pulled)}${pulled.length ? " (an import's work, not counted as live)" : ""}`);
  lines(perPulled, pulled.length >= SAMPLE);
  console.log(`SPS pulls in flight             : ${pulls.length}`);
  for (const p of pulls) {
    console.log(`    ${p.sps_event_name ?? name.get(p.event_id) ?? p.event_id} — ${p.status}, ${p.images_done}${p.expected_total ? ` of ${p.expected_total}` : ""}, moved ${ago(p.updated_at)}`);
  }
  console.log(`live-event images pending       : ${pending}`);
  console.log(`live events dated ${days[0]}..${days[2]}: ${dated.length}${dated.length ? " — " + dated.map(e => `${e.name} (${e.event_date})`).join(", ") : ""}`);
  console.log(`any upload in window (incl. migration): ${migLatest.length ? `yes, latest ${ago(migLatest[0].created_at)}` : "none"}`);

  const verdict = liveVerdict({
    uploads: [...perEvent].map(([id, p]) => ({ name: name.get(id) ?? id, count: p.n })),
    uploadsCapped: recent.length >= SAMPLE,
    dated: dated.map(e => ({ name: e.name, date: e.event_date as string })),
    pullsInFlight: pulls.map(p => ({ name: p.sps_event_name ?? name.get(p.event_id) ?? p.event_id, status: p.status })),
  });
  if (verdict.live) {
    console.log("\nVERDICT: LIVE — do not push without an explicit go-ahead.");
    for (const r of verdict.reasons) console.log(`  because: ${r}`);
  } else {
    console.log("\nVERDICT: quiet");
  }
  process.exit(verdict.live ? 2 : 0);
}
main().catch(e=>{console.error(`live-activity FAILED — the answer is unknown, not quiet:\n  ${e.message}`);process.exit(1)});
