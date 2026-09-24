/**
 * DRY RUN ONLY. Finds R2 folders `events/<id>/` whose event row no longer
 * exists: the files a deleted event's cleanup never reached (unordered paging
 * skipped rows, or the fire-and-forget cleanup was frozen after the response).
 * It deletes nothing and has no flag that would.
 *
 * A dead folder is not automatically all garbage: a merge moves a row into the
 * kept event and leaves its FILE under the deleted event's folder
 * (scripts/merge-au2026.ts). So every original in a dead folder is checked
 * against images.r2_key, and a referenced original keeps its whole footprint.
 *
 *   npx tsx scripts/triage/event-orphan-sweep.ts [out.json]
 */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local","utf8").split("\n")) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&process.env[m[1]]===undefined) process.env[m[1]]=m[2]; }
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

(async () => {
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { getThumbnailKey, getVideoDisplayKey } = await import("../../src/lib/r2/client");
  const { keysStillReferenced } = await import("../../src/lib/events/purge-assets");
  const db = createServiceClient();
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
    requestHandler: { connectionTimeout: 10_000, requestTimeout: 120_000 },
  });
  const Bucket = process.env.R2_BUCKET_NAME!;

  // 1. Every event id folder in the bucket.
  const folders: string[] = [];
  let token: string | undefined;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: "events/", Delimiter: "/", ContinuationToken: token }));
    for (const p of r.CommonPrefixes ?? []) folders.push(p.Prefix!.slice("events/".length, -1));
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);

  // 2. Every live event id (ordered paging, lesson 88).
  const live = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from("events").select("id").order("id").range(offset, offset + 999);
    if (error) throw error;
    for (const e of data ?? []) live.add(e.id);
    if (!data || data.length < 1000) break;
  }
  if (live.size === 0) throw new Error("read zero events — refusing to call every folder dead");

  const nonUuid = folders.filter((f) => !UUID.test(f));
  const dead = folders.filter((f) => UUID.test(f) && !live.has(f));
  console.log(`folders=${folders.length} live-events=${live.size} dead-folders=${dead.length} non-uuid-folders=${nonUuid.length}${nonUuid.length ? " " + JSON.stringify(nonUuid.slice(0, 10)) : ""}`);

  // 3. Inventory each dead folder, keeping anything a live row still needs.
  const report: { eventId: string; objects: number; bytes: number; keptObjects: number; byKind: Record<string, number> }[] = [];
  let totObjects = 0, totBytes = 0, totKept = 0;
  const kinds: Record<string, { objects: number; bytes: number }> = {};
  for (const id of dead) {
    const objs: { key: string; size: number }[] = [];
    let t: string | undefined;
    do {
      const r = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: `events/${id}/`, ContinuationToken: t }));
      for (const o of r.Contents ?? []) objs.push({ key: o.Key!, size: o.Size ?? 0 });
      t = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (t);

    const originals = objs.filter((o) => o.key.startsWith(`events/${id}/originals/`)).map((o) => o.key);
    const referenced = await keysStillReferenced(db, originals);
    const keep = new Set<string>();
    for (const k of referenced) {
      keep.add(k);
      for (const v of ["thumb-sm", "thumb-md", "thumb-lg"] as const) keep.add(getThumbnailKey(k, v));
      keep.add(getVideoDisplayKey(k));
    }
    const byKind: Record<string, number> = {};
    let bytes = 0, kept = 0;
    for (const o of objs) {
      if (keep.has(o.key)) { kept++; continue; }
      const kind = o.key.split("/")[2] ?? "(root)";
      byKind[kind] = (byKind[kind] ?? 0) + 1;
      kinds[kind] = { objects: (kinds[kind]?.objects ?? 0) + 1, bytes: (kinds[kind]?.bytes ?? 0) + o.size };
      bytes += o.size;
    }
    report.push({ eventId: id, objects: objs.length - kept, bytes, keptObjects: kept, byKind });
    totObjects += objs.length - kept; totBytes += bytes; totKept += kept;
  }

  const gb = (b: number) => (b / 1e9).toFixed(2) + " GB";
  console.log(`orphaned objects=${totObjects} (${gb(totBytes)}) across ${dead.length} dead folders; kept because a live row points at them=${totKept}`);
  for (const [k, v] of Object.entries(kinds).sort((a, b) => b[1].bytes - a[1].bytes)) console.log(`  ${k.padEnd(12)} ${String(v.objects).padStart(8)} objects  ${gb(v.bytes)}`);
  report.sort((a, b) => b.bytes - a.bytes);
  console.log("largest dead folders:");
  for (const r of report.slice(0, 8)) console.log(`  ${r.eventId}  ${r.objects} objects  ${gb(r.bytes)}  kept=${r.keptObjects}  ${JSON.stringify(r.byKind)}`);
  const out = process.argv[2];
  if (out) { fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), dead, report }, null, 1)); console.log("wrote", out); }
})().catch((e) => { console.error(e); process.exit(1); });
