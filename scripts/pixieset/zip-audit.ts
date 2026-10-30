/**
 * Prove, gallery by gallery, whether Pixeltrunk holds everything Pixieset does
 * (lesson 197), before Pixieset can be cancelled.
 *
 * 432 collections have more ZIP entries than archive rows. Most of that is the same
 * photo repeated in a Highlights set, which is correct; some may be versions the
 * old ingest dropped. Telling them apart by download would cost about 3 TB. It
 * costs almost nothing by reading each ZIP's table of contents (zip-central.ts).
 *
 * The extension (BYTE_AUDIT, v1.3.12) asks Pixieset to build each archive and,
 * instead of downloading it, drops `px-audit-<slug>.json` in ~/Downloads holding
 * the links. This reads the lists, runs them through the SAME identity and matching
 * code the ingest uses, and records one verdict per collection:
 *
 *   complete   every (name, bytes) in the archive has its row in the gallery
 *   elsewhere  what is absent here sits in another gallery (a twin-skipped shoot)
 *   missing    photos that exist ONLY on Pixieset: these need a re-pull
 *   unread     the list could not be read (ZIP64, expired link): needs a download
 *
 * `missing` can overstate. A file list has CRCs, not image data, so versions that
 * differ only in metadata (Kia at Dad 2.0's 491) read as missing here. The ingest
 * settles that once the ZIP is local (`mergeSameImage`), so the error costs one
 * download, never a photo.
 *
 *   npx tsx scripts/pixieset/zip-audit.ts            # process waiting beacons (launchd)
 *   npx tsx scripts/pixieset/zip-audit.ts --report   # print the tally, change nothing
 *
 * State: scripts/pixieset/data/zip-audit.json. A beacon holds live signed links, so
 * it is deleted as soon as its verdict is recorded. Links are never printed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { matchExisting, planEntries, type ExistingRow } from "./plan-entries";
import { retiredSince } from "./repull-list";
import { httpRangeReader, readZipEntries } from "./zip-central";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const STATE = path.join("scripts", "pixieset", "data", "zip-audit.json");
const QUEUE = path.join("scripts", "pixieset", "data", "queue.json");
const BACKGROUND = path.join("scripts", "pixieset", "extension", "background.js");
const DOWNLOADS = process.env.PIXIESET_DOWNLOADS || path.join(os.homedir(), "Downloads");
const STAGING = process.env.PIXIESET_STAGING || path.join(os.homedir(), "pixieset-staging");
const RETIRED = path.join(STAGING, "retired");
const MAX_TRIES = 4;
/** When the audit's requests began. An older refusal is an earlier pass of the migration. */
const AUDIT_STARTED_MS = Date.parse("2026-10-30T16:00:00Z");

export type Verdict = "complete" | "elsewhere" | "missing" | "unread";
type Result = {
  slug: string;
  id?: string;
  name?: string;
  eventId?: string | null;
  verdict: Verdict;
  photos?: number;
  rows?: number;
  absent?: number;
  elsewhere?: number;
  unmatched?: number;
  sample?: string[];
  gb?: number;
  error?: string;
  at: string;
};
type State = { createdAt: string; nagAt?: string; finishedMailAt?: string; tries?: Record<string, number>; results: Record<string, Result> };
type Col = { id: string; slug: string; name: string; state: string; eventId?: string | null };
type Beacon = { kind: string; slug: string; zips: { url: string; name?: string | null; size?: string | null }[]; at: string };

