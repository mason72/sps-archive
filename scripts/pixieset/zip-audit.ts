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
 *   metadata   what is absent differs from a stored photo only in metadata
 *   missing    photos that exist ONLY on Pixieset: these need a re-pull
 *   unread     the list could not be read (ZIP64, expired link): needs a download
 *
 * Version 2 (2026-11-02) looks past the file list in three places, because the
 * first 183 verdicts flagged 26,849 photos and most of that was not loss:
 *   - A gallery deleted as a duplicate (NASAI, Appfolio Goleta: a copy of a
 *     gallery delivered from Pixeltrunk) leaves its frames in the KEPT gallery
 *     under names with spaces, which Pixieset's ZIP drops. A few photos' EXIF,
 *     read by Range, name that gallery by capture second + exact bytes (the rule
 *     twin-skip.ts uses); its rows then match by size and the name without spaces.
 *   - DAIS was consolidated onto its SPS copy by Mason (camera originals, other
 *     bytes, same names): KEPT_BY_DECISION matches it by name alone.
 *   - A flagged photo that shares its name with a stored one is either a real
 *     version (BW, retouched) or the same picture with other metadata (Kia at
 *     Dad 2.0's 491). The file list cannot say which, so a few per gallery are
 *     read by Range and compared on image data (`jpegImageHash`). Size is the
 *     cheap signal for the rest: metadata-only copies differ by about 100 bytes.
 * The reads cost a few photos per gallery, not the archive.
 *
 *   npx tsx scripts/pixieset/zip-audit.ts            # process waiting beacons (launchd)
 *   npx tsx scripts/pixieset/zip-audit.ts --report   # print the tally, change nothing
 *   npx tsx scripts/pixieset/zip-audit.ts --check    # audit the waiting beacons, print, record and delete nothing
 *
 * State: scripts/pixieset/data/zip-audit.json. A beacon holds live signed links, so
 * it is deleted as soon as its verdict is recorded. Links are never printed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { jpegImageHash, matchExisting, planEntries, type ExistingRow, type PlannedPhoto } from "./plan-entries";
import { retiredSince } from "./repull-list";
import { frameKeys, type TwinExif } from "./twin-skip";
import { httpRangeReader, readEntryBytes, readZipEntries, type CentralEntry, type RangeReader } from "./zip-central";

function loadEnv() {
  for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
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
/** A result from an older version that flagged photos is read again (see the header). */
export const AUDIT_VERSION = 2;
/** Same name, sizes this close: probably the same picture with other metadata (Kia: ~110 bytes). */
export const NEAR_BYTES = 1024;
/**
 * Flagged photos read and compared per gallery: at least one near one from every
 * set (a 20-photo "With Logo" set hidden among 491 metadata copies must be read),
 * up to NEAR_CAP; then a couple of far ones.
 */
const NEAR_SAMPLES = 4;
const NEAR_CAP = 12;
const FAR_SAMPLES = 2;
/** Photos whose EXIF is read to find the gallery a deleted copy's frames live in. */
const TWIN_PROBES = 8;
const TWIN_SHARE = 0.6;
const EXIF_PREFIX = 256 * 1024;

/**
 * Copies whose frames Mason chose to keep in another gallery, in OTHER bytes, so
 * neither bytes nor capture-second twins can find them. Matched by name alone.
 */
export const KEPT_BY_DECISION: Record<string, { eventId: string; why: string }> = {
  googleclouddais2026: {
    eventId: "f2fe3441-9f6c-4429-b8d1-e6a58be9fbb0",
    why: "consolidated onto the SPS camera originals 2026-09-02 (memory dais-consolidated)",
  },
};

/** "Abby Main_26-08-05_Appfolio_367.jpg" and Pixieset's "AbbyMain_26-08-05_Appfolio_367.jpg" are one name. */
export const looseName = (name: string) => name.normalize("NFC").toLowerCase().replace(/\s+/g, "");

export type Verdict = "complete" | "elsewhere" | "metadata" | "missing" | "unread";
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
  /** Version 2. Absent photos split by shape; `absent` is their sum. */
  v?: number;
  versions?: number;
  near?: number;
  newNames?: number;
  twins?: number;
  twinGallery?: string;
  kept?: number;
  sampled?: number;
  sameImage?: number;
  sample?: string[];
  gb?: number;
  error?: string;
  at: string;
};
export type State = { createdAt: string; nagAt?: string; finishedMailAt?: string; tries?: Record<string, number>; results: Record<string, Result> };
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
  const located = new Map<string, { read: RangeReader; e: CentralEntry }[]>();
  for (const [i, z] of beacon.zips.entries()) {
    const read = httpRangeReader(z.url);
    const zipPath = `${i}:${z.name ?? "part"}`;
    const entries = await readZipEntries(read);
    for (const e of entries) {
      const k = `${zipPath}\u0000${e.entry}`;
      located.set(k, [...(located.get(k) ?? []), { read, e }]);
    }
    byZip.push({ zipPath, entries });
  }
  const { photos, groups } = planEntries(byZip);
  // By path AND the bytes' fingerprint: one ZIP can hold two entries at one path,
  // and the CRC check in readEntryBytes only proves the entry it was handed.
  const bytesOf = (p: PlannedPhoto, prefix?: number) => {
    const at = (located.get(`${p.zipPath}\u0000${p.entry}`) ?? []).find(({ e }) => e.crc >>> 0 === p.crc >>> 0 && e.size === p.size);
    if (!at) throw new Error(`${p.base}: not in the file list with these bytes`);
    return readEntryBytes(at.read, at.e, prefix);
  };

  const rows = col?.eventId ? await eventRows(sb, col.eventId) : [];
  const match = await matchExisting(groups, rows, async (row) => {
    const buf = await getObjectBuffer(row.r2_key);
    return { crc: zlib.crc32(buf), size: buf.byteLength };
  });

  // Absent here: is the same (name, size) in any other gallery? A twin-skipped shoot
  // keeps its frames in the event that already held them, which is not a loss.
  // One stored row stands for one photo, across EVERY way of being held below:
  // a row "elsewhere" has claimed cannot be claimed again by DAIS or a twin.
  const ledger = new RowLedger();
  const otherRows: { id: string; original_filename: string | null; file_size: number | null }[] = [];
  const names = [...new Set(match.todo.map((p) => p.base))];
  for (let i = 0; i < names.length; i += 100) {
    const { data, error } = await sb
      .from("images")
      .select("id,original_filename,file_size")
      .in("original_filename", names.slice(i, i + 100))
      .eq("is_cover_upload", false)
      .eq("processing_status", "complete")
      .neq("event_id", col?.eventId ?? "00000000-0000-0000-0000-000000000000");
    if (error) throw error;
    otherRows.push(...(data ?? []));
  }
  const held = ledger.index(otherRows, (r) => `${r.original_filename}|${r.file_size}`);
  let elsewhere = 0;
  let absent: PlannedPhoto[] = [];
  for (const p of match.todo) {
    if (held(`${p.base}|${p.size}`)) elsewhere++;
    else absent.push(p);
  }

  // Kept elsewhere by Mason's decision, in other bytes: by name alone, one photo
  // per row, so a BW and a color version under one name need two rows.
  let kept = 0;
  const decision = KEPT_BY_DECISION[beacon.slug];
  if (decision && absent.length) {
    const keptBy = ledger.index(await eventRows(sb, decision.eventId), (r) => looseName(r.original_filename ?? ""));
    const before = absent.length;
    absent = absent.filter((p) => !keptBy(looseName(p.base)));
    kept = before - absent.length;
  }

  const ownByName = new Map<string, ExistingRow[]>();
  for (const r of rows) if (r.original_filename) ownByName.set(r.original_filename.normalize("NFC"), [...(ownByName.get(r.original_filename.normalize("NFC")) ?? []), r]);
  const sameName = absent.filter((p) => ownByName.has(p.base));
  let newName = absent.filter((p) => !ownByName.has(p.base));

  // New names: a deleted duplicate's frames, kept in the gallery it duplicated?
  let twins = 0;
  let twinGallery: string | undefined;
  if (newName.length) {
    const twin = await findTwinGallery(sb, newName, col?.eventId ?? null, (p) => bytesOf(p, EXIF_PREFIX));
    if (twin) {
      const bySize = new Map<number, ExistingRow[]>();
      for (const r of await eventRows(sb, twin.id)) {
        if (r.file_size != null && r.original_filename) bySize.set(r.file_size, [...(bySize.get(r.file_size) ?? []), r]);
      }
      const isTwin = (p: PlannedPhoto) => {
        const row = (bySize.get(p.size) ?? []).find(
          (r) => !ledger.used(r.id) && (looseName(r.original_filename!) === looseName(p.base) || frameNumber(r.original_filename!) === frameNumber(p.base)),
        );
        return row ? ledger.take(row.id) : false;
      };
      const before = newName.length;
      newName = newName.filter((p) => !isTwin(p));
      twins = before - newName.length;
      if (twins) twinGallery = twin.name;
    }
  }

  // Same name, other bytes: a version, or the same picture with other metadata?
  const delta = (p: PlannedPhoto) => Math.min(...(ownByName.get(p.base) ?? []).map((r) => (r.file_size == null ? Infinity : Math.abs(r.file_size - p.size))));
  const near = sameName.filter((p) => delta(p) <= NEAR_BYTES);
  const far = sameName.filter((p) => delta(p) > NEAR_BYTES);
  let sampled = 0;
  let sameImage = 0;
  let nearDifferent = 0;
  const nearPick = nearSample(near);
  for (const [list, isNear] of [[nearPick.list, true], [spread(far, FAR_SAMPLES), false]] as const) {
    for (const p of list) {
      const mine = jpegImageHash(await bytesOf(p));
      let same = false;
      for (const r of ownByName.get(p.base) ?? []) if (jpegImageHash(await getObjectBuffer(r.r2_key)) === mine) same = true;
      sampled++;
      if (same) sameImage++;
      else if (isNear) nearDifferent++;
    }
  }

  const { verdict, versions, nearLeft, onlyHere } = decide({
    todo: match.todo.length, unmatched: match.unmatched.length, far: far.length, near: near.length,
    newNames: newName.length, sampled, sameImage, nearDifferent, setsLeft: nearPick.setsLeft,
  });
  return {
    ...base,
    v: AUDIT_VERSION,
    verdict,
    photos: photos.size,
    rows: rows.length,
    absent: onlyHere,
    elsewhere,
    unmatched: match.unmatched.length,
    versions,
    near: nearLeft,
    newNames: newName.length,
    twins,
    twinGallery,
    kept,
    sampled,
    sameImage,
    sample: [...far, ...newName, ...near, ...match.unmatched.map((u) => ({ base: u.base }))].map((p) => p.base).slice(0, 5),
  };
}

