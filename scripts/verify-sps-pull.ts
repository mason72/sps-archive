/**
 * Prove an SPS import is byte-exact.
 *
 * The spec asks for this specifically, and for a good reason: the claim "SPS is
 * a lossy source" survived for months on the strength of inspection, and only a
 * sha256 round-trip caught that it was false. Inspection is not evidence here.
 *
 * For each sampled image in an imported event, this:
 *   1. reads the archive's stored object out of R2 and hashes it,
 *   2. fetches a FRESH manifest URL from SPS and hashes that,
 *   3. reports whether they are identical.
 *
 * **Every image must match, whatever its quality.** The importer copies bytes
 * verbatim — it never re-encodes — so a mismatch is corruption in the transfer,
 * full stop. `quality` answers a DIFFERENT question: whether the bytes SPS
 * handed over are the photographer's camera file or SPS's own re-encode. It is
 * reported alongside for context and is never an excuse for a hash difference.
 *
 * (An earlier version of this script treated a mismatch on a `lossy` image as
 * expected. That would have made a real corruption bug on a lossy import
 * indistinguishable from normal operation — a check that shares the assumption
 * it is supposed to be testing.)
 *
 *   npx tsx scripts/verify-sps-pull.ts <archiveEventId> [--sample 5]
 */
import fs from "node:fs";
import { createHash } from "node:crypto";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const sha256 = (buf: Buffer | Uint8Array) =>
  createHash("sha256").update(buf).digest("hex");

async function main() {
  const eventId = process.argv[2];
  if (!eventId) {
    console.error(
      "usage: npx tsx scripts/verify-sps-pull.ts <archiveEventId> [--sample N]"
    );
    process.exit(1);
  }
  const sampleFlag = process.argv.indexOf("--sample");
  const sampleSize =
    sampleFlag !== -1 ? Number(process.argv[sampleFlag + 1]) || 5 : 5;

  const { createServiceClient } = await import("../src/lib/supabase/server");
  const { getObjectBuffer } = await import("../src/lib/r2/client");
  const { getSpsToken } = await import("../src/lib/sps-integration/connection");
  const { fetchManifestPage, MANIFEST_PAGE_SIZE } = await import(
    "../src/lib/sps-integration/pull-client"
  );
  const { readSpsEventId } = await import(
    "../src/lib/sps-integration/event-link"
  );

  const supabase = createServiceClient();

  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select("id, name, user_id, settings")
    .eq("id", eventId)
    .single();
  if (eventErr || !event) throw eventErr || new Error("Event not found");

  const spsEventId = readSpsEventId(event.settings as Record<string, unknown>);
  if (!spsEventId) throw new Error("That event carries no SPS link.");

  const token = await getSpsToken(supabase, event.user_id);
  if (!token) throw new Error("No SPS connection for that event's owner.");

  // Prefer archive-grade frames — they are the ones that must match.
  const { data: rows, error: rowsErr } = await supabase
    .from("images")
    .select("id, original_filename, r2_key, file_size, sps_image_id, sps_quality, sps_pulled_at")
    .eq("event_id", eventId)
    .not("sps_image_id", "is", null)
    .order("sps_quality", { ascending: true })
    .limit(sampleSize);
  if (rowsErr) throw rowsErr;
  if (!rows?.length) throw new Error("No pulled images in that event.");

  console.log(
    `\n${event.name}  (archive ${eventId} ← SPS ${spsEventId})\n` +
      `Checking ${rows.length} image(s) by sha256.\n`
  );

  // Build sps_image_id → fresh URL, paging as far as needed to cover the sample.
  const wanted = new Set(rows.map((r) => r.sps_image_id as string));
  const urls = new Map<string, { url: string; quality: string }>();
  for (let offset = 0; wanted.size > urls.size; offset += MANIFEST_PAGE_SIZE) {
    const page = await fetchManifestPage(token, spsEventId, offset);
    for (const img of page.images) {
      if (wanted.has(img.id)) urls.set(img.id, { url: img.url, quality: img.quality });
    }
    if (page.nextOffset === undefined) break;
  }

  let matched = 0;
  let failed = 0;

  for (const row of rows) {
    const spsId = row.sps_image_id as string;
    const source = urls.get(spsId);
    const label = `${row.original_filename} [${row.sps_quality}]`;

    if (!source) {
      console.log(`  ? ${label} — no longer in the SPS manifest`);
      continue;
    }

    const stored = await getObjectBuffer(row.r2_key);
    const res = await fetch(source.url);
    if (!res.ok) {
      console.log(`  ? ${label} — source fetch ${res.status}`);
      continue;
    }
    const live = Buffer.from(await res.arrayBuffer());

    const storedHash = sha256(stored);
    const liveHash = sha256(live);
    const same = storedHash === liveHash;

    // Size is checked separately from the hash on purpose: equal sizes with
    // different hashes means corruption, while different sizes means a
    // re-encode. Collapsing them into one boolean loses that distinction.
    const sizeNote =
      stored.byteLength === live.byteLength
        ? `${stored.byteLength} B`
        : `stored ${stored.byteLength} B vs source ${live.byteLength} B`;

    if (same) {
      matched++;
      console.log(`  ✓ ${label} — identical (${sizeNote})`);
    } else {
      failed++;
      console.log(
        `  ✗ ${label} — STORED BYTES DIFFER FROM SOURCE (${sizeNote})\n` +
          `      stored ${storedHash}\n      source ${liveHash}\n` +
          `      The importer copies verbatim, so this is a transfer fault —\n` +
          `      not something the ${row.sps_quality} label explains.`
      );
    }

    if (!row.sps_pulled_at) {
      console.log(`      note: never confirmed to SPS (sps_pulled_at is null)`);
    }
  }

  const archiveGrade = rows.filter((r) => r.sps_quality === "archive").length;
  console.log(
    `\n${matched} identical, ${failed} corrupt.\n` +
      `Of the sample, ${archiveGrade} carry SPS's archive-grade label and ` +
      `${rows.length - archiveGrade} are marked lossy — that is a statement about\n` +
      `what SPS held, not about this transfer.\n`
  );
  if (failed > 0) process.exit(2);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
