/**
 * Identity aliases for /people — "these two filename spellings are one human."
 *
 * Filename identity ("samihadouaj") cannot know that "Sami Hadouaj Mundra" is
 * the same person; only a human can say so, and `person_aliases` (migration
 * 064) records the judgement. This module is the ONE place keys fold:
 * `buildPeopleIndex`, `buildPersonDetail` and the event `?person=` deep link
 * all resolve through the same loaded resolver, because two of them folding
 * and one not is exactly the tile/card disagreement of lesson 88.
 *
 * Human-initiated only. Two different John Smiths are already one tile under
 * filename identity — no automatic signal can safely merge or split a name,
 * so nothing writes aliases but the confirm UI.
 */
import type { createServiceClient } from "@/lib/supabase/server";

type SupabaseDB = ReturnType<typeof createServiceClient>;

export interface AliasRow {
  alias_key: string;
  canonical_key: string;
  alias_name: string;
  canonical_name: string;
}

export interface AliasResolver {
  /** Canonical key for any key (itself when un-aliased). */
  resolve(key: string): string;
  /** Every key in the identity group, canonical first. */
  groupKeys(key: string): string[];
  /** Display spellings recorded for the group — for labels and ilike tokens. */
  groupNames(key: string): string[];
  /** True if any alias rows exist at all (lets hot paths skip work). */
  isEmpty: boolean;
}

/**
 * Pure construction from rows — separately testable. Chains (A→B, B→C) are
 * flattened at write time by the API, but the resolver follows them anyway
 * with a cycle guard: a defensive resolver costs nothing, and a data bug must
 * degrade to "unmerged", never to an infinite loop.
 */
export function buildAliasResolver(rows: AliasRow[]): AliasResolver {
  const parent = new Map<string, string>();
  const namesByKey = new Map<string, Set<string>>();
  const note = (key: string, name: string) => {
    const set = namesByKey.get(key) ?? new Set<string>();
    set.add(name);
    namesByKey.set(key, set);
  };
  for (const r of rows) {
    parent.set(r.alias_key, r.canonical_key);
    note(r.alias_key, r.alias_name);
    note(r.canonical_key, r.canonical_name);
  }

  const resolve = (key: string): string => {
    let cur = key;
    const seen = new Set<string>([cur]);
    while (parent.has(cur)) {
      const next = parent.get(cur)!;
      if (seen.has(next)) return key; // cycle — degrade to unmerged
      seen.add(next);
      cur = next;
    }
    return cur;
  };

  // canonical → members (aliases only; canonical added in groupKeys).
  const members = new Map<string, Set<string>>();
  for (const aliasKey of parent.keys()) {
    const canonical = resolve(aliasKey);
    const set = members.get(canonical) ?? new Set<string>();
    set.add(aliasKey);
    members.set(canonical, set);
  }

  return {
    resolve,
    groupKeys(key: string): string[] {
      const canonical = resolve(key);
      return [canonical, ...(members.get(canonical) ?? [])];
    },
    groupNames(key: string): string[] {
      const names = new Set<string>();
      for (const k of this.groupKeys(key)) {
        for (const n of namesByKey.get(k) ?? []) names.add(n);
      }
      return [...names];
    },
    isEmpty: rows.length === 0,
  };
}

/**
 * One photographer's aliases. Fails LOUD — a swallowed error here would
 * silently split every merged identity back into its old tiles, which reads
 * as data loss to the person who merged them.
 */
export async function loadAliasResolver(
  supabase: SupabaseDB,
  userId: string
): Promise<AliasResolver> {
  const rows: AliasRow[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from("person_aliases")
      .select("alias_key, canonical_key, alias_name, canonical_name")
      .eq("user_id", userId)
      // Paged reads ORDER BY, always (lesson 88).
      .order("alias_key")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return buildAliasResolver(rows);
}
