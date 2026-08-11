#!/usr/bin/env node
/**
 * One-time interactive login. Opens a real browser window; you sign in to
 * Pixieset yourself. The session is stored in ./profile and every later script
 * reuses it headlessly — no password or cookie is ever handled by the tooling.
 *
 *   node scripts/pixieset/login.mjs
 *
 * Re-run whenever the session expires (the pilot will tell you if it has).
 */
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROFILE = join(HERE, "profile");

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1280, height: 900 },
});
const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto("https://galleries.pixieset.com/collections", { waitUntil: "domcontentloaded" });

console.log("\nSign in to Pixieset in the window that just opened.");
console.log("Waiting for an authenticated session…\n");

const deadline = Date.now() + 10 * 60_000;
let ok = false;
while (Date.now() < deadline) {
  try {
    const r = await ctx.request.get("https://galleries.pixieset.com/api/v1/user", {
      headers: { Accept: "application/json" },
    });
    if (r.ok()) {
      const j = await r.json();
      const name = j?.data?.username;
      if (name) {
        console.log(`✓ signed in as "${name}" — session saved to scripts/pixieset/profile`);
        ok = true;
        break;
      }
    }
  } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 2000));
}

if (!ok) console.log("✗ timed out after 10 minutes without an authenticated session.");
await ctx.close();
process.exit(ok ? 0 : 1);
