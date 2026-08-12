#!/usr/bin/env node
/**
 * Queue control for the Pixieset migration.
 *
 *   node scripts/pixieset/queue.mjs build [--at-risk]   build from triage decisions
 *   node scripts/pixieset/queue.mjs status              counts, progress, expiry warnings
 *   node scripts/pixieset/queue.mjs batch [--limit N]   next collections to request (JSON)
 *   node scripts/pixieset/queue.mjs mark <id> <state> [--error "..."]
 *   node scripts/pixieset/queue.mjs expire              walk rotted links back to queued
 *   node scripts/pixieset/queue.mjs show <id>
 *
 * `build` refuses to overwrite an existing queue without --force: the file holds
 * the only record of what has already been downloaded, and rebuilding it would
 * silently re-request work that is already done.
 */
import { build, load, save, get, transition, expire, nextBatch, summarize, QUEUE_PATH, EXPIRY_DAYS } from "./lib/store.mjs";

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const n = (x) => x.toLocaleString("en-US");
const gb = (b) => `${(b / 1073741824).toFixed(1)} GB`;

async function need() {
  const q = await load();
  if (!q) {
    console.error("no queue yet — run:  node scripts/pixieset/queue.mjs build");
    process.exit(1);
  }
  return q;
}

switch (cmd) {
  case "build": {
    if ((await load()) && !has("force")) {
      console.error(`queue already exists at ${QUEUE_PATH}`);
      console.error("it is the only record of what has been downloaded. Re-run with --force to discard it.");
      process.exit(1);
    }
    const q = await build({ onlyAtRisk: has("at-risk") });
    const s = summarize(q);
    console.log(`built ${n(s.total)} collections · ${n(s.photos)} photos (upper bound)`);
    console.log(`at-risk (pre-2024, Pixieset is the only copy): ${n(s.atRisk)}`);
    console.log(QUEUE_PATH);
    break;
  }

  case "status": {
    const q = await need();
    const s = summarize(q);
    console.log(`queue      ${n(s.total)} collections · ${n(s.photos)} photos (upper bound)`);
    console.log(`state      ${Object.entries(s.byState).filter(([, v]) => v).map(([k, v]) => `${k} ${n(v)}`).join(" · ") || "—"}`);
    console.log(`at-risk    ${n(s.atRiskRemaining)} of ${n(s.atRisk)} still to land`);
    if (s.files) console.log(`verified   ${n(s.files)} files · ${gb(s.bytes)}`);
    if (s.expiringSoon) console.log(`⚠ ${n(s.expiringSoon)} link(s) expire within 24h — download or re-request`);
    if (s.expired) console.log(`⚠ ${n(s.expired)} link(s) past ${EXPIRY_DAYS}d and dead — run: queue.mjs expire`);
    break;
  }

  case "batch": {
    const q = await need();
    const batch = nextBatch(q, { limit: Number(flag("limit", 25)), atRiskOnly: has("at-risk") });
    console.log(JSON.stringify(batch.map(({ id, slug, name, eventDate, photoCount }) =>
      ({ id, slug, name, eventDate, photoCount })), null, 2));
    break;
  }

  case "mark": {
    const q = await need();
    const [, id, state] = argv;
    if (!id || !state) { console.error("usage: mark <id> <state> [--error \"...\"]"); process.exit(1); }
    const patch = {};
    const err = flag("error");
    if (err) patch.error = err;
    if (state === "failed") patch.attempts = get(q, id).attempts + 1;
    const c = transition(q, id, state, patch);
    await save(q);
    console.log(`${id} (${c.name}) → ${state}`);
    break;
  }

  case "expire": {
    const q = await need();
    const dead = expire(q);
    await save(q);
    console.log(dead.length ? `re-queued ${n(dead.length)} expired: ${dead.join(", ")}` : "nothing expired");
    break;
  }

  case "show": {
    const q = await need();
    console.log(JSON.stringify(get(q, argv[1]), null, 2));
    break;
  }

  default:
    console.error(`usage: queue.mjs build|status|batch|mark|expire|show`);
    process.exit(1);
}
