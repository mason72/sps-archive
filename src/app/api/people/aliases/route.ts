import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { normalizeNameKey } from "@/lib/people/index-people";
import { reportSystemError } from "@/lib/monitoring/report";

export const runtime = "nodejs";

/**
 * Identity merges for /people — "these two filename spellings are one human."
 *
 * POST   { aliasName, canonicalName }  — record a merge (human-confirmed only)
 * DELETE ?aliasName=…                  — undo one
 *
 * Chains flatten at write: merging B into C rewrites any row whose canonical
 * was B, so the stored graph stays one hop deep and an undo detaches exactly
 * one spelling. Cycles are refused outright.
 */
export async function POST(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const body = (await request.json()) as { aliasName?: string; canonicalName?: string };
    const aliasName = (body.aliasName ?? "").trim();
    const canonicalName = (body.canonicalName ?? "").trim();
    const aliasKey = normalizeNameKey(aliasName);
    let canonicalKey = normalizeNameKey(canonicalName);
    if (!aliasKey || !canonicalKey) {
      return NextResponse.json({ error: "Both names are required" }, { status: 400 });
    }
    if (aliasKey === canonicalKey) {
      return NextResponse.json(
        { error: "Those are already the same identity" },
        { status: 400 }
      );
    }

    // If the chosen canonical is itself an alias, follow it — merging into a
    // spelling that was already folded must land on ITS canonical, or the
    // write would create a chain (or, worse, a cycle).
    const { data: canonicalRow } = await supabase
      .from("person_aliases")
      .select("canonical_key, canonical_name")
      .eq("user_id", user!.id)
      .eq("alias_key", canonicalKey)
      .maybeSingle();
    let effectiveCanonicalName = canonicalName;
    if (canonicalRow) {
      canonicalKey = canonicalRow.canonical_key;
      effectiveCanonicalName = canonicalRow.canonical_name;
      if (canonicalKey === aliasKey) {
        return NextResponse.json(
          { error: "That would merge an identity into itself" },
          { status: 400 }
        );
      }
    }

    const { error: insertError } = await supabase.from("person_aliases").upsert(
      {
        user_id: user!.id,
        alias_key: aliasKey,
        canonical_key: canonicalKey,
        alias_name: aliasName,
        canonical_name: effectiveCanonicalName,
      },
      { onConflict: "user_id,alias_key" }
    );
    if (insertError) throw insertError;

    // Flatten: anything that pointed AT the alias now points at the terminal
    // canonical (A→B existing, new B→C ⇒ A→C).
    const { error: flattenError } = await supabase
      .from("person_aliases")
      .update({ canonical_key: canonicalKey, canonical_name: effectiveCanonicalName })
      .eq("user_id", user!.id)
      .eq("canonical_key", aliasKey);
    if (flattenError) throw flattenError;

    return NextResponse.json({ aliasKey, canonicalKey });
  } catch (error) {
    await reportSystemError("people.aliases.create", error);
    return NextResponse.json({ error: "Failed to merge" }, { status: 500 });
  }
}

/**
 * GET ?name=… — the identity group for one name: every key that folds into
 * its canonical. The event page's `?person=` deep link asks this so a chip
 * from a MERGED card matches photos filed under any of its spellings; the
 * un-merged common case returns just the name's own key.
 */
export async function GET(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const name = request.nextUrl.searchParams.get("name") ?? "";
    const key = normalizeNameKey(name);
    if (!key) return NextResponse.json({ error: "name is required" }, { status: 400 });

    const { loadAliasResolver } = await import("@/lib/people/aliases");
    const resolver = await loadAliasResolver(supabase, user!.id);
    return NextResponse.json({ keys: resolver.groupKeys(key) });
  } catch (error) {
    await reportSystemError("people.aliases.group", error);
    return NextResponse.json({ error: "Failed to load identity group" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const aliasName = request.nextUrl.searchParams.get("aliasName") ?? "";
    const aliasKey = normalizeNameKey(aliasName);
    if (!aliasKey) {
      return NextResponse.json({ error: "aliasName is required" }, { status: 400 });
    }
    const { error } = await supabase
      .from("person_aliases")
      .delete()
      .eq("user_id", user!.id)
      .eq("alias_key", aliasKey);
    if (error) throw error;
    return NextResponse.json({ removed: aliasKey });
  } catch (error) {
    await reportSystemError("people.aliases.delete", error);
    return NextResponse.json({ error: "Failed to unmerge" }, { status: 500 });
  }
}
