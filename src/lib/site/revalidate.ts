/**
 * TDP website cache revalidation.
 *
 * The marketing site caches scene fetches under one tag; pinging its
 * revalidate webhook purges that tag so edits in the TDP Website gallery
 * appear within seconds (the site minute-buckets PT fetches, so worst-case
 * staleness after a ping is ≤60s).
 *
 * Call scheduleSiteRevalidate() after any mutation that changes what the
 * site renders. It is:
 *  - scoped by the CALLER — only website-gallery mutations may call it
 *    (publication sync, website-section reorder, published-image metadata)
 *  - fire-and-forget — never blocks or fails the user's action; failures
 *    log a warning
 *  - debounced — a trailing 4s window per process collapses a curation
 *    burst into one ping (later calls supersede earlier ones)
 *  - inert when TDP_SITE_REVALIDATE_URL is unset (dev environments)
 *
 * Inside a request scope the wait runs through next/server's after() so the
 * serverless function stays alive to deliver the ping; outside one (scripts,
 * tests) it falls back to a detached promise.
 */

import { after } from "next/server";

const DEBOUNCE_MS = 4000;

/** Monotonic token — a ping only fires if no newer call superseded it. */
let latest = 0;

export function scheduleSiteRevalidate(): void {
  const url = process.env.TDP_SITE_REVALIDATE_URL;
  if (!url) return;

  const token = ++latest;
  const work = async () => {
    await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS));
    if (token !== latest) return; // superseded by a later edit
    try {
      const key = process.env.TDP_SITE_REVALIDATE_SECRET ?? "";
      // The website sits behind Vercel bot protection, which challenges
      // server-to-server traffic. "Protection Bypass for Automation" on the
      // tdp-website project exempts requests carrying this header.
      const bypass = process.env.TDP_SITE_REVALIDATE_BYPASS;
      const res = await fetch(`${url}?key=${encodeURIComponent(key)}`, {
        headers: bypass ? { "x-vercel-protection-bypass": bypass } : undefined,
      });
      if (!res.ok) {
        console.warn(`[site-revalidate] ping failed: HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn("[site-revalidate] ping failed:", err);
    }
  };

  try {
    // Keeps the serverless function alive past the response until the
    // debounced ping settles. Throws when called outside a request scope.
    after(work);
  } catch {
    void work();
  }
}
