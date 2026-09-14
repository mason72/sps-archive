/**
 * Which /people cards are SESSION labels, and which candidate rule removes
 * only those? Read-only (lesson 153).
 *
 * "Guardant_Team-Spirit-Night_13.jpg" parses to a person-shaped name, and the
 * event-label rule (event-labels.ts) misses it because each session is a
 * small share of its event. A rule is judged by what it would take off the
 * wall, so this replays the index's filename pass offline and maps every
 * flagged (event, key) onto the cards of a saved `people-index-diff` build.
 *
 *   npx tsx scripts/triage/session-label-probe.ts rows          # one read of production
 *   npx tsx scripts/triage/session-label-probe.ts judge <label> # offline, vs people-index-<label>.json
 *   npx tsx scripts/triage/session-label-probe.ts flagged       # offline, every row the shipped rule flags
 *
 * Measured 2026-09-14: the shipped rule flags 821 (event, name) groups and
 * 5,564 rows; exactly 26 of those groups were wall cards, all session labels.
 * The rest were already off the wall (single-word labels like "MBA", "WACA").
 * The `judge` rules are the candidates that lost, kept for the record.
 *
 * Rows land in $TMPDIR/session-label-rows.json.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const USER_ID = process.env.PEOPLE_USER_ID || "d5b2e276-d33d-49b3-ba09-59164c622b21";
const ROWS = path.join(os.tmpdir(), "session-label-rows.json");

type Row = { id: string; e: string; p: string | null; f: string };
type Dump = { events: { id: string; name: string }[]; rows: Row[] };

async function rows() {
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { NON_PERSON_GALLERIES } = await import("../../src/lib/people/index-people");
  const db = createServiceClient();
  const { data: events, error } = await db.from("events").select("id, name").eq("user_id", USER_ID);
  if (error) throw error;
  const kept = (events ?? []).filter((e) => !NON_PERSON_GALLERIES.has(e.name));
  const out: Row[] = [];
  // Per event, sequentially: gentle on a database the migration is writing to.
  for (const ev of kept) {
    for (let from = 0; ; from += 1000) {
      const { data, error: err } = await db
        .from("images")
        .select("id, parsed_name, original_filename")
        .eq("event_id", ev.id)
        .eq("media_type", "image")
        .eq("processing_status", "complete")
        .order("id")
        .range(from, from + 999);
      if (err) throw err;
      for (const r of data ?? []) out.push({ id: r.id, e: ev.id, p: r.parsed_name, f: r.original_filename });
      if (!data || data.length < 1000) break;
    }
  }
  fs.writeFileSync(ROWS, JSON.stringify({ events: kept, rows: out } satisfies Dump));
  console.log(`${kept.length} events, ${out.length} rows → ${ROWS}`);
}

async function judge(label: string) {
  const { personNameFromParts } = await import("../../src/lib/gallery/stacks");
  const { normalizeNameKey, looksLikePersonName } = await import("../../src/lib/people/index-people");
  const { eventLabelKeys } = await import("../../src/lib/people/event-labels");
  const { nameText } = await import("../../src/lib/people/name-text");
  const dump = JSON.parse(fs.readFileSync(ROWS, "utf8")) as Dump;
  const eventName = new Map(dump.events.map((e) => [e.id, e.name]));
  type Card = { key: string; name: string; splitFrom?: string; n: number; ev: [string, number][] };
  const cards = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `people-index-${label}.json`), "utf8")) as Card[];

  // Replay the filename pass: name, key, labels removed.
  type Pair = { eventId: string; key: string; name: string; n: number; files: string[] };
  const pairs = new Map<string, Pair>();
  const totalByEvent = new Map<string, number>();
  const keyByRow: { eventId: string; key: string }[] = [];
  for (const r of dump.rows) {
    totalByEvent.set(r.e, (totalByEvent.get(r.e) ?? 0) + 1);
    const name = personNameFromParts(r.p, r.f)?.trim();
    if (!name) continue;
    const key = normalizeNameKey(name);
    if (!key) continue;
    keyByRow.push({ eventId: r.e, key });
    const id = `${r.e}|${key}`;
    const pair = pairs.get(id) ?? { eventId: r.e, key, name, n: 0, files: [] };
    pair.n++;
    pair.files.push(r.f);
    pairs.set(id, pair);
  }
  const labels = eventLabelKeys(keyByRow, totalByEvent);
  for (const [id, p] of pairs) if (labels.get(p.eventId)?.has(p.key)) pairs.delete(id);

  const words = (s: string) =>
    nameText(s)
      .split(/[^\p{L}\p{M}]+/u)
      .map((w) => normalizeNameKey(w))
      .filter((w) => w.length >= 2);
  const undated = (f: string) => !/(?:_\d{2,4}-|--|-\d{2}-\d{2}|_\d{6}_)/.test(f);
  const firstSegment = (f: string) => nameText(f).replace(/\.\w+$/, "").replace(/^\(AI\)\s*/i, "").split("_")[0];

  // Per event: how many distinct person-shaped keys each leading word starts.
  const leadCount = new Map<string, Map<string, Set<string>>>();
  for (const p of pairs.values()) {
    if (!looksLikePersonName(p.name)) continue;
    const lead = words(p.name)[0];
    if (!lead) continue;
    const m = leadCount.get(p.eventId) ?? new Map<string, Set<string>>();
    m.set(lead, (m.get(lead) ?? new Set()).add(p.key));
    leadCount.set(p.eventId, m);
  }

  const leadToken = (f: string) =>
    normalizeNameKey(nameText(f).replace(/\.\w+$/, "").replace(/^\(AI\)\s*/i, "").split(/[_-]/)[0]);
  const eventWords = (p: Pair) => words(eventName.get(p.eventId)!);
  const v1 = (p: Pair) =>
    looksLikePersonName(p.name) &&
    p.files.every((f) => undated(f) && eventWords(p).includes(leadToken(f)));
  const leads = (p: Pair) => leadCount.get(p.eventId)?.get(words(p.name)[0])?.size ?? 0;
  for (const p of pairs.values()) {
    if (v1(p)) console.log(`v1 hit: ${eventName.get(p.eventId)} :: ${p.name} (${p.n}) lead-keys=${leads(p)} ← ${p.files[0]}`);
  }

  // First names the archive KNOWS: first words of person-shaped names read
  // from DATED files, where the date proves where the name ends.
  const { nameBeforeDate } = await import("../../src/lib/gallery/stacks");
  const knownFirst = new Map<string, number>();
  for (const r of dump.rows) {
    const dated = nameBeforeDate(r.f);
    if (!dated || !looksLikePersonName(dated)) continue;
    const w = words(dated)[0];
    if (w) knownFirst.set(w, (knownFirst.get(w) ?? 0) + 1);
  }
  for (const w of ["guardant", "atlassian", "cema", "ebay", "fm", "jordan", "julia", "bill", "kelly", "tessa"]) {
    console.log(`knownFirst ${w}: ${knownFirst.get(w) ?? 0}`);
  }
  const v5 = (p: Pair) => v1(p) && !knownFirst.has(leadToken(p.files[0]));

  const rules: Record<string, (p: Pair) => boolean> = {
    "v5-v1-lead-not-known-first-name": v5,
    "v4-v3-lead-is-event-first-word": (p) =>
      v1(p) &&
      words(p.name).slice(1).some((w) => !eventWords(p).includes(w)) &&
      eventWords(p)[0] === leadToken(p.files[0]),
    "v1-undated-lead-token-multiword": v1,
    "v2-v1-lead-x2": (p) => v1(p) && leads(p) >= 2,
    // The name is not the gallery's subject: some word past the first is not in the event name.
    "v3-v1-not-subject": (p) => v1(p) && words(p.name).slice(1).some((w) => !eventWords(p).includes(w)),
    // The rejected idea, kept as the reference point.
    "shares-event-word": (p) => words(p.name).some((w) => words(eventName.get(p.eventId)!).includes(w)),
    // The first word is a word of the event's name, and several distinct names start with it.
    "lead-event-word-x3": (p) => {
      const lead = words(p.name)[0];
      return (
        !!lead &&
        words(eventName.get(p.eventId)!).includes(lead) &&
        (leadCount.get(p.eventId)?.get(lead)?.size ?? 0) >= 3
      );
    },
    // Same, without the event-name condition.
    "lead-word-x3": (p) => {
      const lead = words(p.name)[0];
      return !!lead && (leadCount.get(p.eventId)?.get(lead)?.size ?? 0) >= 3;
    },
    // Undated, and the first underscore segment is exactly an event-name word.
    "undated-first-seg-event-word": (p) =>
      p.files.every((f) => {
        const seg = normalizeNameKey(firstSegment(f));
        return undated(f) && !!seg && words(eventName.get(p.eventId)!).includes(seg);
      }),
  };

  // Card lookup: identity (splitFrom ?? key) + event name → card.
  const cardsByIdentity = new Map<string, Card[]>();
  for (const c of cards) {
    const id = c.splitFrom ?? c.key;
    cardsByIdentity.set(id, [...(cardsByIdentity.get(id) ?? []), c]);
  }

  for (const [ruleName, rule] of Object.entries(rules)) {
    const hitsByCard = new Map<Card, { photos: number; pairs: Pair[] }>();
    for (const p of pairs.values()) {
      if (!rule(p)) continue;
      const ev = eventName.get(p.eventId)!;
      const card = (cardsByIdentity.get(p.key) ?? []).find((c) => c.ev.some(([n]) => n === ev));
      if (!card) continue;
      const h = hitsByCard.get(card) ?? { photos: 0, pairs: [] };
      h.photos += p.n;
      h.pairs.push(p);
      hitsByCard.set(card, h);
    }
    const gone = [...hitsByCard].filter(([c, h]) => h.photos >= c.n);
    const shrunk = [...hitsByCard].filter(([c, h]) => h.photos < c.n);
    console.log(
      `\n== ${ruleName}: ${gone.length} cards removed (${gone.reduce((s, [c]) => s + c.n, 0)} photos), ${shrunk.length} shrunk`
    );
    for (const [c, h] of gone.sort((a, b) => b[0].n - a[0].n)) {
      console.log(`  GONE   ${String(c.n).padStart(4)}  ${c.name}  ::  ${h.pairs.map((p) => `${eventName.get(p.eventId)} ← ${p.files[0]}`).join(" ; ")}`);
    }
    for (const [c, h] of shrunk) {
      console.log(`  SHRINK ${c.n}→${c.n - h.photos}  ${c.name}  ::  ${h.pairs.map((p) => `${eventName.get(p.eventId)} ← ${p.files[0]}`).join(" ; ")}`);
    }
  }
}

