/**
 * Live check for the share cover hero — the email <img>, the preview, and the
 * durable /api/gallery/[slug]/cover redirect they both point at.
 *
 * The load-bearing assertion is NOT "does it 302". It is that the fallback
 * chain never steps outside a selection share's scope: a hero that leaks a
 * frame the curation excluded is strictly worse than the 404 it replaced. So
 * for every selection share the redirect is resolved back to an image id via
 * its R2 key and checked against `shares.image_ids` — read from the database,
 * never inferred from what the route said.
 *
 * Context: until 2026-08-10 the email composer decided whether to attach a
 * hero from `events.settings.cover.imageId` while the route decided what to
 * serve from the share's scope. Four live selection shares had a cover sitting
 * outside their selection, so every email they sent carried a dead <img>. The
 * two decisions now share one home (src/lib/cover/resolve-share-cover.ts) and
 * this script is the guard on that.
 *
 *   npx tsx scripts/verify-share-cover.ts [apiBase]   # default :3000
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const API_BASE = process.argv[2] ?? "http://localhost:3000";
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok ? "" : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}

/** Mirrors getThumbnailKey(r2Key, "thumb-lg") so matching isn't URL sniffing. */
function thumbKey(r2Key: string): string {
  const parts = r2Key.split("/");
  if (parts.length < 4 || parts[2] !== "originals") return r2Key;
  const filename = parts.slice(3).join("/").replace(/\.[^.]+$/, ".jpg");
  return `events/${parts[1]}/thumbnails/thumb-lg/${filename}`;
}

const imgCache = new Map<string, { id: string; r2_key: string }[]>();
async function eventImages(eventId: string) {
  if (!imgCache.has(eventId)) {
    const rows: { id: string; r2_key: string }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin
        .from("images")
        .select("id, r2_key")
        .eq("event_id", eventId)
        .range(from, from + 999);
      if (error) throw error;
      if (!data?.length) break;
      rows.push(...data);
      if (data.length < 1000) break;
    }
    imgCache.set(eventId, rows);
  }
  return imgCache.get(eventId)!;
}

async function main() {
  const { data: shares, error } = await admin
    .from("shares")
    .select("slug, event_id, share_type, image_ids")
    .eq("is_active", true);
  if (error) throw error;

  const selection = (shares ?? []).filter((s) => s.share_type === "selection");
  const full = (shares ?? []).filter((s) => s.share_type !== "selection");

  console.log(`\nSELECTION shares (${selection.length}) — serves a frame, and only an in-scope one`);
  for (const s of selection) {
    const ids = Array.isArray(s.image_ids) ? (s.image_ids as string[]) : [];
    const r = await fetch(`${API_BASE}/api/gallery/${s.slug}/cover`, {
      redirect: "manual",
    });
    if (r.status !== 302) {
      check(`${s.slug} serves a cover`, false, { status: r.status, body: await r.text() });
      continue;
    }
    const loc = r.headers.get("location") ?? "";
    if (/covers\/cover-raster\.jpg/.test(loc)) {
      // Composed from the whole source section — can never be selection-safe.
      check(`${s.slug} did not serve the whole-section raster`, false, loc);
      continue;
    }
    const path = decodeURIComponent(new URL(loc).pathname).replace(/^\/+/, "");
    const served = (await eventImages(s.event_id)).find((i) => thumbKey(i.r2_key) === path);
    check(
      `${s.slug} → ${served?.id.slice(0, 8) ?? "?"} inside selection of ${ids.length}`,
      !!served && (ids.length === 0 || ids.includes(served.id)),
      { path, servedId: served?.id }
    );
  }

  console.log(`\nFULL shares (${full.length}) — a cover whenever the event has displayable images`);
  for (const s of full) {
    const r = await fetch(`${API_BASE}/api/gallery/${s.slug}/cover`, {
      redirect: "manual",
    });
    const { count } = await admin
      .from("images")
      .select("id", { count: "exact", head: true })
      .eq("event_id", s.event_id)
      .eq("thumbnail_generated", true);
    const expect = (count ?? 0) > 0 ? 302 : 404;
    check(`${s.slug} → ${r.status} (displayable images: ${count})`, r.status === expect);
  }

  console.log("\nRefusals");
  const bogus = await fetch(`${API_BASE}/api/gallery/definitely-not-a-slug/cover`, {
    redirect: "manual",
  });
  check(`unknown slug → ${bogus.status}`, bogus.status === 404);
  const { data: dead } = await admin
    .from("shares")
    .select("slug")
    .eq("is_active", false)
    .limit(3);
  if (!dead?.length) console.log("  – no inactive shares to test");
  for (const s of dead ?? []) {
    const r = await fetch(`${API_BASE}/api/gallery/${s.slug}/cover`, { redirect: "manual" });
    check(`inactive ${s.slug} → ${r.status}`, r.status === 404);
  }

  console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
