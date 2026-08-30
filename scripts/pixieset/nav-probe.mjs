#!/usr/bin/env node
/**
 * Does a NAVIGATION-driven flow pass where in-page fetch is challenged?
 *
 *   node scripts/pixieset/nav-probe.mjs [slug]
 *
 * WHY. Measured 2026-08-29, five seconds apart on one browser and origin:
 * `page.goto()` returned HTTP 200 with no challenge, and the very next in-page
 * `fetch()` to the same host was challenged. `driver.js` does every step through
 * fetch, so it dies immediately after a preflight that looks perfectly healthy.
 *
 * That suggests the flow should be driven the way a person drives it — real
 * navigations, a real click on the submit button — rather than by scripted XHR.
 * This probe tests ONLY that hypothesis, before any rewrite of the tested
 * driver.js state machine is justified. It stops at the set picker: it does not
 * choose sets, does not generate an archive, and downloads nothing.
 *
 * This is not an evasion. There is no UA spoofing, no stealth plugin, no TLS
 * mimicry and no challenge solver here, and none may ever be added. It uses the
 * ordinary browser flow instead of a shortcut around it. If a navigation-driven
 * run is ALSO challenged, the answer is that this origin does not want to be
 * automated at all — report that and stop, per the rule in download-pass.mjs.
 *
 * ONE run. It prints a verdict and exits.
 */
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOST = "https://twodudesphoto.pixieset.com";
const SLUG = process.argv[2] || "purestoragebodgroupportrait";
const EMAIL = process.env.PIXIESET_NOTIFY_EMAIL || "mason72@gmail.com";
const PROFILE = join(HERE, "profile-chrome");

const challenged = (status, html) =>
  status === 403 || /just a moment|cf-mitigated|__cf_chl|challenge-platform/i.test(html || "");

const log = (m) => console.log(`${new Date().toISOString().slice(11, 19)}  ${m}`);
let verdict = "UNKNOWN";

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false, channel: "chrome", acceptDownloads: true,
  viewport: { width: 1280, height: 900 }, args: ["--window-position=-32000,-32000"],
});
try {
  const page = ctx.pages()[0] || (await ctx.newPage());

  // 1 — the gallery, by NAVIGATION (this is the step that was challenged as a fetch)
  let r = await page.goto(`${HOST}/${SLUG}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  let html = await page.content();
  log(`gallery nav → HTTP ${r.status()}${challenged(r.status(), html) ? "  ✗ CHALLENGED" : "  ok"}`);
  if (challenged(r.status(), html)) { verdict = "CHALLENGED-ON-NAVIGATION"; throw new Error("stop"); }

  // 2 — the auth link, read off the DOM we are already on. No fetch involved.
  const authHref = await page.evaluate(() => {
    const a = document.querySelector('a[href*="/download/auth/"]');
    if (a) return a.getAttribute("href");
    const m = document.documentElement.innerHTML.match(/\/download\/auth\/[^"'\s>]+/);
    return m ? m[0] : null;
  });
  if (!authHref) { verdict = "NO-AUTH-LINK (downloads disabled?)"; throw new Error("stop"); }
  log(`auth link found`);

  // 3 — the gate, by NAVIGATION
  r = await page.goto(new URL(authHref, HOST).href, { waitUntil: "domcontentloaded", timeout: 60000 });
  html = await page.content();
  log(`auth nav → HTTP ${r.status()}${challenged(r.status(), html) ? "  ✗ CHALLENGED" : "  ok"}`);
  if (challenged(r.status(), html)) { verdict = "CHALLENGED-ON-AUTH-NAV"; throw new Error("stop"); }

  // 4 — fill and CLICK, so the POST is a real form submission, not an XHR
  const emailSel = 'input[name="DownloadLoginForm[email]"]';
  if (!(await page.$(emailSel))) { verdict = "NO-EMAIL-FIELD (form changed?)"; throw new Error("stop"); }
  await page.fill(emailSel, EMAIL);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => null),
    page.click('input[type=submit],button[type=submit]'),
  ]);
  html = await page.content();
  const path = new URL(page.url()).pathname;
  log(`submit → ${path}${challenged(200, html) ? "  ✗ CHALLENGED" : ""}`);

  if (challenged(200, html)) verdict = "CHALLENGED-ON-SUBMIT";
  else if (path.includes("/download/sets/")) verdict = "PASS — reached the set picker";
  else if (path.includes("/download/exist/")) verdict = "PASS — reached the exist interstitial";
  else if (path.includes("/download/auth/")) verdict = "GATE-REJECTED (still on auth, not challenged)";
  else verdict = `UNEXPECTED path ${path}`;
} catch (e) {
  if (e.message !== "stop") verdict = `ERROR ${e.message.slice(0, 120)}`;
} finally {
  await ctx.close();
}
log(`VERDICT: ${verdict}`);
log("nothing was generated and nothing downloaded.");
process.exit(verdict.startsWith("PASS") ? 0 : 3);