/** Every row the SHIPPED rule flags, grouped by event and name — what the code actually touches. */
async function flagged() {
  const { personNameFromParts, nameBeforeDate } = await import("../../src/lib/gallery/stacks");
  const { looksLikePersonName } = await import("../../src/lib/people/index-people");
  const { isSessionLabelFile, firstNameKeys } = await import("../../src/lib/people/event-labels");
  const dump = JSON.parse(fs.readFileSync(ROWS, "utf8")) as Dump;
  const eventName = new Map(dump.events.map((e) => [e.id, e.name]));
  const dated = dump.rows.map((r) => nameBeforeDate(r.f));
  const known = firstNameKeys(dated.filter((d): d is string => !!d && looksLikePersonName(d)));
  const groups = new Map<string, { n: number; file: string }>();
  dump.rows.forEach((r, i) => {
    if (!isSessionLabelFile(r.f, eventName.get(r.e)!, known, dated[i])) return;
    const g = `${eventName.get(r.e)} :: ${personNameFromParts(r.p, r.f)}`;
    groups.set(g, { n: (groups.get(g)?.n ?? 0) + 1, file: groups.get(g)?.file ?? r.f });
  });
  const total = [...groups.values()].reduce((s, g) => s + g.n, 0);
  console.log(`${groups.size} (event, name) groups, ${total} rows`);
  for (const [g, { n, file }] of [...groups].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`${String(n).padStart(4)}  ${g}  ← ${file}`);
  }
}

const [cmd, arg] = process.argv.slice(2);
const run =
  cmd === "rows" ? rows() : cmd === "judge" && arg ? judge(arg) : cmd === "flagged" ? flagged() : null;
if (!run) {
  console.error("usage: session-label-probe.ts rows | judge <label> | flagged");
  process.exit(1);
}
run.catch((e) => {
  console.error(e);
  process.exit(1);
});
