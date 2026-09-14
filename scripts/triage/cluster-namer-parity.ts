/**
 * Does the face-cluster namer agree with the wall? Read-only (lesson 148).
 *
 * Replays the namer over every event's clusters, through the same event-first
 * face read and the same blocked keys (gallery labels + "Not a person") that
 * `clusterEventFaces` uses, in two versions:
 *
 *   before  the pre-2026-09-14 namer: votes on the raw filename reading
 *           (`extractPersonName`, first underscore segment) alone — kept
 *           inline here as the baseline
 *   after   the live code: `frameName` votes only when that reading AGREES
 *           with the wall's key (`personKeyForImage`)
 *
 *   npx tsx scripts/triage/cluster-namer-parity.ts           # summary + samples
 *   npx tsx scripts/triage/cluster-namer-parity.ts --rows    # every row
 *
 * `persons` records no author, so a stored name is classified by evidence: a
 * confirmed guest suggestion = human; equal to the BEFORE namer = auto; else
 * unknown (typed by a person, or an auto name from an older extractor). The
 * namer is fill-nulls-only, so "after would not produce it" on a named cluster
 * is a report, never a rename. Rows land in $TMPDIR/cluster-namer-parity.json.
 *
 * Measured 2026-09-14: 53 of 7,580 auto names are ones AFTER would not write
 * (25 DATADOG tag names, 8 "Golden Gate YPO", emails, "Jim H01"… and a handful
 * of real names the wall's parser gets wrong); AFTER names no unnamed cluster
 * that BEFORE would not. The wall-only reading would have named ~237.
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const SHOW_ROWS = process.argv.includes("--rows");

async function main() {
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { loadEventFaces } = await import("../../src/lib/faces/event-faces");
  const { consensusName, frameName, autoNameFor, blockedNameKeys } = await import(
    "../../src/lib/faces/cluster-event"
  );
  const { extractPersonName } = await import("../../src/lib/gallery/stacks");
  const { normalizeNameKey } = await import("../../src/lib/people/index-people");
  const { isPersonLike } = await import("../../src/lib/sections/auto-plan");
  type FrameName = { key: string; spelling: string };
  const db = createServiceClient();

  type Img = { id: string; original_filename: string; parsed_name: string | null };
  type Person = { id: string; event_id: string; name: string | null; rejected_names: string[] | null };

  const persons: Person[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await db
      .from("persons")
      .select("id, event_id, name, rejected_names")
      .order("id")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    persons.push(...((data ?? []) as Person[]));
    if (!data || data.length < 1000) break;
  }

  const humanConfirmed = new Set<string>();
  {
    const { data, error } = await db
      .from("person_identity_suggestions")
      .select("person_id")
      .eq("status", "confirmed")
      .eq("kind", "guest")
      .limit(1000);
    if (error) throw error;
    for (const r of data ?? []) if (r.person_id) humanConfirmed.add(r.person_id);
  }

  const byEvent = new Map<string, Person[]>();
  for (const p of persons) byEvent.set(p.event_id, [...(byEvent.get(p.event_id) ?? []), p]);
  const eventIds = [...byEvent.keys()];
  const eventName = new Map<string, string>();
  for (let i = 0; i < eventIds.length; i += 150) {
    const { data, error } = await db.from("events").select("id, name").in("id", eventIds.slice(i, i + 150));
    if (error) throw error;
    for (const e of data ?? []) eventName.set(e.id, e.name);
  }

  type Row = {
    event: string;
    person: string;
    stored: string | null;
    provenance: "human" | "auto" | "unknown" | "-";
    before: string | null;
    after: string | null;
    frames: number;
    sample: string;
  };
  const rows: Row[] = [];

  const queue = [...eventIds];
  let done = 0;
  const worker = async () => {
    while (queue.length) {
      const eventId = queue.pop()!;
      const [{ faces, imageById }, blocked] = await Promise.all([
        loadEventFaces<{ id: string; image_id: string; person_id: string | null }, Img>(db, eventId, {
          faceColumns: "id, image_id, person_id",
          imageColumns: "id, original_filename, parsed_name",
          embeddedOnly: true,
        }),
        blockedNameKeys(db, eventId),
      ]);
      const afterOf = new Map<string, FrameName | null>();
      const beforeOf = new Map<string, FrameName | null>();
      for (const img of imageById.values()) {
        afterOf.set(img.id, frameName(img.parsed_name, img.original_filename));
        const raw = extractPersonName(img.original_filename).trim();
        beforeOf.set(img.id, raw ? { key: normalizeNameKey(raw), spelling: raw } : null);
      }
      const members = new Map<string, string[]>();
      for (const f of faces) {
        if (!f.person_id) continue;
        members.set(f.person_id, [...(members.get(f.person_id) ?? []), f.image_id]);
      }
      for (const p of byEvent.get(eventId)!) {
        const imgs = members.get(p.id);
        if (!imgs?.length) continue;
        const rejected = p.rejected_names ?? [];
        const beforeRaw = consensusName(imgs, beforeOf, isPersonLike);
        rows.push({
          event: eventId,
          person: p.id,
          stored: p.name,
          provenance: p.name
            ? humanConfirmed.has(p.id)
              ? "human"
              : beforeRaw && normalizeNameKey(beforeRaw) === normalizeNameKey(p.name)
                ? "auto"
                : "unknown"
            : "-",
          before: autoNameFor(beforeRaw, rejected, blocked),
          after: autoNameFor(consensusName(imgs, afterOf, isPersonLike), rejected, blocked),
          frames: new Set(imgs).size,
          sample: imageById.get(imgs[0])!.original_filename,
        });
      }
      done += 1;
      if (done % 25 === 0) process.stderr.write(`  ${done} events\n`);
    }
  };
  await Promise.all(Array.from({ length: 3 }, worker));

  const k = (s: string | null) => (s ? normalizeNameKey(s) : "");
  const cap = (n: number) => (SHOW_ROWS ? Infinity : n);
  const named = rows.filter((r) => r.stored);
  const unnamed = rows.filter((r) => !r.stored);
  console.log(`clusters with members: ${rows.length} (named ${named.length}, unnamed ${unnamed.length})`);
  for (const prov of ["auto", "human", "unknown"] as const) {
    console.log(`  ${prov.padEnd(8)} ${named.filter((r) => r.provenance === prov).length}`);
  }

  const mismatched = named.filter((r) => r.provenance === "auto" && k(r.after) !== k(r.stored));
  console.log(`\nAuto names AFTER would not write: ${mismatched.length}`);
  for (const r of mismatched.slice(0, cap(60))) {
    console.log(`  ${JSON.stringify(r.stored)} → ${JSON.stringify(r.after)}  [${eventName.get(r.event)}] ${r.frames}f e.g. ${r.sample}`);
  }

  const gained = unnamed.filter((r) => r.after && k(r.after) !== k(r.before));
  const lost = unnamed.filter((r) => r.before && !r.after);
  console.log(`\nUnnamed clusters: AFTER names ${gained.length} that BEFORE would not; stops naming ${lost.length}`);
  for (const r of [...gained, ...lost].slice(0, cap(20))) {
    console.log(`  ${JSON.stringify(r.before)} → ${JSON.stringify(r.after)}  [${eventName.get(r.event)}] e.g. ${r.sample}`);
  }
  fs.writeFileSync(`${process.env.TMPDIR ?? "/tmp"}/cluster-namer-parity.json`, JSON.stringify(rows, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
