import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";
import { inngest } from "@/lib/inngest/client";
import { normalizeNameKey, looksLikePersonName } from "@/lib/people/index-people";
import { excludeNonPerson, restoreNonPerson } from "@/lib/people/exclude";
import { requestPeopleIndexRefresh } from "@/lib/people/index-cache";

export const runtime = "nodejs";
// Clearing a label across every cluster and restoring the reference faces on
// undo are a handful of writes per event — comfortably inside this.
export const maxDuration = 60;

/**
 * "That isn't a person."
 *
 * The People index reads identity out of filenames, and filenames lie
 * convincingly: "Twodudes Arizona" is a filename prefix that arrived with 439
 * photos of a 2018 conference; "Jordan BackToSchool Banner.ai" is an
 * Illustrator artboard; "Weka SKO27" is a gallery name every file carried.
 * They have the exact shape of a real name, so no tightening of the pattern
 * separates them. A human has to be able to say so, once, and have it stick
 * EVERYWHERE — the wall, the filename namer, and the naming engine's
 * suggestions. What that means lives in src/lib/people/exclude.ts.
 *
 * Stored against the NORMALISED key, so every capitalisation of the same
 * non-person goes together. Reversible: DELETE restores the exclusion's exact
 * footprint. Nothing about the photos themselves is touched.
 */

/** The engine re-asks those events who their now-anonymous faces are. */
async function requestIdentityScans(eventIds: string[]) {
  if (eventIds.length === 0) return;
  try {
    await inngest.send(
      eventIds.map((eventId) => ({
        name: "people/identity-scan.requested" as const,
        data: { eventId },
      }))
    );
  } catch (err) {
    // Best-effort — the exclusion itself stands — but never silent.
    await reportSystemError("api.people.exclude.scan", err, { eventIds });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { name, reason } = (await request.json()) as { name?: string; reason?: string };
    if (!name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
    // The key comes from the SAME normaliser the index uses. Deriving it here
    // rather than trusting a client-supplied key means the exclusion cannot
    // miss by a capitalisation.
    if (!normalizeNameKey(name.trim())) {
      return NextResponse.json({ error: "name normalises to nothing" }, { status: 400 });
    }

    const result = await excludeNonPerson(supabase, user!.id, name, reason);
    await requestIdentityScans(result.eventIds);
    await requestPeopleIndexRefresh(user!.id);

    return NextResponse.json({ ok: true, ...result });
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

    const url = new URL(request.url);
    const name = url.searchParams.get("name");
    const key = url.searchParams.get("key") ?? (name ? normalizeNameKey(name) : null);
    if (!key) return NextResponse.json({ error: "name or key required" }, { status: 400 });

    const result = await restoreNonPerson(supabase, user!.id, key);
    await requestIdentityScans(result.eventIds);
    await requestPeopleIndexRefresh(user!.id);

    return NextResponse.json({ ok: true, ...result });
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