async function eventRows(sb: ReturnType<typeof import("@supabase/supabase-js").createClient>, eventId: string) {
  const out: ExistingRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("images")
      .select("id,original_filename,file_size,r2_key")
      .eq("event_id", eventId)
      .eq("is_cover_upload", false)
      // A pending row's bytes may never have arrived (the eBay and HDC ghosts):
      // it must not stand in for a photo that exists only on Pixieset.
      .eq("processing_status", "complete")
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as ExistingRow[]));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

/**
 * The verdict, from the counts alone. Near photos are versions once any sampled
 * near one proved a different picture; "metadata" needs every photo read to have
 * been the same picture, and at least one read. Anything else flagged is missing.
 */
export function decide(c: {
  todo: number; unmatched: number; far: number; near: number; newNames: number;
  sampled: number; sameImage: number; nearDifferent: number; setsLeft?: number;
}): { verdict: Verdict; versions: number; nearLeft: number; onlyHere: number } {
  const versions = c.far + (c.nearDifferent ? c.near : 0);
  const nearLeft = c.nearDifferent ? 0 : c.near;
  const onlyHere = versions + nearLeft + c.newNames;
  const verdict: Verdict =
    c.unmatched || versions || c.newNames ? "missing"
    : nearLeft ? (c.sampled && c.sameImage === c.sampled && !c.setsLeft ? "metadata" : "missing")
    : c.todo ? "elsewhere" : "complete";
  return { verdict, versions, nearLeft, onlyHere };
}

