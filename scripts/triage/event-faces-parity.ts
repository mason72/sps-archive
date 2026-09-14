/**
 * Parity + timing: the old embedded faces read vs loadEventFaces. Read-only.
 *
 * The old shape (`images!inner` + `.eq("images.event_id")`) walks every face in
 * the archive per page (lesson 144). This proves the event-first loader returns
 * the SAME faces, in the same order, with the same image fields, and times both.
 *
 *   npx tsx scripts/triage/event-faces-parity.ts [eventId ...]
 *
 * With no ids: the event from the 2026-09-14 alert plus two other events that
 * have face clusters. An old-query failure is printed, not thrown — a timeout
 * on the old path is itself the evidence. Largest case checked: Atlassian Expo
 * (f37a9cfa…, 31,172 faces), identical, 37.6s old vs 2.9s new.
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const ALERT_EVENT = "156e607f-64c5-467c-b9b6-27257e65d052";

async function main() {
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { loadEventFaces } = await import("../../src/lib/faces/event-faces");
  const supabase = createServiceClient();

  let eventIds = process.argv.slice(2);
  if (eventIds.length === 0) {
    const { data, error } = await supabase
      .from("persons")
      .select("event_id")
      .order("id")
      .limit(1000);
    if (error) throw error;
    const seen = [...new Set((data ?? []).map((r) => r.event_id as string))];
    eventIds = [ALERT_EVENT, ...seen.filter((id) => id !== ALERT_EVENT).slice(0, 2)];
  }

  let failures = 0;
  for (const eventId of eventIds) {
    const t0 = Date.now();
    const oldRows: {
      id: string;
      image_id: string;
      person_id: string | null;
      r2_key: string;
      original_filename: string;
    }[] = [];
    let oldError: string | null = null;
    try {
      for (let page = 0; ; page++) {
        const { data, error } = await supabase
          .from("faces")
          .select("id, image_id, person_id, images!inner(event_id, r2_key, original_filename)")
          .eq("images.event_id", eventId)
          .order("id", { ascending: true })
          .range(page * 1000, page * 1000 + 999);
        if (error) throw new Error(error.message);
        for (const r of data ?? []) {
          const img = r.images as unknown as { r2_key: string; original_filename: string };
          oldRows.push({
            id: r.id,
            image_id: r.image_id,
            person_id: r.person_id,
            r2_key: img.r2_key,
            original_filename: img.original_filename,
          });
        }
        if (!data || data.length < 1000) break;
      }
    } catch (e) {
      oldError = e instanceof Error ? e.message : String(e);
    }
    const oldMs = Date.now() - t0;

    const t1 = Date.now();
    const { faces, imageById } = await loadEventFaces<
      { id: string; image_id: string; person_id: string | null },
      { id: string; r2_key: string; original_filename: string }
    >(supabase, eventId, {
      faceColumns: "id, image_id, person_id",
      imageColumns: "id, r2_key, original_filename",
    });
    const newMs = Date.now() - t1;

    if (oldError) {
      console.log(`${eventId}: OLD FAILED after ${oldMs}ms (${oldError}); new ${faces.length} faces in ${newMs}ms`);
      continue;
    }
    const newRows = faces.map((f) => ({
      id: f.id,
      image_id: f.image_id,
      person_id: f.person_id,
      r2_key: imageById.get(f.image_id)?.r2_key,
      original_filename: imageById.get(f.image_id)?.original_filename,
    }));
    const same = JSON.stringify(oldRows) === JSON.stringify(newRows);
    if (!same) failures++;
    console.log(
      `${eventId}: ${same ? "IDENTICAL" : "DIFFERENT"} · old ${oldRows.length} faces ${oldMs}ms · new ${newRows.length} faces ${newMs}ms`
    );
  }
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
