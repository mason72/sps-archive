/**
 * READ-ONLY. How each ingest path stored `images.taken_at`, measured against
 * the file's own EXIF (2026-09-24).
 *
 * One frame per event: range-GET the first 256 KB from R2, read the RAW
 * `DateTimeOriginal` string and `OffsetTimeOriginal`, and compare the stored
 * value against the raw wall clock read as UTC. The difference in hours names
 * the runtime timezone the row was parsed in (0 = Vercel/UTC, -7/-8 = a Mac
 * in Los Angeles), and the offset column says how many files could have been
 * placed exactly.
 *
 *   npx tsx scripts/triage/taken-at-offset-probe.ts > out.json
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

type Row = { id: string; r2_key: string; taken_at: string | null; sps_image_id: string | null; event_id: string };

async function main() {
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { getPresignedDownloadUrl } = await import("../../src/lib/r2/client");
  const exifr = await import("exifr");
  const supabase = createServiceClient();

  const { data: events, error } = await supabase
    .from("events")
    .select("id, name, settings")
    .order("id");
  if (error) throw error;

  const out: Record<string, unknown>[] = [];
  for (const ev of events ?? []) {
    const { data: rows, error: e2 } = await supabase
      .from("images")
      .select("id, r2_key, taken_at, sps_image_id, event_id")
      .eq("event_id", ev.id)
      .limit(20); // a sample, not a page: no order needed, and ordering timed out on big events
    if (e2) throw e2;
    const r = (rows as Row[] | null)?.find((x) => x.taken_at && !/\.(mp4|mov)$/i.test(x.r2_key));
    if (!r) continue;
    const settings = (ev.settings ?? {}) as Record<string, unknown>;
    const path = r.sps_image_id ? "sps_pull" : "pixiesetCollectionId" in settings ? "pixieset" : "upload/other";
    try {
      const url = await getPresignedDownloadUrl(r.r2_key, 600);
      const res = await fetch(url, { headers: { Range: "bytes=0-262143" } });
      const buf = await res.arrayBuffer();
      const d = await exifr.parse(buf, {
        pick: ["DateTimeOriginal", "OffsetTimeOriginal", "OffsetTime", "Model"],
        reviveValues: false,
      });
      const raw = typeof d?.DateTimeOriginal === "string" ? d.DateTimeOriginal : null;
      const m = raw?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
      const naiveUtc = m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
      const storedMinusNaiveH =
        naiveUtc != null && r.taken_at ? (new Date(r.taken_at).getTime() - naiveUtc) / 3.6e6 : null;
      out.push({
        path, event: ev.name, raw, offset: d?.OffsetTimeOriginal ?? null, offsetTime: d?.OffsetTime ?? null,
        model: d?.Model ?? null, stored: r.taken_at, storedMinusNaiveH,
      });
    } catch (err) {
      out.push({ path, event: ev.name, error: String(err) });
    }
  }
  console.log(JSON.stringify(out, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
