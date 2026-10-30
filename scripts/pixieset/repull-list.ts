/**
 * Which collections the same-name re-pull still owns (lesson 197).
 *
 * One home for the question both the runner and the release sweep ask. The list
 * itself lives in the extension (`SAME_NAME_REPULL` in background.js, which
 * re-requests them); `repull-runner.ts` copies it into a ledger once and records
 * progress there. Until a collection is `done`, its staged archive may be the only
 * copy of its missing versions, so nothing may release it.
 */
import fs from "node:fs";
import path from "node:path";

export const REPULL_LEDGER = path.join("scripts", "pixieset", "data", "repull-ledger.json");
const BACKGROUND = path.join("scripts", "pixieset", "extension", "background.js");

export type RepullRow = {
  slug: string;
  state: "pending" | "done" | "held";
  attempts: number;
  at?: string;
  note?: string;
  shape?: string;
  /** The held email's text, kept so a failed send can be retried word for word. */
  mail?: string;
  /** A held row whose email has not gone out yet; retried every run. */
  unmailed?: boolean;
};
export type RepullLedger = { createdAt: string; source: string; nagAt?: string; finishedMailAt?: string; rows: RepullRow[] };

export function repullSlugs(): string[] {
  const block = fs.readFileSync(BACKGROUND, "utf8").match(/const SAME_NAME_REPULL = \[([\s\S]*?)\];/);
  if (!block) throw new Error("SAME_NAME_REPULL not found in background.js; refusing to guess the list");
  const slugs = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (slugs.length !== 42) throw new Error(`expected 42 re-pull slugs, read ${slugs.length}; refusing to guess the list`);
  return slugs;
}

export function readRepullLedger(): RepullLedger | null {
  return fs.existsSync(REPULL_LEDGER) ? (JSON.parse(fs.readFileSync(REPULL_LEDGER, "utf8")) as RepullLedger) : null;
}

/**
 * Slugs whose archives must not be released. With no ledger yet, that is the
 * whole list: failing open here is how a re-download gets deleted before import.
 */
export function openRepullSlugs(): Set<string> {
  const ledger = readRepullLedger();
  return new Set(ledger ? ledger.rows.filter((r) => r.state !== "done").map((r) => r.slug) : repullSlugs());
}

/**
 * The extension's retirement beacons for exactly this slug, written after `since`.
 * "chime" must not match "chimefeb2026", and a beacon from an earlier pass of the
 * migration says nothing about this one.
 */
export function retiredSince(retiredDir: string, slug: string, sinceMs: number): { reason: string; detail: string }[] {
  if (!fs.existsSync(retiredDir)) return [];
  return fs
    .readdirSync(retiredDir)
    .filter((f) => f === `px-retired-${slug}.json` || f.startsWith(`px-retired-${slug} (`))
    .map((f) => path.join(retiredDir, f))
    .filter((p) => fs.statSync(p).mtimeMs > sinceMs)
    .map((p) => {
      try {
        const b = JSON.parse(fs.readFileSync(p, "utf8")) as { reason?: string; detail?: string };
        return { reason: b.reason ?? "unknown", detail: b.detail ?? "" };
      } catch {
        return { reason: "unreadable beacon", detail: path.basename(p) };
      }
    });
}
