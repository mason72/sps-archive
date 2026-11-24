/**
 * Signed-in phone probe (lesson 185 recipe, saved 2026-11-24): headless
 * Chromium at 390x844 with touch (`pointer: coarse` matches), signed in as
 * one account, screenshots of each path plus a sideways-overflow check.
 *
 *   PHONE_PROBE_EMAIL=<owner email> node scripts/triage/phone-probe.mjs \
 *     http://localhost:3006 <outDir> /fill/<jobId> /events/<eventId>
 *
 * READ-ONLY: it loads pages and screenshots them; it never clicks. Add taps in
 * a copy for a specific check, and never tap anything that writes: a local
 * server talks to the PRODUCTION database.
 *
 * Why it exists: Claude in Chrome's resize_window reports success and leaves
 * the window wide, desktop Chrome will not go under ~500px, the app refuses to
 * be framed (X-Frame-Options: DENY), and the built-in Browser pane is signed
 * out. The session is minted in-process (admin.generateLink + verifyOtp) and
 * the cookie is written by @supabase/ssr itself, so no token is printed or
 * typed. Run it against `next start` after `npm run build`, never beside a
 * `next dev` in the same tree (they share .next).
 *
 * Needs playwright-core somewhere: set PLAYWRIGHT_CORE to its folder (an npx
 * cache copy works) and CHROMIUM to a Chromium or chrome-headless-shell binary
 * (~/Library/Caches/ms-playwright/...).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const [base, outDir, ...paths] = process.argv.slice(2);
const email = process.env.PHONE_PROBE_EMAIL;
if (!base || !outDir || paths.length === 0 || !email) {
  console.error("usage: PHONE_PROBE_EMAIL=… node scripts/triage/phone-probe.mjs <baseUrl> <outDir> <path>…");
  process.exit(2);
}
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const require = createRequire(path.join(repo, "package.json"));
const { createClient } = require("@supabase/supabase-js");
const { createServerClient } = require("@supabase/ssr");
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

for (const line of fs.readFileSync(path.join(repo, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
if (link.error) throw new Error(`generateLink: ${link.error.message}`);
const jar = [];
const ssr = createServerClient(url, anon, {
  cookies: {
    getAll: () => jar.map(({ name, value }) => ({ name, value })),
    setAll: (c) => jar.splice(0, jar.length, ...c),
  },
});
const verified = await ssr.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
if (verified.error) throw new Error(`verifyOtp: ${verified.error.message}`);

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
try {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  await ctx.addCookies(jar.map((c) => ({ name: c.name, value: c.value, url: base })));
  const page = await ctx.newPage();
  for (const [i, p] of paths.entries()) {
    await page.goto(new URL(p, base).toString());
    await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
    const m = await page.evaluate(() => ({
      url: location.pathname,
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      coarse: matchMedia("(pointer: coarse)").matches,
    }));
    const file = path.join(outDir, `phone-${i + 1}.png`);
    await page.screenshot({ path: file });
    const flag = m.scrollWidth > m.width ? "  OVERFLOWS SIDEWAYS" : "";
    console.log(`${m.url}  ${m.width}px wide, scrollWidth ${m.scrollWidth}, coarse=${m.coarse}  -> ${file}${flag}`);
  }
} finally {
  await browser.close();
}
