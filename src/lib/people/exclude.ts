/**
 * "Not a person" — the one home for what it means, used by the wall's tiles
 * and the suggestion tray alike.
 *
 * Until 2026-09-11 it only wrote `excluded_people`, which the wall reads. The
 * naming engine never did. "WekaSKO27_EventPhotos-03055.jpg" had put "Weka
 * SKO27" on all 57 face clusters of a 200-photo gallery; those 57 became
 * reference faces; the tray then offered the name 53 times across five
 * events. The wall's button could not help (the wall already hid the label),
 * and "Not them" rejects one cluster at a time.
 *
 * So an exclusion now reaches every place the name lives:
 *   1. `excluded_people` — read by the wall, the filename namer, the
 *      reference refresh and the scan.
 *   2. clusters carrying the name lose it (name → null). They become
 *      anonymous, so the engine can match them to whoever they really are.
 *   3. its reference faces are dropped, so the matcher stops offering it.
 *   4. pending suggestions offering it are deleted; a re-scan may find the
 *      right name instead.
 *
 * A MERGED identity is excluded whole. The wall keys on the canonical of an
 * alias group, so excluding one spelling would leave the tile standing and the
 * other spellings' clusters still acting as reference faces.
 *
 * Reversible: step 1 records exactly which clusters step 2 touched, and
 * `restoreNonPerson` puts those labels back — never over a name a human has
 * typed since. References return through the same scoped refresh the engine
 * uses; suggestions return at the event's next scan.
 */
import type { createServiceClient } from "@/lib/supabase/server";

import { loadAliasResolver } from "./aliases";
import { NON_PERSON_GALLERIES, normalizeNameKey } from "./index-people";

type SupabaseDB = ReturnType<typeof createServiceClient>;

export interface ClearedCluster {
  id: string;
  name: string;
}

export interface ExclusionResult {
  /** The canonical key the exclusion is stored under — what an undo passes back. */
  key: string;
  name: string;
  clearedClusters: number;
  clearedSuggestions: number;
  droppedReferences: number;
  /** Events whose identity scan should re-run now that the name is gone. */
  eventIds: string[];
}

export interface RestoreResult {
  key: string;
  restoredClusters: number;
  eventIds: string[];
}

/**
 * A pattern that matches every spelling a letters-only key can come from
 * ("wekasko" ← "Weka SKO27", "WEKA sko-27"), so PostgREST narrows the rows.
 * It over-matches on purpose; the exact key comparison happens in code, with
 * the same normaliser the index uses.
 */
function spellingPattern(key: string): string {
  return `%${key.split("").join("%")}%`;
}

