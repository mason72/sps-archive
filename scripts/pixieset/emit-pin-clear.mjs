#!/usr/bin/env node
/**
 * Emit a paste-ready browser payload that clears the download PIN across the KEEP set.
 *
 *   node scripts/pixieset/emit-pin-clear.mjs            > /tmp/clear-pins.js
 *   node scripts/pixieset/emit-pin-clear.mjs --at-risk  > /tmp/clear-pins.js
 *   node scripts/pixieset/emit-pin-clear.mjs --restore  > /tmp/restore-pins.js
 *
 * Paste the output into the DevTools console on https://galleries.pixieset.com
 * while signed in. It cannot run from Node: Cloudflare challenges every non-browser
 * client on both Pixieset hosts (see tasks/pixieset-migration.md).
 *
 * WHY A GENERATOR RATHER THAN A CHECKED-IN SCRIPT. The collection ids come from the
 * queue, which is derived from Mason's hand-triage. Baking 1,371 of them into source
 * would rot the moment the triage changed, and would put the KEEP/TRASH decision in
 * two places.
 *
 * ⚠️ THIS IS DESTRUCTIVE IN A WAY THE UI DOES NOT ADMIT. `download_pin: null` does not
 * merely disable the gate — it ERASES the PIN. Re-enabling later mints a NEW one, so a
 * PIN a client was given years ago stops working. Measured 2026-08-12, and the opposite
 * of what the toggle appears to do. Acceptable only because the account is being
 * retired. The payload therefore BACKS THE PINS UP FIRST, to a JSON file downloaded
 * through the browser — values go straight to disk and never pass through an agent
 * transcript or a network side-channel.
 *
 * Scope: the 1,371 KEEP collections, not all 1,763. Clearing PINs on the 392 being
 * trashed would expose client galleries for no migration benefit.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { load } from "./lib/store.mjs";

const args = process.argv.slice(2);
const atRiskOnly = args.includes("--at-risk");
const restore = args.includes("--restore");
/**
 * `--clear-only` emits the destructive half alone, for when the backup has already
 * been taken and VERIFIED on disk. It carries the small PROTECT list (collections
 * being trashed, which keep their PINs) instead of the much larger KEEP list, and
 * re-reads live state rather than trusting a stale id list — so a collection whose
 * PIN was already cleared is skipped rather than written to twice.
 */
const clearOnly = args.includes("--clear-only");
const BACKUP = join(homedir(), "Downloads", "pixieset-download-pins-backup.json");

const queue = await load();
if (!queue) {
  console.error("no queue — run: node scripts/pixieset/queue.mjs build");
  process.exit(1);
}

const chosen = Object.values(queue.collections)
  .filter((c) => (atRiskOnly ? c.atRisk : true))
  .filter((c) => c.state !== "ingested")
  .map((c) => Number(c.id));

const label = atRiskOnly ? "at-risk pre-2024" : "KEEP";

if (restore) {
  console.log(`// Restore download PINs from a backup file produced by the clear payload.
// Paste on https://galleries.pixieset.com, then pick the JSON file when prompted.
(async () => {
  const xsrf = decodeURIComponent((document.cookie.match(/XSRF-TOKEN=([^;]+)/) || [, ''])[1]);
  if (!xsrf) return console.error('no XSRF-TOKEN cookie — are you signed in?');
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json' });
  input.onchange = async () => {
    const backup = JSON.parse(await input.files[0].text());
    const entries = Object.entries(backup).filter(([, pin]) => pin);
    console.log('restoring', entries.length, 'PINs');
    let ok = 0, fail = 0;
    for (const [id, pin] of entries) {
      const r = await fetch(\`/api/v1/collections/\${id}/update_download_settings\`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-XSRF-TOKEN': xsrf },
        body: JSON.stringify({ id: Number(id), download_pin: String(pin) }),
      });
      r.ok ? ok++ : fail++;
      if ((ok + fail) % 50 === 0) console.log('  ', ok + fail, '/', entries.length);
      await new Promise((s) => setTimeout(s, 120));
    }
    console.log('restored', ok, '· failed', fail);
  };
  input.click();
})();`);
  process.exit(0);
}

