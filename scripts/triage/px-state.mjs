/**
 * Read the Pixieset extension's chrome.storage.local state, correctly.
 *
 * WHY THIS EXISTS. Three wrong readings in two days came from regexing the raw
 * LevelDB bytes: a 400 KB lookback window spans several stored records, and one
 * tick saves more than once, so "the newest state" picked up an older record's
 * `repairs`, `done` or `log`. Each misread sent me chasing a bug that was not
 * there.
 *
 * A .log file is a sequence of 32 KB BLOCKS; each record inside carries a
 * 7-byte header (crc32, length, type) and a record may be split across blocks
 * as FIRST/MIDDLE/LAST fragments. Strip the headers, rejoin the fragments, and
 * the payload is ordinary JSON — no guessing.
 *
 * NEVER print this object wholesale: it holds 282 of Mason's clients' gallery
 * passwords. Print named fields.
 *
 *   node scripts/triage/px-state.mjs [field ...]
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DIR = process.env.PX_STATE_DIR ||
  path.join(os.homedir(), "Library/Application Support/Google/Chrome/Default/Local Extension Settings/llefmhbakhklllfmdkdcllachcaecfmh");
const BLOCK = 32768;

/** Every record payload in a LevelDB write-ahead log, in write order. */
function records(buf) {
  const out = [];
  let partial = null;
  for (let base = 0; base < buf.length; base += BLOCK) {
    let off = base;
    const end = Math.min(base + BLOCK, buf.length);
    while (off + 7 <= end) {
      const len = buf.readUInt16LE(off + 4);
      const type = buf[off + 6];
      if (type === 0 || off + 7 + len > end) break;      // zero padding to the block edge
      const data = buf.subarray(off + 7, off + 7 + len);
      if (type === 1) out.push(data);                     // FULL
      else if (type === 2) partial = [data];              // FIRST
      else if (partial) { partial.push(data); if (type === 4) { out.push(Buffer.concat(partial)); partial = null; } }
      off += 7 + len;
    }
  }
  return out;
}

const states = [];
for (const f of fs.readdirSync(DIR)) {
  if (!f.endsWith(".log")) continue;                      // .ldb blocks are compressed
  for (const rec of records(fs.readFileSync(path.join(DIR, f)))) {
    const s = rec.toString("utf8");
    const i = s.indexOf('{"attempts"');
    if (i === -1) continue;
    try { states.push(JSON.parse(s.slice(i))); } catch { /* a torn tail */ }
  }
}
if (!states.length) { console.error("no parsable state found"); process.exit(1); }
const st = states[states.length - 1];                     // last write wins, by position

const fields = process.argv.slice(2);
if (fields.length) {
  for (const f of fields) console.log(`${f}:`, JSON.stringify(st[f]));
} else {
  console.log("lastTickAt :", st.lastTickAt);
  console.log("running    :", st.running, st.stoppedReason ? `(${st.stoppedReason})` : "");
  console.log("driving    :", st.driving ? `${st.driving.slug} since ${st.driving.at}` : "none");
  console.log("inflight   :", st.inflight ? `${st.inflight.slug}, ${st.inflight.ids.length} zip(s)` : "none");
  console.log("done/gated :", st.done.length, "/", st.gated.length, "| gone:", (st.gone || []).length);
  console.log("repairs    :", st.repairs);
  console.log("passwords  :", Object.keys(st.passwords || {}).length, "(values never printed)");
  console.log("--- log ---");
  for (const l of (st.log || []).slice(-8)) console.log("  ", l);
}