async function clustersNamed(
  supabase: SupabaseDB,
  userId: string,
  key: string
): Promise<{ id: string; name: string; eventId: string }[]> {
  const out: { id: string; name: string; eventId: string }[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from("persons")
      .select("id, name, event_id, events!inner(user_id)")
      .eq("events.user_id", userId)
      .ilike("name", spellingPattern(key))
      .order("id")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    for (const p of data ?? []) {
      if (p.name && normalizeNameKey(p.name) === key) {
        out.push({ id: p.id, name: p.name, eventId: p.event_id });
      }
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function excludeNonPerson(
  supabase: SupabaseDB,
  userId: string,
  rawName: string,
  reason?: string | null
): Promise<ExclusionResult> {
  const name = rawName.trim();
  const rawKey = normalizeNameKey(name);
  if (!rawKey) throw new Error("name normalises to nothing");

  const aliases = await loadAliasResolver(supabase, userId);
  const key = aliases.resolve(rawKey);
  const groupKeys = aliases.groupKeys(key);

  const clusters = (
    await Promise.all(groupKeys.map((k) => clustersNamed(supabase, userId, k)))
  ).flat();

  // Record the exclusion AND what it is about to clear BEFORE clearing
  // anything: a failure part-way leaves a complete undo record, and running
  // it again finishes the job (every step below is idempotent).
  const { data: existing, error: readErr } = await supabase
    .from("excluded_people")
    .select("cleared_persons")
    .eq("user_id", userId)
    .eq("person_key", key)
    .maybeSingle();
  if (readErr) throw readErr;
  const cleared = new Map<string, string>();
  for (const c of (existing?.cleared_persons ?? []) as unknown as ClearedCluster[]) {
    cleared.set(c.id, c.name);
  }
  for (const c of clusters) cleared.set(c.id, c.name);
  const { error: upsertErr } = await supabase.from("excluded_people").upsert(
    {
      user_id: userId,
      person_key: key,
      name,
      reason: reason?.slice(0, 500) || null,
      cleared_persons: [...cleared].map(([id, n]) => ({ id, name: n })),
    },
    { onConflict: "user_id,person_key" }
  );
  if (upsertErr) throw upsertErr;

  for (let i = 0; i < clusters.length; i += 200) {
    const { error } = await supabase
      .from("persons")
      .update({ name: null })
      .in("id", clusters.slice(i, i + 200).map((c) => c.id));
    if (error) throw error;
  }

  const { count: droppedReferences, error: refErr } = await supabase
    .from("person_reference_centroids")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .in("name_key", groupKeys);
  if (refErr) throw refErr;

  // Events first (for the re-scan), then the delete by the same filter — one
  // statement, so the delete cannot miss rows past a page boundary.
  const { data: pendingEvents, error: peErr } = await supabase
    .from("person_identity_suggestions")
    .select("event_id")
    .eq("user_id", userId)
    .eq("status", "pending")
    .in("suggested_key", groupKeys)
    .order("id")
    .limit(1000);
  if (peErr) throw peErr;
  const { count: clearedSuggestions, error: delErr } = await supabase
    .from("person_identity_suggestions")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .eq("status", "pending")
    .in("suggested_key", groupKeys);
  if (delErr) throw delErr;

  const eventIds = [
    ...new Set([
      ...clusters.map((c) => c.eventId),
      ...(pendingEvents ?? []).map((r) => r.event_id),
    ]),
  ].filter((id): id is string => !!id);

  return {
    key,
    name,
    clearedClusters: clusters.length,
    clearedSuggestions: clearedSuggestions ?? 0,
    droppedReferences: droppedReferences ?? 0,
    eventIds,
  };
}

export async function restoreNonPerson(
  supabase: SupabaseDB,
  userId: string,
  rawKey: string
): Promise<RestoreResult> {
  // The wall's undo passes a NAME, which may be an alias spelling; exclusions
  // made before 2026-09-11 were stored under the raw key. Look under both.
  const aliases = await loadAliasResolver(supabase, userId);
  const key = aliases.resolve(rawKey);
  const keys = [...new Set([key, rawKey])];

  const { data: rows, error: readErr } = await supabase
    .from("excluded_people")
    .select("cleared_persons")
    .eq("user_id", userId)
    .in("person_key", keys);
  if (readErr) throw readErr;
  const cleared = (rows ?? []).flatMap(
    (r) => (r.cleared_persons ?? []) as unknown as ClearedCluster[]
  );

  // Labels FIRST, the record second. If this fails part-way, the record that
  // says what to restore still exists and running undo again finishes the job:
  // restoring is idempotent, because it only fills a cluster that is STILL
  // unnamed — a name a human typed after the exclusion is newer evidence and
  // wins.
  const idsByName = new Map<string, string[]>();
  for (const c of cleared) {
    const list = idsByName.get(c.name) ?? [];
    list.push(c.id);
    idsByName.set(c.name, list);
  }
  let restoredClusters = 0;
  const events = new Set<string>();
  for (const [name, ids] of idsByName) {
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabase
        .from("persons")
        .update({ name })
        .in("id", ids.slice(i, i + 200))
        .is("name", null)
        .select("id, event_id");
      if (error) throw error;
      for (const p of data ?? []) {
        restoredClusters += 1;
        if (p.event_id) events.add(p.event_id);
      }
    }
  }

  const { error: delErr } = await supabase
    .from("excluded_people")
    .delete()
    .eq("user_id", userId)
    .in("person_key", keys);
  if (delErr) throw delErr;

  // References LAST: the refresh skips excluded keys, so it has to run after
  // the record is gone. Same event-scoped refresh the engine runs after every
  // scan and confirm.
  for (const eventId of events) {
    const { error } = await supabase.rpc("refresh_person_reference_centroids", {
      p_user_id: userId,
      p_event_id: eventId,
      p_excluded_event_names: [...NON_PERSON_GALLERIES],
    });
    if (error) throw error;
  }

  return { key, restoredClusters, eventIds: [...events] };
}