if (clearOnly) {
  // Refuse to emit a destructive payload unless a real backup is sitting on disk.
  // A guard that only prints a warning is not a guard.
  let backup;
  try {
    backup = JSON.parse(readFileSync(BACKUP, "utf8"));
  } catch {
    console.error(`no backup at ${BACKUP} — refusing to emit a clear-only payload.`);
    console.error(`run the full payload first (it backs up before clearing):`);
    console.error(`  node scripts/pixieset/emit-pin-clear.mjs | pbcopy`);
    process.exit(1);
  }
  const withPin = Object.keys(backup).filter((k) => backup[k] && backup[k].pin);
  if (withPin.length === 0) {
    console.error(`the backup at ${BACKUP} records no PINs at all — refusing to clear blind.`);
    process.exit(1);
  }
  const keep = new Set(Object.keys(queue.collections));
  const protect = withPin.filter((id) => !keep.has(id)).map(Number);
  const willClear = withPin.filter((id) => keep.has(id)).length;

  console.error(`backup found: ${Object.keys(backup).length} collections, ${withPin.length} PINs`);
  console.error(`will clear ${willClear} · protecting ${protect.length} trashed collections`);

  console.log(`// Clear the download PIN across the KEEP set. Backup already taken and
// verified at ~/Downloads/pixieset-download-pins-backup.json (${withPin.length} PINs).
//
// Paste on https://galleries.pixieset.com while signed in. Chrome blocks the FIRST
// paste into a console: if it asks, type  allow pasting  then press Enter, and paste again.
//
// Re-reads live state, so it is safe to run twice — anything already cleared is skipped.
(async () => {
  const PROTECT = new Set(${JSON.stringify(protect)});   // being trashed; they keep their PINs
  const xsrf = decodeURIComponent((document.cookie.match(/XSRF-TOKEN=([^;]+)/) || [, ''])[1]);
  if (!xsrf) return console.error('no XSRF-TOKEN cookie — are you signed in?');
  const hdr = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-XSRF-TOKEN': xsrf };

  const targets = [];
  for (let page = 1; page < 200; page++) {
    const r = await fetch(\`/api/v1/dashboard_listings?page=\${page}\`, { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    if (!r.ok) break;
    const j = await r.json();
    const cols = (j && j.data && j.data.data && j.data.data.collections) || [];
    if (!cols.length) break;
    for (const c of cols) {
      const has = !!(c.download_pin && String(c.download_pin).trim());
      if (has && !PROTECT.has(Number(c.id))) targets.push(Number(c.id));
    }
  }
  console.log('clearing', targets.length, 'collections (protecting', PROTECT.size + ')');

  let ok = 0, fail = 0;
  for (const id of targets) {
    try {
      const r = await fetch(\`/api/v1/collections/\${id}/update_download_settings\`, {
        method: 'PATCH', credentials: 'include', headers: hdr,
        body: JSON.stringify({ id, download_pin: null }),
      });
      r.ok ? ok++ : fail++;
    } catch { fail++; }
    if ((ok + fail) % 50 === 0) console.log('  ', ok + fail, '/', targets.length);
    await new Promise((s) => setTimeout(s, 120));
  }
  console.log('DONE —', ok, 'cleared ·', fail, 'failed');
})();`);
  process.exit(0);
}

console.log(`// Clear the download PIN on ${chosen.length} ${label} collections.
// Paste on https://galleries.pixieset.com while signed in.
//
// Step 1 downloads a backup of every PIN to ~/Downloads BEFORE anything is changed,
// because clearing a PIN erases it — re-enabling later mints a new one. Keep that
// file until the migration is finished; restore with:
//     node scripts/pixieset/emit-pin-clear.mjs --restore
//
// Runs sequentially with a small gap. This is a paid account behind bot protection;
// a burst of 1,371 parallel writes is the shape that gets an account limited.
(async () => {
  const IDS = ${JSON.stringify(chosen)};
  const xsrf = decodeURIComponent((document.cookie.match(/XSRF-TOKEN=([^;]+)/) || [, ''])[1]);
  if (!xsrf) return console.error('no XSRF-TOKEN cookie — are you signed in to galleries.pixieset.com?');

  // ── 1. back the PINs up, to disk, before touching anything ──────────────────
  console.log('reading current PINs for', IDS.length, 'collections…');
  const backup = {};
  let read = 0;
  for (const id of IDS) {
    try {
      const r = await fetch(\`/api/v1/collections/\${id}\`, { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      if (r.ok) { const j = await r.json(); const c = j && j.data ? j.data : j; backup[id] = c.download_pin || null; }
    } catch {}
    if (++read % 100 === 0) console.log('  read', read, '/', IDS.length);
  }
  const withPin = Object.values(backup).filter(Boolean).length;
  const blob = new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'pixieset-download-pins-backup.json' });
  document.body.appendChild(a); a.click(); a.remove();
  console.log('backup downloaded:', withPin, 'PINs across', Object.keys(backup).length, 'collections');
  console.log('CHECK ~/Downloads FOR THAT FILE BEFORE CONTINUING.');

  // Refuse to proceed on a backup that plainly failed.
  if (withPin === 0) return console.error('read no PINs at all — stopping rather than clearing blind');

  await new Promise((s) => setTimeout(s, 4000));

  // ── 2. clear ────────────────────────────────────────────────────────────────
  console.log('clearing…');
  let ok = 0, fail = 0, skipped = 0;
  for (const id of IDS) {
    if (!backup[id]) { skipped++; continue; }            // already had no PIN
    try {
      const r = await fetch(\`/api/v1/collections/\${id}/update_download_settings\`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-XSRF-TOKEN': xsrf },
        body: JSON.stringify({ id, download_pin: null }),
      });
      r.ok ? ok++ : fail++;
    } catch { fail++; }
    if ((ok + fail) % 50 === 0) console.log('  ', ok + fail, 'cleared,', fail, 'failed');
    await new Promise((s) => setTimeout(s, 120));
  }
  console.log('done —', ok, 'cleared ·', fail, 'failed ·', skipped, 'already had none');
})();`);