function readState(): State {
  return fs.existsSync(STATE)
    ? (JSON.parse(fs.readFileSync(STATE, "utf8")) as State)
    : { createdAt: new Date().toISOString(), results: {} };
}
function writeState(s: State) {
  const tmp = `${STATE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 1) + "\n");
  fs.renameSync(tmp, STATE);
}

/** The list lives in the extension; both ends read that one copy. */
function auditSlugs(): string[] {
  const block = fs.readFileSync(BACKGROUND, "utf8").match(/const BYTE_AUDIT = \[([\s\S]*?)\];/);
  if (!block) throw new Error("BYTE_AUDIT not found in background.js");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

async function send(subject: string, body: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const to = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!key || !from || !to.length) {
    console.error(`CANNOT SEND: key=${!!key} from=${!!from} recipients=${to.length}`);
    process.exitCode = 1;
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `Pixeltrunk Migration <${from}>`, to, subject, text: body }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error(`email failed (retried next run): ${String(err)}`);
    process.exitCode = 1;
    return false;
  }
  console.log(`emailed: ${subject}`);
  return true;
}

async function auditOne(beacon: Beacon, col: Col | undefined): Promise<Result> {
  const { createClient } = await import("@supabase/supabase-js");
  const { getObjectBuffer } = await import("../../src/lib/r2/client");
  const zlib = await import("node:zlib");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const base = { slug: beacon.slug, id: col?.id, name: col?.name?.trim(), eventId: col?.eventId ?? null, at: new Date().toISOString() };

  const byZip = [];
  for (const z of beacon.zips) byZip.push({ zipPath: z.name ?? "part", entries: await readZipEntries(httpRangeReader(z.url)) });
  const { photos, groups } = planEntries(byZip);

  const rows: ExistingRow[] = [];
  if (col?.eventId) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb
        .from("images")
        .select("id,original_filename,file_size,r2_key")
        .eq("event_id", col.eventId)
        .eq("is_cover_upload", false)
        .order("id", { ascending: true })
        .range(from, from + 999);
      if (error) throw error;
      rows.push(...((data ?? []) as ExistingRow[]));
      if ((data ?? []).length < 1000) break;
    }
  }
  const match = await matchExisting(groups, rows, async (row) => {
    const buf = await getObjectBuffer(row.r2_key);
    return { crc: zlib.crc32(buf), size: buf.byteLength };
  });

  // Absent here: is the same (name, size) in any other gallery? A twin-skipped shoot
  // keeps its frames in the event that already held them, which is not a loss.
  let elsewhere = 0;
  const onlyOnPixieset: string[] = [];
  for (let i = 0; i < match.todo.length; i += 100) {
    const chunk = match.todo.slice(i, i + 100);
    const { data, error } = await sb
      .from("images")
      .select("original_filename,file_size")
      .in("original_filename", [...new Set(chunk.map((p) => p.base))])
      .eq("is_cover_upload", false)
      .neq("event_id", col?.eventId ?? "00000000-0000-0000-0000-000000000000");
    if (error) throw error;
    const held = new Set((data ?? []).map((r) => `${r.original_filename}|${r.file_size}`));
    for (const p of chunk) {
      if (held.has(`${p.base}|${p.size}`)) elsewhere++;
      else onlyOnPixieset.push(p.base);
    }
  }
  const verdict: Verdict = onlyOnPixieset.length || match.unmatched.length ? "missing" : match.todo.length ? "elsewhere" : "complete";
  return {
    ...base,
    verdict,
    photos: photos.size,
    rows: rows.length,
    absent: onlyOnPixieset.length,
    elsewhere,
    unmatched: match.unmatched.length,
    sample: [...onlyOnPixieset, ...match.unmatched.map((u) => u.base)].slice(0, 5),
  };
}

function tally(state: State, list: string[]) {
  const results = Object.values(state.results);
  const count = (v: Verdict) => results.filter((r) => r.verdict === v).length;
  const retired = list.filter((slug) => !state.results[slug] && retiredSince(RETIRED, slug, AUDIT_STARTED_MS).length);
  const waiting = list.filter((slug) => !state.results[slug] && !retired.includes(slug));
  return { complete: count("complete"), elsewhere: count("elsewhere"), missing: count("missing"), unread: count("unread"), retired, waiting };
}

function summary(state: State, list: string[]) {
  const t = tally(state, list);
  const bad = Object.values(state.results).filter((r) => r.verdict === "missing" || r.verdict === "unread");
  return (
    `${list.length} collections: ${t.complete} complete, ${t.elsewhere} held in another gallery, ${t.missing} with photos only on Pixieset, ` +
    `${t.unread} unread, ${t.retired.length} refused by Pixieset, ${t.waiting.length} waiting.\n\n` +
    bad.map((r) => `${r.verdict.toUpperCase()} ${r.name ?? r.slug}  ${r.error ?? `${r.absent} absent, ${r.unmatched} unmatched: ${(r.sample ?? []).join(", ")}`}`).join("\n") +
    (t.retired.length ? `\n\nRefused by Pixieset (see ~/pixieset-staging/retired):\n${t.retired.join("\n")}` : "") +
    (t.waiting.length && t.waiting.length <= 40 ? `\n\nStill waiting (a password gate defers without telling anyone):\n${t.waiting.join("\n")}` : "")
  );
}

async function main() {
  console.log(`=== zip audit · ${new Date().toISOString()} ===`); // the heartbeat stall-check watches
  const list = auditSlugs();
  const state = readState();
  if (process.argv.includes("--report")) return console.log(summary(state, list));

  const beacons = fs.existsSync(DOWNLOADS) ? fs.readdirSync(DOWNLOADS).filter((f) => /^px-audit-.*\.json$/.test(f)) : [];
  if (!beacons.length && !Object.keys(state.results).length) return;
  const queue = JSON.parse(fs.readFileSync(QUEUE, "utf8")) as { collections: Record<string, Col> };
  const bySlug = new Map(Object.values(queue.collections).map((c) => [c.slug, c]));

  for (const f of beacons) {
    const p = path.join(DOWNLOADS, f);
    let beacon: Beacon;
    try {
      beacon = JSON.parse(fs.readFileSync(p, "utf8")) as Beacon;
      if (beacon.kind !== "px-audit" || !beacon.slug || !beacon.zips?.length) throw new Error("not an audit beacon");
    } catch (err) {
      console.error(`${f}: unreadable (${String(err)}), left in place`);
      process.exitCode = 1;
      continue;
    }
    const good = state.results[beacon.slug];
    if (good && good.verdict !== "unread") {
      fs.rmSync(p, { force: true }); // a " (1)" copy of one already answered
      continue;
    }
    let result: Result;
    try {
      result = await auditOne(beacon, bySlug.get(beacon.slug));
    } catch (err) {
      // Never the link: fetch errors can quote it.
      const msg = String((err as Error)?.message ?? err).replace(/https?:\/\/\S+/g, "<link>").slice(0, 200);
      // A database or network blip. The beacon stays, because getting it back means
      // asking Pixieset to build the archive again. Five minutes between tries.
      const tries = (state.tries?.[beacon.slug] ?? 0) + 1;
      state.tries = { ...state.tries, [beacon.slug]: tries };
      writeState(state);
      if (tries < MAX_TRIES) {
        console.log(`${new Date().toISOString()} retry ${tries}/${MAX_TRIES}  ${beacon.slug}: ${msg}`);
        continue;
      }
      result = { slug: beacon.slug, verdict: "unread", error: msg, name: bySlug.get(beacon.slug)?.name?.trim(), at: new Date().toISOString() };
    }
    state.results[beacon.slug] = result;
    writeState(state);
    fs.rmSync(p, { force: true });
    console.log(`${new Date().toISOString()} ${result.verdict.padEnd(9)} ${beacon.slug}  photos ${result.photos ?? "?"} · rows ${result.rows ?? "?"} · only on Pixieset ${result.absent ?? "?"} · elsewhere ${result.elsewhere ?? "?"} · unmatched ${result.unmatched ?? "?"}${result.error ? ` · ${result.error}` : ""}`);
  }

  const t = tally(state, list);
  const newest = Math.max(Date.parse(state.createdAt), ...Object.values(state.results).map((r) => Date.parse(r.at)));
  const day = 86_400_000;
  if (t.waiting.length && Date.now() - newest > day && (!state.nagAt || Date.now() - Date.parse(state.nagAt) > day)) {
    if (await send(`Pixieset file-list audit has stalled: ${t.waiting.length} waiting, nothing new in a day`, summary(state, list))) {
      state.nagAt = new Date().toISOString();
      writeState(state);
    }
  }
  if (!t.waiting.length && !state.finishedMailAt) {
    if (await send(`Pixieset file-list audit finished: ${t.missing} with photos only on Pixieset`, summary(state, list))) {
      state.finishedMailAt = new Date().toISOString();
      writeState(state);
    }
  }
}

main().catch((err) => {
  console.error(String(err?.message ?? err).replace(/https?:\/\/\S+/g, "<link>"));
  process.exit(1);
});
