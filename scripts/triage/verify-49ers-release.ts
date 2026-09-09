/**
 * Is every photo in the 49ers archive actually in its Pixeltrunk event?
 *
 * A tally is not a presence check (lesson: "a count-based guard is not a
 * presence guard"). release-sweep.ts only scans verified/; this archive sits in
 * ingested/, so nothing had ever compared it per-file. Compare the ZIPs' entry
 * names against images.original_filename — filename is the STORAGE KEY (a
 * UUID), and comparing against it reads as total data loss.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const EVENT = "cf8937b1-adee-4bd2-ba17-d675db0830be";
const dir = join(homedir(), "pixieset-staging", "ingested");

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const inZip = new Set<string>();
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".zip"))) {
    const out = execFileSync("/usr/bin/unzip", ["-Z1", join(dir, f)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    for (const line of out.split("\n")) {
      const name = line.trim();
      if (name && !name.endsWith("/")) inZip.add(name.split("/").pop()!);
    }
  }
  console.log("distinct files in archive:", inZip.size);

  // Paged, ordered on a unique column — an unpaged select silently caps at 1000.
  const have = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("images")
      .select("id, original_filename").eq("event_id", EVENT)
      .order("id", { ascending: true }).range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data) if (r.original_filename) have.add(r.original_filename);
    if (data.length < 1000) break;
  }
  console.log("distinct original_filename in event:", have.size);

  const missing = [...inZip].filter((n) => !have.has(n));
  console.log("in archive but NOT in the event:", missing.length);
  if (missing.length) console.log("  e.g.", missing.slice(0, 5).join(", "));
  console.log(missing.length === 0 ? "\nSAFE TO RELEASE" : "\nDO NOT RELEASE — the archive holds files the event does not");
}
main();
