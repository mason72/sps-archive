import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";
import { normalizeNameKey, looksLikePersonName } from "@/lib/people/index-people";

/**
 * "That isn't a person."
 *
 * The People index reads identity out of filenames, and filenames lie
 * convincingly: "Twodudes Arizona" is a filename prefix that arrived with 439
 * photos of a 2018 conference; "Jordan BackToSchool Banner.ai" is an
 * Illustrator artboard. Both are two capitalised words with no digits — the
 * exact shape of a real name — so no tightening of the pattern separates them.
 * A human has to be able to say so, once, and have it stick.
 *
 * Stored against the NORMALISED key, so every capitalisation of the same
 * non-person disappears together. Reversible by design: DELETE restores it, and
 * nothing about the photos themselves is touched — this only decides whether an
 * identity appears in the index.
 */

export async function POST(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = supabase as any;

    const { name, reason } = (await request.json()) as { name?: string; reason?: string };
    if (!name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });

    // The key comes from the SAME normaliser the index uses. Deriving it here
    // rather than trusting a client-supplied key means the exclusion cannot
    // miss by a capitalisation.
    const key = normalizeNameKey(name.trim());
    if (!key) return NextResponse.json({ error: "name normalises to nothing" }, { status: 400 });

    const { error } = await db.from("excluded_people").upsert(
      { user_id: user!.id, person_key: key, name: name.trim(), reason: reason?.slice(0, 500) || null },
      { onConflict: "user_id,person_key" }
    );
    if (error) throw error;

    return NextResponse.json({ ok: true, key });
  } catch (err) {
    await reportSystemError("api.people.exclude.POST", err);
    return NextResponse.json({ error: "Could not exclude" }, { status: 500 });
  }
}

/** Undo. `?name=` or `?key=` — the name is normalised the same way. */
export async function DELETE(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = supabase as any;

    const url = new URL(request.url);
    const name = url.searchParams.get("name");
    const key = url.searchParams.get("key") ?? (name ? normalizeNameKey(name) : null);
    if (!key) return NextResponse.json({ error: "name or key required" }, { status: 400 });

    const { error } = await db.from("excluded_people")
      .delete().eq("user_id", user!.id).eq("person_key", key);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    await reportSystemError("api.people.exclude.DELETE", err);
    return NextResponse.json({ error: "Could not restore" }, { status: 500 });
  }
}

/** The current exclusions, so the UI can offer an undo list. */
export async function GET() {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = supabase as any;

    const { data, error } = await db
      .from("excluded_people")
      .select("person_key, name, reason, created_at")
      .eq("user_id", user!.id)
      .order("created_at", { ascending: false });
    if (error) throw error;

    return NextResponse.json({
      excluded: (data ?? []).map((r: { person_key: string; name: string | null; reason: string | null; created_at: string }) => ({
        key: r.person_key,
        name: r.name,
        reason: r.reason,
        at: r.created_at,
        // Flags the ones that DID read as a name — those are the ones worth a
        // second look if someone wonders why a person vanished.
        lookedLikeAName: r.name ? looksLikePersonName(r.name) : false,
      })),
    });
  } catch (err) {
    await reportSystemError("api.people.exclude.GET", err);
    return NextResponse.json({ error: "Could not load" }, { status: 500 });
  }
}