/**
 * At least one near photo from every set, then spread to NEAR_SAMPLES. Never more
 * than NEAR_CAP reads: `setsLeft` counts the sets that got none, and any left
 * means the gallery cannot be called metadata.
 */
export function nearSample<T extends { sets: string[] }>(near: readonly T[]): { list: T[]; setsLeft: number } {
  const bySet = new Map<string, T>();
  for (const p of near) if (!bySet.has(p.sets.join("|"))) bySet.set(p.sets.join("|"), p);
  const list = [...bySet.values()].slice(0, NEAR_CAP);
  for (const p of spread(near, NEAR_SAMPLES)) {
    if (list.length >= Math.min(NEAR_SAMPLES, near.length) && list.length >= bySet.size) break;
    if (list.length < NEAR_CAP && !list.includes(p)) list.push(p);
  }
  return { list, setsLeft: Math.max(0, bySet.size - NEAR_CAP) };
}

/** Which stored rows already stand for a photo. Shared by every matcher in one audit. */
export class RowLedger {
  private taken = new Set<string>();
  used(id: string) {
    return this.taken.has(id);
  }
  take(id: string) {
    this.taken.add(id);
    return true;
  }
  /** A matcher over `rows` by `key`: yes once per row not yet taken, and takes it. */
  index<R extends { id: string }>(rows: Iterable<R>, key: (r: R) => string): (k: string) => boolean {
    const byKey = new Map<string, string[]>();
    for (const r of rows) byKey.set(key(r), [...(byKey.get(key(r)) ?? []), r.id]);
    return (k) => {
      const id = (byKey.get(k) ?? []).find((x) => !this.taken.has(x));
      return id ? this.take(id) : false;
    };
  }
}

