/**
 * Live E2E driver for the gallery-password feature (one-off verification).
 *
 * Everything runs over real HTTP against a dev server, with a REAL Supabase
 * session — no hand-rolled stand-ins for the route logic, because the whole
 * point is to catch a write-through that silently doesn't happen.
 *
 * The central assertion is deliberately cross-path: the OWNER endpoint does
 * the writing (PUT /api/events/[id]/gallery-password), and the GUEST endpoint
 * does the checking (POST /api/gallery/[slug]/verify, PBKDF2 against
 * shares.password_hash). If the write-through to live shares broke, the guest
 * side 401s on the correct password — a guard that shares no assumption with
 * the thing it guards.
 *
 * Self-contained: creates its own throwaway user, event, images and shares,
 * and deletes all of it in a finally block.
 *
 *   npx tsx scripts/verify-gallery-password.ts [apiBase]   # default :3000
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const API_BASE = process.argv[2] ?? "http://localhost:3000";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PROJECT_REF = new global.URL(URL).hostname.split(".")[0];

const admin = createClient(URL, SERVICE);

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}

/** The cookie @supabase/ssr reads a session out of, in its base64- format. */
function sessionCookie(session: { access_token: string; refresh_token: string }) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64");
  return `sb-${PROJECT_REF}-auth-token=base64-${payload}`;
}

