/**
 * Merge fields into one TDP Work job's job_meta, through the SAME validator
 * and proof counter as the job form. For loading drafted case-study stories
 * (Claude or Scout) and linking source galleries without clicking through
 * the form; Mason then approves the draft in the form with one tap.
 *
 *   npx tsx scripts/site/job-story.ts --slug atlassian-team-26 --file patch.json          # dry run
 *   npx tsx scripts/site/job-story.ts --slug atlassian-team-26 --file patch.json --write
 *   npx tsx scripts/site/job-story.ts --slug electronica-2026 --create "Electronica 2026" --file patch.json --write
 *
 * --create makes a NEW job section (appended last) when the slug does not
 * exist yet. A job with no published photos stays off the site, so a created
 * job is a draft until photos are added to it in the TDP Work gallery.
 *
 * patch.json is a PARTIAL job_meta ({ "special": true, "story": {...},
 * "sources": [...] , "year": 2024 }). It is merged over the stored document
 * (a job save replaces the whole document, so a bare patch would erase the
 * rest). `proof` in a patch is ignored: it is always counted here.
 *
 * Safety: dry run unless --write; scoped to the tdp-work gallery and its
 * owner (sources must belong to that owner); refuses to PUBLISH a story
 * unless --publish is passed, because publishing is Mason's call; prints the
 * previous document so a write can be undone by hand.
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

async function main() {
  const WRITE = process.argv.includes("--write");
  const PUBLISH = process.argv.includes("--publish");
  const slug = arg("slug");
  const createName = arg("create");
  const file = arg("file");
  if (!slug || !file) throw new Error("usage: --slug <job-slug> --file <patch.json> [--write] [--publish]");

  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { WORK_EVENT_SLUG, JOB_KEY_PREFIX, isValidJobSlug, parseJobMeta, validateJobMeta, guardPublishedStory, serializeJob, isJobComplete } =
    await import("../../src/lib/site/jobs");
  const { computeJobProof } = await import("../../src/lib/site/job-proof");
  const supabase = createServiceClient();

  const patch = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  delete patch.proof;

  const { data: work, error: workErr } = await supabase
    .from("events")
    .select("id, user_id")
    .eq("slug", WORK_EVENT_SLUG)
    .single();
  if (workErr || !work) throw new Error(`TDP Work gallery not found: ${workErr?.message ?? "no row"}`);

  if (!isValidJobSlug(slug)) throw new Error(`Bad slug: ${slug}`);
  const { data: found, error: secErr } = await supabase
    .from("sections")
    .select("id, name, job_meta")
    .eq("event_id", work.id)
    .eq("site_scene_key", `${JOB_KEY_PREFIX}${slug}`)
    .maybeSingle();
  if (secErr) throw new Error(`Job lookup failed: ${secErr.message}`);
  if (!found && !createName) throw new Error(`Job "${slug}" not found in TDP Work (pass --create "<name>" to make it)`);
  if (found && createName) throw new Error(`Job "${slug}" already exists; drop --create`);
  const section = found ?? { id: null, name: createName as string, job_meta: null };

  const before = parseJobMeta(section.job_meta);
  const merged = { ...before, ...patch };
  const validated = validateJobMeta(merged);
  if ("error" in validated) throw new Error(`Invalid job_meta: ${validated.error}`);
  const guarded = guardPublishedStory(validated.meta, before);
  if ("error" in guarded) throw new Error(guarded.error);
  if (guarded.notice) console.log(`notice: ${guarded.notice}`);
  const meta = guarded.meta;
  if (meta.story?.status === "published" && before.story?.status !== "published" && !PUBLISH) {
    throw new Error("This would PUBLISH a story. Publishing is Mason's call: load it as a draft, or pass --publish.");
  }
  meta.proof = await computeJobProof(supabase, work.user_id as string, meta.sources);

  console.log(`job: ${section.name} (${slug})${section.id ? "" : "  [NEW: will be created]"}`);
  console.log(`  complete: ${isJobComplete(meta)}  special: ${before.special} -> ${meta.special}`);
  console.log(
    `  story: ${before.story ? `${before.story.status} "${before.story.headline}"` : "none"} -> ${
      meta.story ? `${meta.story.status} (${meta.story.source}) "${meta.story.headline}"` : "none"
    }`
  );
  console.log(`  sources: ${before.sources.length} -> ${meta.sources.length}`);
  const p = meta.proof;
  console.log(
    `  proof: ${p ? `${p.photos} photos, ${p.galleries} galleries, ${p.people ?? "no"} people, ${p.days?.length ?? 0} days [${(p.days ?? []).map((d) => d.length + "h").join(", ")}]` : "none"}`
  );
  console.log(`  site would get story: ${serializeJob(slug, meta).story ? "yes" : "no (draft, none, or names an anonymized client)"}`);

  if (!WRITE) {
    console.log("\nDry run. Re-run with --write to save.");
    return;
  }
  if (!section.id) {
    const { data: last, error: lastErr } = await supabase
      .from("sections")
      .select("sort_order")
      .eq("event_id", work.id)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastErr) throw new Error(`Sort order lookup failed: ${lastErr.message}`);
    const { data: made, error: insErr } = await supabase
      .from("sections")
      .insert({
        event_id: work.id,
        name: section.name,
        site_scene_key: `${JOB_KEY_PREFIX}${slug}`,
        is_auto: false,
        sort_order: (last?.sort_order ?? -1) + 1,
        job_meta: meta as never,
      })
      .select("id")
      .single();
    if (insErr || !made) throw new Error(`Create failed: ${insErr?.message ?? "no row"}`);
    console.log(`\nCreated section ${made.id}. Add photos to it in the TDP Work gallery to put it live.`);
    return;
  }
  console.log(`\nprevious job_meta (to undo by hand):\n${JSON.stringify(section.job_meta)}`);
  const { error: upErr } = await supabase.from("sections").update({ job_meta: meta as never }).eq("id", section.id);
  if (upErr) throw new Error(`Write failed: ${upErr.message}`);
  console.log("\nSaved. The site's job cache refreshes within 5 minutes.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
