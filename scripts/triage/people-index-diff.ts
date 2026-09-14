/**
 * Before/after harness for any change to who reaches /people. Read-only.
 *
 * Builds the REAL index (buildPeopleIndex, against production) and saves the
 * cards to a label, or diffs two saved labels: cards added (with their
 * events), removed, grown, renamed. A name rule is judged on this diff, never
 * on a row-level count — the label filter, vouching and face split all sit
 * between "this filename now parses" and "this person is on the wall"
 * (lesson 140: 429 comma-named identities became 197 cards).
 *
 *   npx tsx scripts/triage/people-index-diff.ts save before   # on the old code
 *   npx tsx scripts/triage/people-index-diff.ts save after    # on the new code
 *   npx tsx scripts/triage/people-index-diff.ts diff before after
 *
 * Output goes to $TMPDIR/people-index-<label>.json; ~40s per build.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

/** The studio account that owns the archive. */
const USER_ID = process.env.PEOPLE_USER_ID || "d5b2e276-d33d-49b3-ba09-59164c622b21";

interface Card {
  key: string;
  name: string;
  splitFrom?: string;
  n: number;
  ev: [string, number][];
}

const file = (label: string) => path.join(os.tmpdir(), `people-index-${label}.json`);
const load = (label: string): Map<string, Card> =>
  new Map((JSON.parse(fs.readFileSync(file(label), "utf8")) as Card[]).map((c) => [c.key, c]));

async function save(label: string) {
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { buildPeopleIndex } = await import("../../src/lib/people/index-people");
  const t = Date.now();
  const index = await buildPeopleIndex(createServiceClient(), USER_ID);
  const cards: Card[] = index.map((p) => ({
    key: p.key,
    name: p.name,
    splitFrom: p.splitFrom,
    n: p.imageCount,
    ev: p.events.map((e) => [e.eventName, e.imageCount]),
  }));
  fs.writeFileSync(file(label), JSON.stringify(cards));
  const photos = cards.reduce((s, c) => s + c.n, 0);
  console.log(`${label}: ${cards.length} cards, ${photos} photos, ${((Date.now() - t) / 1000).toFixed(1)}s → ${file(label)}`);
}

function diff(a: string, b: string) {
  const before = load(a);
  const after = load(b);
  const added = [...after.values()].filter((c) => !before.has(c.key)).sort((x, y) => y.n - x.n);
  const removed = [...before.values()].filter((c) => !after.has(c.key));
  const grown = [...after.values()].filter((c) => before.has(c.key) && before.get(c.key)!.n !== c.n);
  const renamed = [...after.values()].filter((c) => before.has(c.key) && before.get(c.key)!.name !== c.name);
  console.log(
    `added ${added.length} (${added.reduce((s, c) => s + c.n, 0)} photos) · removed ${removed.length} · ` +
      `changed count ${grown.length} · renamed ${renamed.length}`
  );
  for (const c of removed) console.log(`REMOVED  ${c.name} (${c.n})`);
  for (const c of renamed) console.log(`RENAMED  ${before.get(c.key)!.name} → ${c.name}`);
  for (const c of grown) console.log(`COUNT    ${c.name} ${before.get(c.key)!.n} → ${c.n}`);
  for (const c of added) {
    const events = c.ev.map(([name, n]) => `${name}=${n}`).join("; ");
    console.log(`ADDED ${String(c.n).padStart(4)}  ${c.name}${c.splitFrom ? " [split]" : ""}  ::  ${events}`);
  }
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === "save" && a) {
  save(a).catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else if (cmd === "diff" && a && b) {
  diff(a, b);
} else {
  console.error("usage: people-index-diff.ts save <label> | diff <before> <after>");
  process.exit(1);
}
