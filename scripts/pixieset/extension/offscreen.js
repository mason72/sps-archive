/**
 * The half that needs a DOM.
 *
 * WHY THIS EXISTS AT ALL. Every step of Pixieset's download flow returns HTML
 * that has to be parsed — the auth link, the set picker with its hidden fields,
 * the "ready" page with its zip anchors. A Manifest V3 service worker has no
 * DOMParser, so the parsing lives here in an offscreen document, which is a real
 * page context with no visible tab.
 *
 * It is also the surface that MATTERS. Cloudflare challenges the Playwright
 * browser on this machine — three attempts across 26 hours, the last one blocked
 * at the front door — while Mason's own Chrome gets HTTP 200 on the same URL in
 * the same minute. Fetches from here are that Chrome: same cookie jar, same TLS
 * stack, same profile. We are not evading anything; we are using the browser the
 * site already accepts, driven by a timer instead of a hand.
 *
 * The service worker owns scheduling and state. This file owns one collection at
 * a time and returns a plain result object. Keeping the split clean is what lets
 * Chrome kill the worker between collections without losing anything.
 */
const ORIGIN = "https://twodudesphoto.pixieset.com";
const SIZE_HIGH_RES = "1";     // Original. NEVER "4" — that is Web Size.
const DEST_MY_DEVICE = "0";    // DOM order is 0,2,1: read the value, not the position.
const TYPE_ID = "0";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (el) => (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
const parse = (html) => new DOMParser().parseFromString(html, "text/html");
const pathOf = (u) => { try { return new URL(u).pathname; } catch { return String(u); } };
const isGated = (u) => pathOf(u).includes("/guestlogin/");

/** Anything leaving this file is scrubbed: tokens must not reach a log or a transcript. */
const scrub = (s) => String(s ?? "")
  .replace(/[?&][^\s"'`)\]]*/g, "")
  .replace(/[A-Za-z0-9_-]{20,}/g, "<k>");

async function GET(url) {
  const r = await fetch(url, { credentials: "include" });
  return { url: r.url, status: r.status, html: await r.text() };
}
async function POST(url, params) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    credentials: "include",
  });
  return { url: r.url, status: r.status, html: await r.text() };
}

const anchors = (doc) =>
  [...doc.querySelectorAll("a[href]")].map((a) => ({ href: a.getAttribute("href"), text: text(a) }));

const zipAnchors = (doc) =>
  anchors(doc)
    .filter((a) => /\.zip/i.test(a.text))
    .map((a) => ({
      href: a.href,
      name: (a.text.match(/[^\s]+\.zip/i) || [null])[0],
      size: (a.text.match(/([\d.]+\s*[KMGT]B)/i) || [, null])[1],
    }));

/**
 * Prefer a set literally called "All Photos" — it is a superset, and the
 * double-count in `photo_count` comes from also counting "Your Favorites",
 * whose filenames all already appear in it. A gallery split into
 * Ceremony / Reception has no such set, so take every set and let the ingest
 * dedupe by filename after extraction.
 */
function resolveSets(doc) {
  const boxes = [...doc.querySelectorAll('input[name="Download[galleries][]"]')];
  const sets = boxes.map((i) => {
    const label = text(i.closest("label") || i.parentElement);
    const m = label.match(/(\d[\d,]*)\s+photos?/i);
    return {
      box: i,
      label: label.replace(/\s*\d[\d,]*\s+photos?.*$/i, "").trim() || label,
      count: m ? Number(m[1].replace(/,/g, "")) : null,
    };
  });
  const all = sets.find((s) => /^all photos\b/i.test(s.label));
  return { sets, chosen: all ? [all] : sets, branch: all ? "all-photos" : "every-set" };
}

/** Preserve every hidden field the form ships with — one of them is a CSRF token. */
function generateBody(doc, chosen) {
  const b = new URLSearchParams();
  for (const h of doc.querySelectorAll("form input[type=hidden]")) b.append(h.name, h.value);
  for (const c of chosen) b.append("Download[galleries][]", c.box.value);
  b.set("Download[download_size]", SIZE_HIGH_RES);
  b.set("download-destination", DEST_MY_DEVICE);
  b.set("Download[type_id]", TYPE_ID);
  return b;
}