async function makeUser(tag: string) {
  const email = `pt-verify-${tag}-${Date.now()}@example.com`;
  const password = `Verify!${Math.random().toString(36).slice(2)}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;

  const anonClient = createClient(URL, ANON);
  const { data: signIn, error: signInError } =
    await anonClient.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  return { id: data.user!.id, cookie: sessionCookie(signIn.session!) };
}

async function main() {
  const created: { users: string[]; events: string[] } = { users: [], events: [] };

  try {
    const owner = await makeUser("owner");
    const stranger = await makeUser("stranger");
    created.users.push(owner.id, stranger.id);

    // ── Fixture: an event with images (dominant colors feed the gate's
    // fallback backdrop) and two active shares + one revoked one.
    const { data: event, error: eventError } = await admin
      .from("events")
      .insert({
        user_id: owner.id,
        name: "Password Verify Event",
        slug: `pw-verify-${Date.now()}`,
        settings: {},
      })
      .select()
      .single();
    if (eventError) throw eventError;
    created.events.push(event.id);

    const COLORS = ["#8a6f4e", "#2f4858", "#d9c8b4", "#5b7c6a"];
    const { error: imgError } = await admin.from("images").insert(
      COLORS.map((hex, i) => ({
        event_id: event.id,
        r2_key: `verify/${event.id}/${i}.jpg`,
        filename: `verify-${i}.jpg`,
        original_filename: `verify-${i}.jpg`,
        dominant_color: hex,
        file_size: 1024,
        mime_type: "image/jpeg",
        thumbnail_generated: true,
        width: 1600,
        height: 1067,
      }))
    );
    if (imgError) throw imgError;

    const { data: shares, error: shareError } = await admin
      .from("shares")
      .insert([
        { event_id: event.id, slug: `vfy-a-${Date.now()}`, is_active: true },
        { event_id: event.id, slug: `vfy-b-${Date.now()}`, is_active: true },
        { event_id: event.id, slug: `vfy-x-${Date.now()}`, is_active: false },
      ])
      .select();
    if (shareError) throw shareError;
    const [liveA, liveB, revoked] = shares!;

    const setPassword = (cookie: string, password: string) =>
      fetch(`${API_BASE}/api/events/${event.id}/gallery-password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ password }),
      });

    // ── 1. Ownership scoping (the lessons #2/#14 class — the service client
    //       bypasses RLS, so the user_id filter IS the access control).
    const idor = await setPassword(stranger.cookie, "hijacked");
    check("stranger cannot set another owner's password", idor.status === 404, {
      status: idor.status,
    });
    const { data: untouched } = await admin
      .from("shares")
      .select("password_hash")
      .eq("id", liveA.id)
      .single();
    check("…and no hash was written by the attempt", !untouched?.password_hash);

    // Middleware may bounce anonymous callers before the handler runs — any
    // non-2xx is a pass here; what must never happen is a write.
    const anonPut = await fetch(
      `${API_BASE}/api/events/${event.id}/gallery-password`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "nope" }),
        redirect: "manual",
      }
    );
    check("unauthenticated PUT is rejected", !anonPut.ok, {
      status: anonPut.status,
    });

    // ── 2. Setting the password writes through to every ACTIVE share.
    const PASSWORD = "amber-cedar-42";
    const setRes = await setPassword(owner.cookie, PASSWORD);
    const setBody = await setRes.json();
    check("owner PUT succeeds", setRes.ok, setBody);
    check("reports 2 live links updated", setBody.sharesUpdated === 2, setBody);
    check("reports protected", setBody.isProtected === true, setBody);

    const { data: after } = await admin
      .from("shares")
      .select("id, password_hash")
      .eq("event_id", event.id);
    const hashOf = (id: string) =>
      after!.find((s) => s.id === id)?.password_hash ?? null;
    check("live share A hashed", !!hashOf(liveA.id));
    check("live share B hashed", !!hashOf(liveB.id));
    check("revoked share left alone", hashOf(revoked.id) === null);
    check(
      "stored value is a PBKDF2 hash, not the plaintext",
      hashOf(liveA.id)!.startsWith("pbkdf2:") && !hashOf(liveA.id)!.includes(PASSWORD)
    );

    // ── 3. The guest side agrees — the cross-path assertion.
    const gated = await (await fetch(`${API_BASE}/api/gallery/${liveA.slug}`)).json();
    check("guest gets requiresAuth", gated.requiresAuth === true, gated);
    check("guest gets NO images", gated.images === undefined);
    check("gate payload carries a palette", Array.isArray(gated.palette) && gated.palette.length > 0, gated.palette);
    check(
      "palette is only #RRGGBB colors — no URLs, no keys",
      (gated.palette ?? []).every((c: string) => /^#[0-9a-f]{6}$/i.test(c)),
      gated.palette
    );
    check("gate reports hasCover=false for a coverless event", gated.hasCover === false);

    const verify = (slug: string, password: string) =>
      fetch(`${API_BASE}/api/gallery/${slug}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

    check("wrong password rejected", (await verify(liveA.slug, "wrong-one")).status === 401);
    const ok = await verify(liveA.slug, PASSWORD);
    check("correct password accepted on share A", ok.ok, { status: ok.status });
    check(
      "…and sets the gallery auth cookie",
      (ok.headers.get("set-cookie") ?? "").includes(`gallery_auth_${liveA.slug}`)
    );
    check(
      "same password works on share B (write-through, not one-link)",
      (await verify(liveB.slug, PASSWORD)).ok
    );

    // ── 4. A share created AFTER the password is set must inherit it. This is
    //       the hazard the email composer hits: it auto-creates a share
    //       WITHOUT useEventDefaults, and would otherwise announce an
    //       unprotected gallery in the very email saying it's protected.
    const created3 = await fetch(`${API_BASE}/api/shares`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ eventId: event.id }),
    });
    const newShare = (await created3.json()).share;
    check("new share (no useEventDefaults) is protected", newShare?.isPasswordProtected === true, newShare);
    check("…and the event password actually opens it", (await verify(newShare.slug, PASSWORD)).ok);

    // ── 5. Clearing removes protection everywhere.
    const clearBody = await (await setPassword(owner.cookie, "")).json();
    check("clearing reports not protected", clearBody.isProtected === false, clearBody);
    const open = await (await fetch(`${API_BASE}/api/gallery/${liveA.slug}`)).json();
    check("gallery is open again", !open.requiresAuth && Array.isArray(open.images), {
      requiresAuth: open.requiresAuth,
    });

    // ── 6. A trailing space must not create an unguessable password.
    await setPassword(owner.cookie, "  spaced-out  ");
    check("password is trimmed on save", (await verify(liveA.slug, "spaced-out")).ok);
    await setPassword(owner.cookie, "");
  } finally {
    for (const id of created.events) {
      await admin.from("shares").delete().eq("event_id", id);
      await admin.from("images").delete().eq("event_id", id);
      await admin.from("events").delete().eq("id", id);
    }
    for (const id of created.users) {
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
    console.log("\n— fixtures cleaned up —");
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
