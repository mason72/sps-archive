/**
 * Read-only: what Download All would hand out for each share of an event, by
 * section folder. Pass a second module path to compare with an older copy of
 * download-core (e.g. `git show HEAD:src/lib/gallery/download-core.ts`).
 *   npx tsx scripts/triage/zip-scope-compare.ts <eventId> [oldModulePath]
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
type Mod = typeof import("../../src/lib/gallery/download-core");
async function main() {
  const [eventId, oldPath] = process.argv.slice(2);
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const sb = createServiceClient();
  const mods: [string, Mod][] = [["new", await import("../../src/lib/gallery/download-core")]];
  if (oldPath) mods.unshift(["old", (await import(oldPath)) as Mod]);
  const { data: shares, error } = await sb.from("shares").select("*").eq("event_id", eventId).eq("is_active", true);
  if (error) throw error;
  for (const share of shares ?? []) {
    for (const [label, mod] of mods) {
      const r = await mod.selectDownloadImages(sb as never, share as never, {} as never);
      if (!r.ok) { console.log(`${share.share_type} ${label}: ${r.status} ${r.message}`); continue; }
      const loose = r.images.filter((i) => !r.sectionsByImage.get(i.id)?.length);
      const folders = new Map<string, number>();
      for (const fs_ of r.sectionsByImage.values()) for (const f of fs_) folders.set(f, (folders.get(f) ?? 0) + 1);
      console.log(`${share.share_type} ${label}: images=${r.images.length} bytes=${r.totalBytes} loose=${loose.length} [${loose.map((i) => i.original_filename).join(", ")}] folders=${JSON.stringify([...folders])}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
