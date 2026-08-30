/**
 * Pixieset download driver — runs as in-page JS in Mason's real, logged-in Chrome.
 *
 * WHY IT LIVES IN THE PAGE. Cloudflare challenges every non-browser client on both
 * Pixieset hosts (curl gets 403 `cf-mitigated: challenge`; Playwright loops on
 * Turnstile forever). In-page JS inherits the clearance cookie and is never
 * challenged. This is the only sanctioned automation surface — see
 * tasks/pixieset-migration.md. Do not try to defeat the protection.
 *
 * WHAT IT RETURNS. The Chrome extension REDACTS anything key-shaped, and a single
 * query-string-shaped field poisons the ENTIRE tool result ("[BLOCKED: Cookie/query
 * string data]") — you lose the whole run's report, not just the offending field.
 * So tokens are consumed in-page and never escape: `report()` emits counts, labels,
 * filenames and states only. `scrub()` is the one place that is enforced.
 *
 * THE STATE MACHINE, as probed live 2026-08-12. Branch on the LANDED PATH, never on
 * page copy and never on an assumption about which branch comes next — the same
 * collection takes different branches on different runs depending on server-side
 * state:
 *
 *   GET  /{slug}/                     → page carries /download/auth/{slug}/?dt=…
 *   POST /download/auth/{slug}/       → /download/sets/{slug}/   (no existing download)
 *                                     → /download/exist/{slug}/  (a completed one exists)
 *   POST /download/sets/{slug}/       → /download/file/{slug}/    ("preparing")
 *   GET  /download/file/{slug}/       → preparing | exist-interstitial | ready
 *   ready page                        → <a href="/download/filestart/…">slug-photo-download-NofM.zip  68.2 MB</a>
 *
 * THE FIDELITY TRAP. The interstitial's "DOWNLOAD EXISTING" may hand back a ZIP a
 * CLIENT generated at Web Size. It passes CRC, carries the right filenames and the
 * right file count — nothing downstream can tell it from originals except pixel
 * dimensions. So this driver prefers a FRESH High Resolution generation, and when it
 * cannot force one it says so (`fidelity: "existing-unknown"`) rather than guessing.
 * Never let that flag be dropped: `sampleDimensions()` in lib/archive.mjs is what
 * settles those, and it must be treated as mandatory for them.
 */
