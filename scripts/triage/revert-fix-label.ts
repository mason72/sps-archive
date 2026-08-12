/**
 * Revert People-view "fix-label" overrides that were made against corrupted
 * bytes. Confirming "this is William Pashby" on a file named Zaid Haq was the
 * right call on the evidence — the picture WAS William Pashby — but the picture
 * was the corruption and the name was correct. Post-repair those overrides
 * point the wrong way.
 *
 * Restores parsed_name to what the filename parses to.
 *
 * Usage: npx tsx scripts/triage/revert-fix-label.ts <eventId> [--apply]
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
(async () => {
  const eventId = process.argv[2] ?? "4ac80a42-88ee-4042-ab56-1d7962e72032";
  const apply = process.argv.includes("--apply");
  const { createClient } = await import("@supabase/supabase-js");
  const { parseFilename } = await import("../../src/lib/upload/parse-filename");
  const { personNameFromParts } = await import("../../src/lib/gallery/stacks");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await s.from("images")
      .select("id, original_filename, parsed_name")
      .eq("event_id", eventId).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  // A healthy row stores parseFilename()'s output verbatim ("Brandon Huff
  // Island") and DISPLAYS the bare name, because personNameFromParts treats a
  // filename-derived strict prefix as the winner. An override stores a bare
  // person name that is not a prefix, so it wins outright. Build the roster of
  // people actually photographed through that same function rather than
  // re-deriving names by hand — the one identity home (CLAUDE.md / docs/OPS).
  const intendedOf = (f: string) =>
    personNameFromParts(parseFilename(f).name, f);
  const roster = new Set(rows.map(r => intendedOf(r.original_filename)).filter(Boolean));

  const drift = rows
    .map(r => ({
      ...r,
      fromFile: parseFilename(r.original_filename).name,
      intended: intendedOf(r.original_filename),
    }))
    .filter(r => (r.parsed_name ?? null) !== (r.fromFile ?? null));

  // A shift artifact names ANOTHER person who was genuinely at this shoot —
  // that is what confirming a suggestion against corrupted bytes produces.
  // Anything else could be a real hand correction, so it is reported, not
  // touched.
  // When parseFilename yields no name there is nothing to restore TO — but
  // parsed_name = null makes personNameFromParts fall back to
  // extractPersonName(), which reads the right person straight off the file.
  // So null is the correct revert value there, not a reason to skip the row.
  const artifacts = drift.filter(
    r => r.parsed_name && roster.has(r.parsed_name) && r.parsed_name !== r.intended
  );
  const artifactIds = new Set(artifacts.map(r => r.id));
  const suspicious = drift.filter(r => !artifactIds.has(r.id));

  console.log(`${apply ? "APPLY" : "DRY RUN"} — ${rows.length} rows`);
  console.log(`overrides found:      ${drift.length}`);
  console.log(`shift artifacts:      ${artifacts.length}  <- reverting`);
  console.log(`left alone (unclear): ${suspicious.length}\n`);
  for (const r of artifacts) {
    console.log(`  "${r.parsed_name}"  ->  "${r.fromFile}"   (${r.original_filename})`);
  }
  if (suspicious.length) {
    console.log(`\nNOT reverted — check these by hand:`);
    for (const r of suspicious) {
      console.log(`  ${r.original_filename}: parsed_name="${r.parsed_name}" filename->"${r.fromFile}"`);
    }
  }
  if (!apply) { console.log(`\nDry run. Re-run with --apply.`); return; }

  for (const r of artifacts) {
    const { error } = await s.from("images").update({ parsed_name: r.fromFile ?? null }).eq("id", r.id);
    if (error) throw error;
  }
  console.log(`\nReverted ${artifacts.length} names.`);
})().catch(e => { console.error(e); process.exit(1); });