/**
 * A gated collection needs its own gallery password, not an owner session.
 *
 * The form is PARSED rather than hard-coded: while an owner session is live,
 * /guestlogin/ redirects straight through, so its field names cannot be
 * inspected up front. Fill the password input, post every other field back
 * verbatim, and let the server tell us whether it worked.
 */
async function unlock(slug, password) {
  if (!password) return false;
  const g = await GET(`${ORIGIN}/guestlogin/${slug}/`);
  const form = parse(g.html).querySelector("form");
  if (!form) return false;
  const body = new URLSearchParams();
  let filled = false;
  for (const i of form.querySelectorAll("input")) {
    if (!i.name) continue;
    if (i.type === "password") { body.set(i.name, password); filled = true; }
    else body.set(i.name, i.value ?? "");
  }
  if (!filled) return false;
  const action = form.getAttribute("action");
  const r = await POST(action ? new URL(action, g.url).href : g.url, body);
  return !isGated(r.url);
}

/** Drive one collection to a set of zip URLs. Returns data only — no downloads. */
async function driveOne(slug, password, opts) {
  const t0 = Date.now();
  const out = { slug, ok: false, phase: "gallery", expect: null, zips: [], unlocked: false, error: null, sec: 0 };
  const notes = [];
  try {
    let g = await GET(`${ORIGIN}/${slug}/`);

    if (isGated(g.url)) {
      notes.push(password ? "gated — trying its password" : "gated — no password on record");
      if (password && (await unlock(slug, password))) {
        out.unlocked = true;
        g = await GET(`${ORIGIN}/${slug}/`);
      }
      if (isGated(g.url)) {
        out.phase = "gate";
        out.error = password ? "password rejected" : "gated, no password armed";
        return out;
      }
    }

    // Carry the status out so the scheduler can tell "gone" from "hiccup".
    out.httpStatus = g.status;
    if (g.status !== 200) { out.error = `HTTP ${g.status}`; return out; }

    // A challenge must STOP the run, never be worked around.
    if (/Just a moment|cf-mitigated|challenge-platform/i.test(g.html) && !/\/download\/auth\//.test(g.html)) {
      out.phase = "challenged";
      out.error = "Cloudflare challenge — stop, do not escalate";
      return out;
    }

    const m = g.html.match(/\/download\/auth\/[^"'\s\\]+/);
    if (!m) { out.phase = "nodl"; out.error = "downloads disabled on this collection"; return out; }

    out.phase = "auth";
    let r = await POST(new URL(m[0], ORIGIN).href,
      new URLSearchParams({ "DownloadLoginForm[email]": opts.email, yt0: "" }));
    let path = pathOf(r.url);
    let triedNew = false;
    let fileUrl = null;

    for (let hop = 0; hop < 5 && !fileUrl; hop++) {
      const doc = parse(r.html);

      if (path.includes("/download/exist/")) {
        // An EXISTING archive may be a client-generated Web Size copy, and
        // nothing downstream can tell it from originals except pixel dimensions.
        // Force a fresh High Resolution build first; fall back only if refused.
        const a = anchors(doc);
        const wantExisting = triedNew;
        const link = wantExisting
          ? a.find((x) => /download existing/i.test(x.text))
          : a.find((x) => /new download/i.test(x.text));
        if (!link) { out.error = "interstitial had neither branch link"; return out; }
        if (!wantExisting) triedNew = true;
        r = await GET(new URL(link.href, r.url).href);
        path = pathOf(r.url);
        if (path.includes("/download/auth/")) {
          const m2 = r.html.match(/\/download\/auth\/[^"'\s\\]+/) || [r.url];
          r = await POST(new URL(m2[0], ORIGIN).href,
            new URLSearchParams({ "DownloadLoginForm[email]": opts.email, yt0: "" }));
          path = pathOf(r.url);
        }
        continue;
      }

      if (path.includes("/download/sets/")) {
        out.phase = "sets";
        const res = resolveSets(doc);
        if (!res.sets.length) { out.error = "set picker had no sets"; return out; }
        out.expect = res.chosen.every((s) => s.count != null)
          ? res.chosen.reduce((a, s) => a + s.count, 0) : null;
        notes.push(`resolver=${res.branch} expect=${out.expect}`);
        out.phase = "generate";
        r = await POST(r.url, generateBody(doc, res.chosen));
        path = pathOf(r.url);
        continue;
      }

      if (path.includes("/download/file/")) { fileUrl = r.url; break; }

      out.error = `unexpected path ${path}`;
      return out;
    }
    if (!fileUrl) { out.error = "never reached the file page"; return out; }

    // Readiness is discovered by re-fetching: there is no poller on that page.
    // Small galleries are ready in seconds, a 40 GB one takes many minutes.
    out.phase = "poll";
    let ready = null;
    for (let i = 0; i < opts.pollTries; i++) {
      const p = await GET(fileUrl);
      if (/ready to download/i.test(p.html)) { ready = parse(p.html); break; }
      if (pathOf(p.url).includes("/download/exist/") || /already generated/i.test(p.html)) {
        const l = anchors(parse(p.html)).find((x) => /download existing/i.test(x.text));
        if (l) {
          const e = await GET(new URL(l.href, p.url).href);
          if (/ready to download/i.test(e.html)) { ready = parse(e.html); break; }
        }
      }
      await sleep(i < 20 ? 3000 : 10000);
    }
    if (!ready) { out.error = `not ready after ${opts.pollTries} polls`; return out; }

    const zips = zipAnchors(ready);
    if (!zips.length) { out.error = "ready page carried no zip links"; return out; }
    out.zips = zips.map((z) => ({ url: new URL(z.href, ORIGIN).href, name: z.name, size: z.size }));
    out.ok = true;
    out.phase = "ready";
    notes.push(`ready · ${zips.map((z) => z.size).join("+")}`);
    return out;
  } catch (e) {
    out.error = String(e?.message ?? e).slice(0, 180);
    return out;
  } finally {
    out.sec = Math.round((Date.now() - t0) / 1000);
    out.notes = notes.map(scrub);
    if (out.error) out.error = scrub(out.error);
  }
}

/**
 * Sweep every collection's gallery password out of Mason's own admin API.
 * Cross-origin with credentials is permitted here (host_permissions), verified
 * 2026-08-29. Values are returned to the service worker and stored in
 * chrome.storage.local — they are his clients' passwords and must never be
 * logged, printed, or sent anywhere else.
 */
async function armPasswords() {
  const map = {};
  let total = 0;
  for (let page = 1; page <= 90; page++) {
    const r = await fetch(`https://galleries.pixieset.com/api/v1/dashboard_listings?page=${page}`,
      { credentials: "include", headers: { "X-Requested-With": "XMLHttpRequest" } });
    if (!r.ok) throw new Error(`admin API HTTP ${r.status} — sign in to galleries.pixieset.com`);
    const j = await r.json();
    const d = j?.data ?? j;
    const cols = (d.data && d.data.collections) || d.collections || [];
    if (!cols.length) break;
    total += cols.length;
    for (const c of cols) {
      const p = c.password || c.private_password;
      if (p) map[c.url_key] = String(p);
    }
    await sleep(90);
  }
  return { map, total };
}

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg?.target !== "offscreen") return;
  if (msg.type === "drive") {
    driveOne(msg.slug, msg.password, msg.opts).then(respond);
    return true;                       // keep the channel open for async
  }
  if (msg.type === "arm") {
    armPasswords().then((r) => respond({ ok: true, ...r }))
      .catch((e) => respond({ ok: false, error: String(e?.message ?? e).slice(0, 180) }));
    return true;
  }
});