(() => {
  const VERSION = 4;   // 4: the email gate goes through the form, not the gallery link
  if (window.PX && window.PX.version === VERSION && window.PX.state === "running") {
    return `PX v${VERSION} already running`;
  }

  const SIZE_HIGH_RES = "1";
  const DEST_MY_DEVICE = "0";   // DOM order is 0,2,1 — read the value, never the position
  const TYPE_ID = "0";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * The only thing that may cross back into the agent's context.
   * Strips query strings and any long opaque run of key-ish characters.
   */
  const scrub = (s) =>
    String(s == null ? "" : s)
      .replace(/[?&][^\s"'`)\]]*/g, "")
      .replace(/[A-Za-z0-9_-]{20,}/g, "<k>");

  const text = (el) => (el && el.innerText ? el.innerText : "").replace(/\s+/g, " ").trim();
  const parse = (html) => new DOMParser().parseFromString(html, "text/html");

  /**
   * A challenge can arrive on ANY request, not just the first one.
   *
   * `download-pass.mjs` runs `preflight()` once and then makes a dozen more
   * requests per collection. When one of those is challenged the HTML that comes
   * back is Cloudflare's, not Pixieset's — so every downstream parse finds
   * nothing and reports a PARSE failure. On 2026-08-29 that surfaced as
   * `unexpected path /download/auth/`, which reads exactly like a rejected email
   * gate, and cost two sessions chasing an auth bug that did not exist: the
   * auth form handling was verified correct against the live form the same day.
   *
   * So the check belongs on the transport, where every request passes, rather
   * than once at the start. A challenged response is a DIFFERENT KIND of failure
   * from a page we could not parse, and the two must never be reported the same
   * way — one means stop and back off, the other means fix the selector.
   */
  const looksChallenged = (status, html) =>
    status === 403 || /just a moment|cf-mitigated|__cf_chl|challenge-platform/i.test(html || "");

  async function GET(url) {
    const r = await fetch(url, { credentials: "include" });
    const html = await r.text();
    return { url: r.url, status: r.status, html, challenged: looksChallenged(r.status, html) };
  }
  async function POST(url, params) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      credentials: "include",
    });
    const html = await r.text();
    return { url: r.url, status: r.status, html, challenged: looksChallenged(r.status, html) };
  }

  /**
   * Choose which sets to download.
   *
   * Prefer a set labelled "All Photos" — it is a superset, and the double-count in
   * `photo_count` comes precisely from also counting "Your Favorites", whose
   * filenames all already appear in All Photos. When no such set exists (a gallery
   * split into Ceremony / Reception has none), take EVERY set and dedupe by filename
   * after extraction. The branch is always logged: a silent resolver is how
   * collections vanish without anyone noticing — the same rule as the Dropbox
   * `Output` folder resolver.
   */
  function resolveSets(doc) {
    const boxes = [...doc.querySelectorAll('input[name="Download[galleries][]"]')];
    const labelOf = (i) => text(i.closest("label") || i.parentElement);
    const sets = boxes.map((i) => {
      const label = labelOf(i);
      const m = label.match(/(\d[\d,]*)\s+photos?/i);
      return { box: i, label: label.replace(/\s*\d[\d,]*\s+photos?.*$/i, "").trim() || label, count: m ? Number(m[1].replace(/,/g, "")) : null };
    });
    const all = sets.find((s) => /^all photos\b/i.test(s.label));
    const chosen = all ? [all] : sets;
    return { sets, chosen, branch: all ? "all-photos" : "every-set" };
  }

  /** Build the generate POST, preserving every hidden field the form ships with. */
  function generateBody(doc, chosen, size) {
    const b = new URLSearchParams();
    for (const h of doc.querySelectorAll("form input[type=hidden]")) b.append(h.name, h.value);
    for (const c of chosen) b.append("Download[galleries][]", c.box.value);
    b.set("Download[download_size]", size);
    b.set("download-destination", DEST_MY_DEVICE);
    b.set("Download[type_id]", TYPE_ID);
    return b;
  }

  const anchors = (doc) =>
    [...doc.querySelectorAll("a[href]")].map((a) => ({ href: a.getAttribute("href"), text: text(a) }));

  const zipAnchors = (doc) =>
    anchors(doc)
      .filter((a) => /\.zip/i.test(a.text))
      .map((a) => {
        const name = (a.text.match(/[^\s]+\.zip/i) || [null])[0];
        const size = (a.text.match(/([\d.]+\s*[KMGT]B)/i) || [null, null])[1];
        return { href: a.href, name, size };
      });

  const isReady = (html) => /ready to download/i.test(html);
  const pathOf = (u) => { try { return new URL(u).pathname; } catch { return String(u); } };

  /**
   * Pass the email gate: GET the auth page, then POST ITS OWN form.
   *
   * The gallery page carries `/download/auth/{slug}/?dt={token}`. POSTing straight
   * at that URL — which this driver did until 2026-08-28 — skips the exchange the
   * GET performs, and the gate simply re-serves itself. The driver then reported
   * `unexpected path /download/auth/…` and every collection failed at phase
   * `auth`, which reads exactly like an expired login but is not one.
   *
   * Read the action and the submit button's value off the returned form rather
   * than hard-coding them: Yii uses the button's value as its submit marker, and
   * the action carries a fresh key that is not the `dt` token we arrived with.
   * Any hidden fields the form ships with are preserved for the same reason the
   * generate POST preserves them — an unguessable field added later would
   * otherwise break this silently.
   */
  async function authenticate(url, email) {
    const page = await GET(url);
    if (page.challenged) return { r: page, usedForm: false, challenged: true };
    const doc = parse(page.html);
    const form = doc.querySelector('form[action*="/download/auth/"]') || doc.querySelector("form");
    if (!form) return { r: page, usedForm: false };
    const action = new URL(form.getAttribute("action") || url, page.url).href;
    const body = new URLSearchParams();
    for (const h of form.querySelectorAll("input[type=hidden]")) body.append(h.name, h.value);
    body.set("DownloadLoginForm[email]", email);
    const submit = form.querySelector("input[type=submit],button[type=submit]");
    body.set("yt0", submit ? (submit.getAttribute("value") || "") : "");
    return { r: await POST(action, body), usedForm: true };
  }

  /**
   * Drive one collection to a set of ZIP links.
   *
   * `preferExisting` should be true ONLY when our own queue says WE requested this
   * collection inside the 7-day window — that is the cheap, safe re-fetch. For a
   * first request it must be false, or a client's Web Size archive can be adopted as
   * if it were the originals.
   */
  async function driveOne(job, opts, log) {
    const t0 = Date.now();
    const out = {
      id: job.id, slug: job.slug, name: job.name || null,
      ok: false, phase: "gallery", branch: null, setBranch: null,
      sets: null, chosen: null, expectedFiles: null,
      zips: [], fidelity: null, elapsedMs: 0, error: null, notes: [],
    };
    const note = (m) => { out.notes.push(m); log(`[${job.slug}] ${m}`); };

    try {
      // 1 — the gallery page carries the download-auth link (with its dt token).
      const g = await GET(`${location.origin}/${job.slug}/`);
      if (g.challenged) {
        out.error = "CHALLENGED at the gallery page — Cloudflare served a challenge. Stop; do not retry.";
        return out;
      }
      if (g.status !== 200) { out.error = `gallery HTTP ${g.status}`; return out; }
      // A gallery with its own password redirects to /guestlogin/{slug}/ when the
      // session is not the owner. The owner session hid this until 2026-08-21, when
      // it expired and hobartholidayparty2015 landed here. It is NOT "downloads
      // disabled" — the inventory's collection_download flag is true for these —
      // and it must not be reported as such, or the queue treats a login problem as
      // a settings problem. Branch on the LANDED path, per the header.
      if (pathOf(g.url).includes("/guestlogin/")) {
        out.phase = "gate";
        out.error = "password-gated (guest login) — needs a signed-in owner session";
        return out;
      }
      const m = g.html.match(/\/download\/auth\/[^"'\s\\]+/);
      if (!m) {
        // No redirect and no auth link: downloads really are switched off here.
        out.error = "no download-auth link on gallery page (downloads disabled)";
        return out;
      }

      // 2 — the email gate. Lands on the set picker OR the exist interstitial.
      out.phase = "auth";
      const gate = await authenticate(new URL(m[0], location.origin).href, opts.email);
      if (gate.challenged) {
        // Not an auth problem. Say so in the words the operator needs to hear,
        // because the remedy is the opposite of a code fix: stop, back off, and
        // do not retry. See looksChallenged().
        out.error = "CHALLENGED at the email gate — Cloudflare served a challenge, not the form. Stop; do not retry.";
        return out;
      }
      let r = gate.r;
      let path = pathOf(r.url);
      note(`auth → ${path}${gate.usedForm ? "" : " (no form found — posted blind)"}`);

      // 3 — walk the branches to the file page. Bounded: these can bounce.
      let triedNew = false;
      let fileUrl = null;
      for (let hop = 0; hop < 5 && !fileUrl; hop++) {
        const doc = parse(r.html);

        if (path.includes("/download/exist/")) {
          out.branch = "exist-interstitial";
          const a = anchors(doc);
          const wantExisting = opts.preferExisting || triedNew;
          const link = wantExisting
            ? a.find((x) => /download existing/i.test(x.text))
            : a.find((x) => /new download/i.test(x.text));
          if (!link) { out.error = "interstitial had neither branch link"; return out; }
          if (wantExisting) {
            // Could be anyone's archive, at any size. Say so; do not assume.
            out.fidelity = opts.preferExisting ? "existing-ours" : "existing-unknown";
            note(`taking DOWNLOAD EXISTING (fidelity: ${out.fidelity})`);
          } else {
            triedNew = true;
            note("taking NEW DOWNLOAD to force a fresh High Resolution generation");
          }
          r = await GET(new URL(link.href, r.url).href);
          path = pathOf(r.url);
          note(`→ ${path}`);
          // Observed: NEW DOWNLOAD can bounce back to the auth gate. Re-POST it.
          if (path.includes("/download/auth/")) {
            // Same exchange as the first gate — go through the form, not the link.
            r = (await authenticate(r.url, opts.email)).r;
            path = pathOf(r.url);
            note(`re-auth → ${path}`);
          }
          continue;
        }

        if (path.includes("/download/sets/")) {
          out.phase = "sets";
          const res = resolveSets(doc);
          if (!res.sets.length) { out.error = "set picker had no sets"; return out; }
          out.setBranch = res.branch;
          out.sets = res.sets.map((s) => ({ label: s.label, count: s.count }));
          out.chosen = res.chosen.map((s) => s.label);
          // An INDEPENDENT expected-file count, from the picker rather than from the
          // inventory's double-counted photo_count. This is the honest target.
          out.expectedFiles = res.chosen.every((s) => s.count != null)
            ? res.chosen.reduce((a, s) => a + s.count, 0) : null;
          note(`resolver=${res.branch} sets=${res.sets.length} chosen=${res.chosen.length} expect=${out.expectedFiles}`);

          out.phase = "generate";
          r = await POST(r.url, generateBody(doc, res.chosen, opts.size || SIZE_HIGH_RES));
          path = pathOf(r.url);
          if (out.fidelity == null) out.fidelity = opts.size === "4" ? "fresh-web-size" : "fresh-high-res";
          note(`generate → ${path}`);
          continue;
        }

        if (path.includes("/download/file/")) { fileUrl = r.url; break; }

        out.error = `unexpected path ${path}`;
        return out;
      }
      if (!fileUrl) { out.error = "never reached the file page"; return out; }

      // 4 — poll. There is no JS poller and no meta-refresh on the preparing page:
      // readiness is discovered by re-fetching the file URL. Small galleries are
      // ready in ~2s; big ones take minutes, so back off rather than hammering.
      out.phase = "poll";
      let ready = null;
      for (let i = 0; i < opts.pollTries; i++) {
        const p = await GET(fileUrl);
        if (isReady(p.html)) { ready = parse(p.html); break; }
        if (pathOf(p.url).includes("/download/exist/") || /already generated/i.test(p.html)) {
          const link = anchors(parse(p.html)).find((x) => /download existing/i.test(x.text));
          if (link) {
            const e = await GET(new URL(link.href, p.url).href);
            if (isReady(e.html)) { ready = parse(e.html); break; }
          }
        }
        await sleep(i < 20 ? 3000 : 10000);
      }
      if (!ready) { out.error = `not ready after ${opts.pollTries} polls`; out.phase = "poll"; return out; }

      const zips = zipAnchors(ready);
      if (!zips.length) { out.error = "ready page carried no zip links"; return out; }
      out.zips = zips.map((z) => ({ name: z.name, size: z.size }));
      note(`ready · ${zips.map((z) => `${z.name} ${z.size}`).join(" | ")}`);

      // 5 — hand the URLs to Chrome's downloader. It saves to ~/Downloads with the
      // filename shown above, unattended (verified: no save dialog). The watcher
      // matches on that filename, which is deterministic: {slug}-photo-download-NofM.zip
      out.phase = "download";
      for (const z of zips) {
        const el = document.createElement("a");
        el.href = new URL(z.href, location.origin).href;
        el.download = "";
        el.style.display = "none";
        document.body.appendChild(el);
        el.click();
        await sleep(900);           // stagger: simultaneous clicks can drop one
        el.remove();
      }
      out.ok = true;
      out.phase = "done";
      return out;
    } catch (e) {
      out.error = String(e && e.message ? e.message : e).slice(0, 200);
      return out;
    } finally {
      out.elapsedMs = Date.now() - t0;
    }
  }

  window.PX = {
    version: VERSION,
    state: "idle",
    results: [],
    log: [],

    /**
     * Drive `jobs` sequentially. Sequential on purpose: this is someone's paid
     * account behind bot protection, and a burst of parallel generate requests is
     * the shape that gets an account limited. Throughput here is bounded by
     * Pixieset's ZIP builder anyway, not by our concurrency.
     */
    run(jobs, options) {
      if (this.state === "running") return "already running";
      const opts = Object.assign(
        { email: "mason72@gmail.com", preferExisting: false, size: SIZE_HIGH_RES, pollTries: 120, gapMs: 2000 },
        options || {}
      );
      this.state = "running";
      this.results = [];
      this.log = [];
      const log = (m) => this.log.push(m);
      (async () => {
        for (const job of jobs) {
          const r = await driveOne(job, opts, log);
          this.results.push(r);
          await sleep(opts.gapMs);
        }
        this.state = "done";
      })();
      return `PX v${VERSION} running ${jobs.length} job(s)`;
    },

    /** Sanitized status. Safe to return through the extension. */
    report() {
      return JSON.stringify({
        state: this.state,
        done: this.results.length,
        results: this.results.map((r) => ({
          id: r.id, slug: r.slug, ok: r.ok, phase: r.phase,
          branch: r.branch, setBranch: r.setBranch,
          sets: r.sets, chosen: r.chosen, expectedFiles: r.expectedFiles,
          zips: r.zips, fidelity: r.fidelity,
          seconds: Math.round(r.elapsedMs / 1000),
          error: r.error ? scrub(r.error) : null,
        })),
        log: this.log.map(scrub),
      }, null, 1);
    },
  };

  return `PX v${VERSION} installed`;
})();