/** `n` items spread across `list`, so a sample is not just its first few. */
export function spread<T>(list: readonly T[], n: number): T[] {
  if (list.length <= n) return [...list];
  return Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)]);
}

/** The last run of digits before the extension: a camera's frame number. */
export const frameNumber = (name: string) => name.match(/(\d+)\.[a-z]+$/i)?.[1] ?? name;

/**
 * The gallery that already holds most of these photos, by capture second + exact
 * bytes (twin-skip.ts's rule), read from a few photos' EXIF. Null when no gallery
 * holds TWIN_SHARE of the probes: then nothing is called a twin.
 */
async function findTwinGallery(
  sb: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  candidates: PlannedPhoto[],
  ownEventId: string | null,
  head: (p: PlannedPhoto) => Promise<Buffer>,
): Promise<{ id: string; name: string } | null> {
  const { extractExif } = await import("../../src/lib/upload/parse-filename");
  const keysByProbe = new Map<string, string[]>();
  for (const p of spread(candidates, TWIN_PROBES)) {
    try {
      const buf = await head(p);
      const exif = (await extractExif(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)) as TwinExif;
      const keys = frameKeys(exif, p.size);
      if (keys.length) keysByProbe.set(p.base, keys);
    } catch {
      // A probe that cannot be read finds nothing; it never makes a twin.
    }
  }
  if (!keysByProbe.size) return null;
  const times = [...new Set([...keysByProbe.values()].flat().map((k) => k.split("|")[0]))];
  const { data, error } = await sb
    .from("images")
    .select("event_id, taken_at, file_size, events!images_event_id_fkey!inner(name)")
    .in("taken_at", times)
    .limit(2000);
  if (error) throw error;
  const hits = new Map<string, { name: string; probes: Set<string> }>();
  for (const r of data ?? []) {
    if (!r.taken_at || r.file_size == null || r.event_id === ownEventId) continue;
    const key = `${new Date(r.taken_at).toISOString()}|${r.file_size}`;
    for (const [base, keys] of keysByProbe) {
      if (!keys.includes(key)) continue;
      const cur = hits.get(r.event_id) ?? { name: (r.events as unknown as { name: string }).name, probes: new Set<string>() };
      cur.probes.add(base);
      hits.set(r.event_id, cur);
    }
  }
  const best = [...hits.entries()].sort((a, b) => b[1].probes.size - a[1].probes.size)[0];
  return best && best[1].probes.size / keysByProbe.size >= TWIN_SHARE ? { id: best[0], name: best[1].name } : null;
}

/** A verdict worth keeping. An older version's flags are read again, so they wait. */
export function settled(r: Result | undefined): r is Result {
  return !!r && (r.v === AUDIT_VERSION || r.verdict === "complete" || r.verdict === "elsewhere");
}

/**
 * The verdicts that count. An old flag waiting for its re-read is left out until
 * the new one lands, EXCEPT when Pixieset refused the re-read: then the old flag
 * is all there is, and dropping it would shrink the cancel decision's count.
 */
function counted(state: State): Result[] {
  return Object.values(state.results).filter((r) => settled(r) || retiredSince(RETIRED, r.slug, Date.parse(r.at)).length);
}

export function tally(state: State, list: string[]) {
  const results = counted(state);
  const count = (v: Verdict) => results.filter((r) => r.verdict === v).length;
  // A refused re-read with an old verdict is counted under that verdict, not here.
  const retired = list.filter((slug) => !state.results[slug] && retiredSince(RETIRED, slug, AUDIT_STARTED_MS).length);
  const inCount = new Set(results.map((r) => r.slug));
  const waiting = list.filter((slug) => !inCount.has(slug) && !retired.includes(slug));
  const reread = waiting.filter((slug) => state.results[slug]).length;
  return { complete: count("complete"), elsewhere: count("elsewhere"), metadata: count("metadata"), missing: count("missing"), unread: count("unread"), retired, waiting, reread };
}

