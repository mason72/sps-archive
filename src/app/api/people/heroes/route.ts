import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { heroUrlsFor, readPeopleIndexSnapshot, type HeroUrls } from "@/lib/people/index-cache";
import { reportSystemError } from "@/lib/monitoring/report";

export const runtime = "nodejs";

/**
 * POST /api/people/heroes { keys } — hero thumbnails for the tiles about to
 * scroll into view.
 *
 * /people used to presign every face up front: ~8,300 people, two renditions
 * each plus one per event, which made the page a 40 MB download (measured
 * 2026-09-11). It now inlines the first screenfuls and asks for the rest here
 * as the board scrolls.
 *
 * Reads the snapshot and NOTHING else — never builds, never requests a
 * rebuild. It runs once per scroll batch; letting it build would turn a stale
 * snapshot into a 26-second archive scan per batch per instance. No snapshot
 * answers 503, which the board treats as "ask again later".
 *
 * The request carries PERSON keys, never storage keys, and they are looked up
 * in the caller's own snapshot — so there is nothing to ask for that isn't
 * already theirs.
 */
const MAX_KEYS = 400;

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthUser();
    if (authError) return authError;

    const body = (await request.json().catch(() => ({}))) as { keys?: unknown };
    const keys = Array.isArray(body.keys)
      ? [...new Set(body.keys.filter((k): k is string => typeof k === "string" && !!k))].slice(
          0,
          MAX_KEYS
        )
      : [];
    if (keys.length === 0) return NextResponse.json({ heroes: {} });

    const people = await readPeopleIndexSnapshot(user!.id);
    if (!people) return NextResponse.json({ error: "Index not built yet" }, { status: 503 });
    const heroKeyByPerson = new Map(people.map((p) => [p.key, p.heroKey]));

    const heroes: Record<string, HeroUrls> = {};
    await Promise.all(
      keys.map(async (k) => {
        const heroKey = heroKeyByPerson.get(k);
        if (heroKey) heroes[k] = await heroUrlsFor(heroKey);
      })
    );
    return NextResponse.json({ heroes });
  } catch (err) {
    await reportSystemError("people.heroes", err);
    return NextResponse.json({ error: "Could not load faces" }, { status: 500 });
  }
}
