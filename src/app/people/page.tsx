import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/helpers";
import { buildPeopleIndex } from "@/lib/people/index-people";
import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";
import { Nav } from "@/components/layout/Nav";
import { Footer } from "@/components/layout/Footer";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { PeopleBoard } from "./PeopleBoard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const metadata = {
  title: "People — Pixeltrunk",
};

/**
 * /people — everyone you've ever photographed, across every event.
 *
 * Internal to the photographer (their own events only). The "wall of fame"
 * Mason asked for is the TOP of this list rather than a separate page: with a
 * partially-migrated archive a repeat-subjects-only view is empty, while the
 * full index is useful from day one and the ranking fills in as work moves
 * over (2026-08-10: 1,570 named people, 1 with two events).
 */
export default async function PeoplePage() {
  const { user, supabase } = await getAuthUser();
  if (!user) redirect("/login?redirect=/people");

  const people = await buildPeopleIndex(supabase, user.id);
  const withHeroes = await Promise.all(
    people.map(async (p) => ({
      key: p.key,
      name: p.name,
      eventCount: p.eventCount,
      imageCount: p.imageCount,
      heroUrl: p.heroKey
        ? await getPresignedDownloadUrl(getThumbnailKey(p.heroKey), 14400)
        : null,
      // The podium renders ~600px wide; thumb-md (400px) visibly pixelates
      // there. Small tiles keep the md rendition via srcset — serving 800px
      // to a 180px tile would be 900 wasted large images on first paint.
      heroUrlLg: p.heroKey
        ? await getPresignedDownloadUrl(
            getThumbnailKey(p.heroKey, "thumb-lg"),
            14400
          )
        : null,
      events: await Promise.all(
        p.events.map(async (e) => ({
          eventId: e.eventId,
          eventName: e.eventName,
          eventDate: e.eventDate,
          imageCount: e.imageCount,
          heroUrl: e.heroKey
            ? await getPresignedDownloadUrl(getThumbnailKey(e.heroKey), 14400)
            : null,
        }))
      ),
    }))
  );

  const repeat = withHeroes.filter((p) => p.eventCount >= 2).length;

  return (
    <div className="flex min-h-screen flex-col">
      <Nav>
        <Link
          href="/"
          className="editorial-link text-stone-400 transition-colors duration-300 hover:text-stone-700"
        >
          Archive
        </Link>
        <Link
          href="/search"
          className="editorial-link text-stone-400 transition-colors duration-300 hover:text-stone-700"
        >
          Search
        </Link>
        <Link
          href="/account"
          className="editorial-link text-stone-400 transition-colors duration-300 hover:text-stone-700"
        >
          Account
        </Link>
        <SignOutButton />
      </Nav>

      <div className="px-8 pb-4 pt-16 md:px-16">
        <h2 className="font-editorial reveal text-[clamp(36px,5vw,56px)] leading-[0.95] text-stone-900">
          Everyone you&apos;ve{" "}
          <span className="font-serif italic text-emerald-600">photographed</span>
        </h2>
        <p className="label-caps reveal mt-4">
          {withHeroes.length.toLocaleString()} people
          {repeat > 0 && ` · ${repeat} across multiple events`}
        </p>
      </div>

      <PeopleBoard people={withHeroes} />

      <Footer />
    </div>
  );
}
