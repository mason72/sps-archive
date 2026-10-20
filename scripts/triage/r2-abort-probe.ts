/**
 * Probe (2026-10-20): do the per-call abortSignal limits in src/lib/r2/client.ts
 * actually fire against real R2? Read-only (HEAD + one listing page).
 *
 *   npx tsx scripts/triage/r2-abort-probe.ts <existing-r2-key>
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

async function main() {
  const key = process.argv[2];
  if (!key) throw new Error("usage: r2-abort-probe.ts <existing-r2-key>");
  const { getObjectSize, listObjectsPage } = await import("../../src/lib/r2/client");

  const control = await getObjectSize(key);
  console.log("15 s limit (control):", control === null ? "404" : `${control} bytes`);

  let t = Date.now();
  try {
    const n = await getObjectSize(key, 1);
    console.log(`1 ms limit: ANSWERED ${n} (the limit did not fire)`);
  } catch (e) {
    console.log(`1 ms limit: threw ${(e as Error).name} after ${Date.now() - t} ms`);
  }

  t = Date.now();
  const page = await listObjectsPage("events/", undefined);
  console.log(`listing with 60 s limit: ${page.objects.length} keys in ${Date.now() - t} ms`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
