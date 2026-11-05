/**
 * Read-only: did a pulled gallery get its SPS client logo?
 *
 *   npx tsx scripts/triage/sps-cover-logo-probe.ts --list [--name <text>]
 *   npx tsx scripts/triage/sps-cover-logo-probe.ts <archiveEventId> [--raster]
 *
 * `--list` asks SPS (with the stored connection token, never printed) for the
 * importable events and says which carry `logoUrl`, which SPS image it is
 * (`background` = the gallery Background Image, `header` = the header logo,
 * read from the file name SPS gives each), the `logoBackground` colors sent
 * with it and the Insert fill the pull would paint: the production proof that
 * the SPS side of the contract is live. `--name` filters by event name.
 *
 * With an archive event id it prints what the row says (`cover.type`,
 * `logoMode`, `logoKey`), whether the object behind the key exists in R2 and
 * what it is, the Insert fill, and whether the key is pinned to this event
 * (the IDOR guard).
 * `--raster` also asks `coverRasterStatus`, which ENQUEUES a regeneration
 * when the raster is missing or stale; that is the one side effect here, so
 * it is opt-in.
 *
 * Exit 0 when the logo is in place (or `--list` ran), 2 when the row names a
 * logo the bucket does not hold or the gallery has none, 1 when the probe
 * itself failed.
 */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const args = process.argv.slice(2);
  const { createServiceClient } = await import("@/lib/supabase/server");
  const supabase = createServiceClient();

  if (args.includes("--list")) {
    const { getSpsToken } = await import("@/lib/sps-integration/connection");
    const { listSpsEvents } = await import("@/lib/sps-integration/pull-client");
    const { logoInsertFill } = await import("@/lib/sps-integration/pull-logo");
    const nameAt = args.indexOf("--name");
    const nameFilter = nameAt >= 0 ? (args[nameAt + 1] ?? "").toLowerCase() : "";
    const { data: conn, error } = await supabase
      .from("sps_connections")
      .select("user_id")
      .limit(5);
    if (error) throw error;
    if (!conn?.length) throw new Error("no sps_connections row");
    for (const c of conn) {
      const token = await getSpsToken(supabase, c.user_id);
      if (!token) continue;
      const events = await listSpsEvents(token);
      const withLogo = events.filter((e) => !!e.logoUrl);
      const sent = events.filter((e) => "logoUrl" in e);
      const sentBg = events.filter((e) => "logoBackground" in e);
      console.log(`user ${c.user_id.slice(0, 8)}: ${events.length} events; logoUrl field present on ${sent.length}; set on ${withLogo.length}; logoBackground field present on ${sentBg.length}`);
      const shown = withLogo.filter((e) => !nameFilter || e.name.toLowerCase().includes(nameFilter));
      for (const e of shown.slice(0, nameFilter ? 50 : 8)) {
        let host = "(bad url)";
        try { host = new URL(e.logoUrl!).host; } catch { /* keep */ }
        const source = /-background-/.test(e.logoUrl!) ? "background" : /-header-/.test(e.logoUrl!) ? "header" : "?";
        const colors = e.logoBackground?.colors?.join(",") ?? "none";
        console.log(`  ${e.id} | ${e.name} | ${e.imageCount ?? "?"} imgs | ${source} logo on ${host} | bg ${colors} -> fill ${logoInsertFill(e.logoBackground) ?? "(default)"}`);
      }
    }
    return 0;
  }

  const eventId = args.find((a) => !a.startsWith("--"));
  if (!eventId) {
    console.error("usage: sps-cover-logo-probe.ts --list | <archiveEventId> [--raster]");
    return 1;
  }

  const { normalizeCoverSettings, pinnedCoverLogoKey } = await import("@/types/event-settings");
  const { getObjectMetadata } = await import("@/lib/r2/client");

  const { data: ev, error } = await supabase
    .from("events")
    .select("id, name, settings")
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw error;
  if (!ev) throw new Error(`no archive event ${eventId}`);

  const cover = normalizeCoverSettings(((ev.settings ?? {}) as Record<string, unknown>).cover);
  const key = cover.mosaic?.logoKey;
  console.log(`event      : ${ev.name}`);
  console.log(`insert fill: ${cover.mosaic?.insert.fill ?? "-"}`);
  console.log(`cover      : type=${cover.type} enabled=${cover.enabled} logoMode=${cover.mosaic?.logoMode ?? "-"} title=${cover.hideTitle ? "hidden" : `${cover.titlePosition}/${cover.titleAlignment}`}`);
  console.log(`logoKey    : ${key ?? "(none)"}`);
  if (!key) return 2;
  console.log(`pinned     : ${pinnedCoverLogoKey(ev.id, key) ? "yes" : "NO — a foreign key, the sinks will ignore it"}`);

  const meta = await getObjectMetadata(key);
  if (!meta) {
    console.log("r2 object  : MISSING");
    return 2;
  }
  console.log(`r2 object  : present, ${JSON.stringify(meta)}`);

  if (args.includes("--raster")) {
    const { coverRasterStatus } = await import("@/lib/cover/pool");
    const status = await coverRasterStatus(ev.id, cover);
    console.log(`raster     : ${status ?? "not needed"}${status && status !== "fresh" ? " (regeneration enqueued)" : ""}`);
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("probe failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
);
