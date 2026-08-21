/**
 * Delete intel_notes rows by id (row first, then both R2 objects) through the
 * same store function the API uses. For cleaning up test entries.
 *
 *   npx tsx scripts/triage/delete-intel-notes.ts <userId> <noteId> [noteId…]
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

async function main() {
  const [userId, ...ids] = process.argv.slice(2);
  if (!userId || !ids.length) { console.error("usage: <userId> <noteId…>"); process.exit(1); }
  // Plain service client — server.ts pulls next/headers, which has no meaning here.
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { deleteNote } = await import("../../src/lib/intel-notes/store");
  for (const id of ids) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    console.log(id, (await deleteNote(db as any, userId, id)) ? "deleted" : "not found");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
