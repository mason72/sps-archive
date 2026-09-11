import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/helpers";
import { normalizeNameKey } from "@/lib/people/index-people";
import { getPeopleIndex, heroUrlsFor } from "@/lib/people/index-cache";
import { getCachedThumbnailUrl, getThumbnailKey } from "@/lib/r2/client";
import { Nav } from "@/components/layout/Nav";
import { AppNavServer } from "@/components/layout/AppNavServer";
import { Footer } from "@/components/layout/Footer";
import { PeopleBoard, type PersonCard } from "./PeopleBoard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const metadata = {
  title: "People — Pixeltrunk",
};

/**
 * Faces signed inline: the first screenfuls, in the board's default order.
 * The rest arrive from /api/people/heroes as the board scrolls. Signing all
 * ~8,300 people up front (two renditions each, plus one per event) made this
 * page a 40 MB, 57-second load — measured 2026-09-11.
 */
const INLINE_HEROES = 240;
/**
 * Repeat people whose event chips get thumbnails. The podium shows six; the
 * spares cover "Not a person" clicks promoting the next in line.
 */
const CHIP_PEOPLE = 12;

function builtAgo(builtAt: number): string {
  const min = Math.floor((Date.now() - builtAt) / 60000);
  if (min < 1) return "updated just now";
  if (min < 60) return `updated ${min} min ago`;
  return `updated ${Math.floor(min / 60)} h ago`;
}

/**
 * /people — everyone you've ever photographed, across every event.
 *
 * Internal to the photographer (their own events only). The "wall of fame"
 * Mason asked for is the TOP of this list rather than a separate page: with a
 * partially-migrated archive a repeat-subjects-only view is empty, while the
 * full index is useful from day one and the ranking fills in as work moves
 * over (2026-08-10: 1,570 named people, 1 with two events).
 *
 * The index is read from its R2 snapshot (src/lib/people/index-cache.ts) and
 * rebuilt behind the response when stale, so the header says how old it is.
 */
export default async function PeoplePage() {
  const { user, supabase } = await getAuthUser();
  if (!user) redirect("/login?redirect=/people");

  const { people, builtAt } = await getPeopleIndex(supabase, user.id);

  // Crew stay off the PODIUM (Mason: "exclude crew from the wall of fame") —
  // the trophy shelf is for clients and guests, not the people paid to be in
  // frame. They remain in Everyone and in search. Keyed the same way identity
  // is keyed, so any spelling of a crew name is caught. Note the asymmetry
  // this fixes read backwards: Mason was the ONLY crew on the podium because
  // he's the only crew whose name appears in filenames (9 events' exports
  // carry it); Joey/Justin/Jerrick hold zero filename identities.
  const { data: crewRows } = await supabase
    .from("crew")
    .select("display_name, aliases")
    .eq("user_id", user.id);
  const crewKeys = new Set<string>();
  for (const c of crewRows ?? []) {
    for (const name of [c.display_name, ...((c.aliases as string[] | null) ?? [])]) {
      const key = normalizeNameKey(name ?? "");
      if (key) crewKeys.add(key);
    }
  }

  // The board's default order is server rank with crew closing the list
  // (PeopleBoard's rule), so these are the tiles on screen first. If the two
  // ever drift, the cost is only that a few faces load on demand instead.
  const defaultOrder = [
    ...people.filter((p) => !crewKeys.has(p.key)),
    ...people.filter((p) => crewKeys.has(p.key)),
  ];
  const inline = new Set(defaultOrder.slice(0, INLINE_HEROES).map((p) => p.key));
  const chipPeople = new Set(
    people
      .filter((p) => p.eventCount >= 2 && !crewKeys.has(p.key))
      .slice(0, CHIP_PEOPLE)
      .map((p) => p.key)
  );

  const cards: PersonCard[] = await Promise.all(
    people.map(async (p) => {
      // The podium renders ~600px wide; thumb-md (400px) visibly pixelates
      // there, so both renditions travel and srcset picks.
      const hero = p.heroKey && inline.has(p.key) ? await heroUrlsFor(p.heroKey) : null;
      return {
        key: p.key,
        name: p.name,
        isCrew: crewKeys.has(p.key),
        eventCount: p.eventCount,
        imageCount: p.imageCount,
        hasHero: !!p.heroKey,
        ...(hero ? { heroUrl: hero.md, heroUrlLg: hero.lg } : {}),
        // Only the podium's chips read these, and only repeat people reach
        // the podium — sending every single-shoot appearance was dead weight.
        events:
          p.eventCount >= 2
            ? await Promise.all(
                p.events.map(async (e) => ({
                  eventId: e.eventId,
                  eventName: e.eventName,
                  eventDate: e.eventDate,
                  imageCount: e.imageCount,
                  heroUrl:
                    chipPeople.has(p.key) && e.heroKey
                      ? await getCachedThumbnailUrl(getThumbnailKey(e.heroKey), 14400)
                      : null,
                }))
              )
            : [],
      };
    })
  );

  const repeat = cards.filter((p) => p.eventCount >= 2).length;

  return (
    <div className="flex min-h-screen flex-col">
      <Nav>
        <AppNavServer current="people" />
      </Nav>

      <div className="px-8 pb-4 pt-16 md:px-16">
        <h2 className="font-editorial reveal text-[clamp(36px,5vw,56px)] leading-[0.95] text-stone-900">
          Everyone you&apos;ve{" "}
          <span className="font-serif italic text-emerald-600">photographed</span>
        </h2>
        <p className="label-caps reveal mt-4">
          {cards.length.toLocaleString()} people
          {repeat > 0 && ` · ${repeat} across multiple events`}
          <span
            className="ml-2 normal-case tracking-normal text-stone-300"
            title="Rebuilt in the background after confirms, merges, renames and exclusions, and whenever it is over 10 minutes old."
          >
            · {builtAgo(builtAt)}
          </span>
        </p>
      </div>

      <PeopleBoard people={cards} />

      <Footer />
    </div>
  );
}