function line(r: Result): string {
  if (r.error) return `${r.verdict.toUpperCase()} ${r.name ?? r.slug}  ${r.error}`;
  const parts = [
    r.versions && `${r.versions} versions`,
    r.newNames && `${r.newNames} new names`,
    r.near && `${r.near} near-identical`,
    r.unmatched && `${r.unmatched} unmatched`,
  ].filter(Boolean);
  const checks = [
    r.sampled && `${r.sameImage}/${r.sampled} read were the same picture`,
    r.twins && `${r.twins} kept in "${r.twinGallery}"`,
    r.kept && `${r.kept} kept by decision`,
  ].filter(Boolean);
  const old = r.v === AUDIT_VERSION ? "" : " (version 1, not read again)";
  return `${r.verdict.toUpperCase()}${old} ${r.name ?? r.slug}  ${r.v === AUDIT_VERSION ? parts.join(", ") || "nothing" : `${r.absent} absent, ${r.unmatched ?? 0} unmatched`}${checks.length ? ` (${checks.join("; ")})` : ""}: ${(r.sample ?? []).join(", ")}`;
}

function summary(state: State, list: string[]) {
  const t = tally(state, list);
  const shown = counted(state).filter((r) => ["missing", "unread", "metadata"].includes(r.verdict));
  const owed = shown.filter((r) => r.verdict === "missing").reduce((n, r) => n + (r.absent ?? 0), 0);
  return (
    `${list.length} collections: ${t.complete} complete, ${t.elsewhere} held in another gallery, ${t.metadata} differ only in metadata, ` +
    `${t.missing} with photos only on Pixieset (${owed} photos), ` +
    `${t.unread} unread, ${t.retired.length} refused by Pixieset, ${t.waiting.length} waiting (${t.reread} of them to be read again).\n\n` +
    shown.sort((a, b) => (b.absent ?? 0) - (a.absent ?? 0)).map(line).join("\n") +
    (t.retired.length ? `\n\nRefused by Pixieset (see ~/pixieset-staging/retired):\n${t.retired.join("\n")}` : "") +
    (t.waiting.length && t.waiting.length <= 40 ? `\n\nStill waiting (a password gate defers without telling anyone):\n${t.waiting.join("\n")}` : "")
  );
}

async function main() {
  loadEnv();
  console.log(`=== zip audit · ${new Date().toISOString()} ===`); // the heartbeat stall-check watches
  const list = auditSlugs();
  const state = readState();
  if (process.argv.includes("--report")) return console.log(summary(state, list));

  const beacons = fs.existsSync(DOWNLOADS) ? fs.readdirSync(DOWNLOADS).filter((f) => /^px-audit-.*\.json$/.test(f)) : [];
  if (!beacons.length && !Object.keys(state.results).length) return;
  const queue = JSON.parse(fs.readFileSync(QUEUE, "utf8")) as { collections: Record<string, Col> };
  const bySlug = new Map(Object.values(queue.collections).map((c) => [c.slug, c]));

  if (process.argv.includes("--check")) {
    for (const f of beacons) {
      const beacon = JSON.parse(fs.readFileSync(path.join(DOWNLOADS, f), "utf8")) as Beacon;
      const started = Date.now();
      const result = await auditOne(beacon, bySlug.get(beacon.slug));
      console.log(`${line(result)}\n${JSON.stringify(result)}\n${((Date.now() - started) / 1000).toFixed(1)} s`);
    }
    return;
  }

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
    if (settled(good) && good.verdict !== "unread") {
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
      // Keyed by version: a v1 slug that spent its tries gets fresh ones on its re-read.
      const tryKey = `v${AUDIT_VERSION}:${beacon.slug}`;
      const tries = (state.tries?.[tryKey] ?? 0) + 1;
      state.tries = { ...state.tries, [tryKey]: tries };
      writeState(state);
      if (tries < MAX_TRIES) {
        console.log(`${new Date().toISOString()} retry ${tries}/${MAX_TRIES}  ${beacon.slug}: ${msg}`);
        continue;
      }
      result = { slug: beacon.slug, v: AUDIT_VERSION, verdict: "unread", error: msg, name: bySlug.get(beacon.slug)?.name?.trim(), at: new Date().toISOString() };
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

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(String(err?.message ?? err).replace(/https?:\/\/\S+/g, "<link>"));
    process.exit(1);
  });
}
