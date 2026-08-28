/**
 * E2E probe for guest-minted share links (built 2026-08-28).
 *
 *   npx tsx scripts/verify-guest-share.ts <apiBase> <eventId>
 *   npx tsx scripts/verify-guest-share.ts http://localhost:3005 28a6473a-…
 *
 * Creates a THROWAWAY parent share (slug prefix `tstg`) on the given event,
 * exercises the whole contract against a running server, and deletes every
 * row it made (children go with the parent via ON DELETE CASCADE):
 *
 *   1. mint            — valid ids under a full share → 201 + /gallery/ URL
 *   2. dedupe          — same ids again → the SAME slug, no second row
 *   3. scope           — an id from another event → 400
 *   4. payload         — the child serves EXACTLY the minted ids
 *   5. root collapse   — minting from the child records the ROOT parent
 *   6. password gate   — parent gains a password_hash → mint 401s w/o cookie
 *   7. opt-out         — sharing.guestShare=false → 403 (then key removed)
 *   8. cascade trigger — parent deactivated → child deactivates (migration 072)
 *
 * Requires .env.local (service key) and the dev server pointing at the same
 * database. Exits non-zero on the first failure.
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const [apiBase, eventId] = process.argv.slice(2);
if (!apiBase || !eventId) {
  console.error("usage: npx tsx scripts/verify-guest-share.ts <apiBase> <eventId>");
  process.exit(2);
}

let failures = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? "✓" : "✗ FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const testSlug = `tstg${Math.random().toString(36).slice(2, 8)}`;
  const cleanup = async () => {
    // Children cascade with the parent (FK ON DELETE CASCADE).
    await db.from("shares").delete().like("slug", "tstg%");
  };

  try {
    // ── fixtures: three real image ids from this event, one from another ──
    const { data: imgs } = await db
      .from("images")
      .select("id")
      .eq("event_id", eventId)
      .order("id")
      .limit(3);
    if (!imgs || imgs.length < 3) throw new Error("event has fewer than 3 images");
    const ids = imgs.map((r) => r.id);

    const { data: foreign } = await db
      .from("images")
      .select("id")
      .neq("event_id", eventId)
      .order("id")
      .limit(1);
    const foreignId = foreign?.[0]?.id;
    if (!foreignId) throw new Error("no foreign image found");

    const { error: pErr } = await db.from("shares").insert({
      event_id: eventId,
      slug: testSlug,
      share_type: "full",
      is_active: true,
      allow_download: true,
      allow_favorites: true,
    });
    if (pErr) throw new Error(`parent insert: ${pErr.message}`);
    const { data: parentRow } = await db
      .from("shares")
      .select("id")
      .eq("slug", testSlug)
      .single();
    const parentId = parentRow!.id;

    const mint = (slug: string, imageIds: unknown) =>
      fetch(`${apiBase}/api/gallery/${slug}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageIds }),
      });

    // 1. mint
    const r1 = await mint(testSlug, ids);
    const j1 = await r1.json();
    check("mint returns 201 + url", r1.status === 201 && !!j1?.share?.url, `status ${r1.status}`);
    const childSlug: string = j1?.share?.url?.split("/gallery/")[1] ?? "";

    // 2. dedupe (shuffled order must not matter)
    const r2 = await mint(testSlug, [...ids].reverse());
    const j2 = await r2.json();
    check(
      "same set dedupes to the same link",
      r2.status === 200 && j2?.share?.url?.endsWith(`/gallery/${childSlug}`),
      `status ${r2.status}, url ${j2?.share?.url}`
    );

    // 3. scope escalation
    const r3 = await mint(testSlug, [ids[0], foreignId]);
    check("foreign image id is refused", r3.status === 400, `status ${r3.status}`);

    // 4. child payload serves exactly the minted set
    const r4 = await fetch(`${apiBase}/api/gallery/${childSlug}`);
    const j4 = await r4.json();
    const served = ((j4?.images ?? []) as { id: string }[]).map((i) => i.id).sort();
    check(
      "child payload serves exactly the minted ids",
      r4.status === 200 && served.join() === [...ids].sort().join(),
      `served ${served.length} of ${ids.length}`
    );

    // 5. minting from the child collapses to the root parent
    const r5 = await mint(childSlug, [ids[0]]);
    const j5 = await r5.json();
    const grandSlug: string = j5?.share?.url?.split("/gallery/")[1] ?? "";
    const { data: grandRow } = await db
      .from("shares")
      .select("parent_share_id")
      .eq("slug", grandSlug)
      .single();
    check(
      "child-of-child records the ROOT parent",
      r5.ok && grandRow?.parent_share_id === parentId,
      `parent ${grandRow?.parent_share_id}`
    );
    const r5b = await mint(childSlug, [ids[0], foreignId]);
    check("child cannot reach past its own scope", r5b.status === 400, `status ${r5b.status}`);

    // 6. password gate: minting from behind a lock needs the cookie
    await db.from("shares").update({ password_hash: "$test$not-a-real-hash" }).eq("id", parentId);
    const r6 = await mint(testSlug, ids);
    check("locked parent 401s a cookieless mint", r6.status === 401, `status ${r6.status}`);
    await db.from("shares").update({ password_hash: null }).eq("id", parentId);

    // 7. photographer opt-out (write the key, assert, remove the key)
    const { data: ev } = await db.from("events").select("settings").eq("id", eventId).single();
    const settings = (ev?.settings ?? {}) as Record<string, unknown>;
    const sharing = { ...((settings.sharing ?? {}) as Record<string, unknown>) };
    const hadKey = "guestShare" in sharing;
    const prior = sharing.guestShare;
    await db
      .from("events")
      .update({ settings: { ...settings, sharing: { ...sharing, guestShare: false } } })
      .eq("id", eventId);
    const r7 = await mint(testSlug, [ids[1]]);
    check("guestShare:false refuses the mint", r7.status === 403, `status ${r7.status}`);
    if (hadKey) sharing.guestShare = prior;
    else delete sharing.guestShare;
    await db.from("events").update({ settings: { ...settings, sharing } }).eq("id", eventId);

    // 8. the migration-072 trigger: deactivating the parent kills the children
    await db.from("shares").update({ is_active: false }).eq("id", parentId);
    const { data: kids } = await db
      .from("shares")
      .select("slug, is_active")
      .eq("parent_share_id", parentId);
    check(
      "deactivating the parent deactivates every child",
      (kids ?? []).length > 0 && (kids ?? []).every((k) => !k.is_active),
      JSON.stringify(kids)
    );
    const r8 = await fetch(`${apiBase}/api/gallery/${childSlug}`);
    check("dead child 404s to guests", r8.status === 404, `status ${r8.status}`);
  } finally {
    await cleanup();
    const { data: leftovers } = await db.from("shares").select("slug").like("slug", "tstg%");
    console.log(leftovers?.length ? `⚠ leftovers: ${JSON.stringify(leftovers)}` : "cleanup: no test rows remain");
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
})();
