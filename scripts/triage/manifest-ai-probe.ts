/**
 * Scratch: does the live SPS manifest now send AI renders, and what do they
 * look like? Finds an event by name fragment, reads page 0, counts rows with
 * sourceImageId, prints one. Read-only.
 *
 *   npx tsx scripts/triage/manifest-ai-probe.ts "Core SJC"
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const needle = (process.argv[2] ?? "").toLowerCase();
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { listSpsEvents, fetchManifestPage } = await import(
    "../../src/lib/sps-integration/pull-client"
  );
  const supabase = createServiceClient();
  const { data: conn } = await supabase
    .from("sps_connections").select("token").limit(1).maybeSingle();
  if (!conn) throw new Error("No SPS connection stored.");
  const events = await listSpsEvents(conn.token);
  const ev = events.find((e) => e.name.toLowerCase().includes(needle));
  if (!ev) throw new Error(`no event matching "${needle}"`);
  const page = await fetchManifestPage(conn.token, ev.id, 0);
  const renders = page.images.filter((i) => i.sourceImageId);
  console.log(`${ev.name} (${ev.id}) live=${ev.live ?? false} imageCount=${ev.imageCount}`);
  console.log(`page 0: ${page.images.length} rows, ${renders.length} renders, nextOffset=${page.nextOffset ?? "none"}`);
  const r = renders[0];
  if (r) {
    console.log("sample render:", JSON.stringify({
      originalFilename: r.originalFilename, mimeType: r.mimeType, quality: r.quality,
      sourceImageId: r.sourceImageId, urlHost: new URL(r.url).host, hasThumb: !!r.thumbUrl,
    }));
    for (const [label, u] of [["thumbUrl", r.thumbUrl], ["url", r.url]] as const) {
      if (!u) { console.log(label, "(none)"); continue; }
      const h = await fetch(u, { method: "GET", headers: { Range: "bytes=0-0" } });
      console.log(label, h.status, h.headers.get("content-type"), h.headers.get("content-length") ?? h.headers.get("content-range"), u.split("?")[0].slice(-60));
    }
    const src = page.images.find((i) => i.id === r.sourceImageId);
    console.log("its source on the same page:", src ? src.originalFilename : "(not on page 0)");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
