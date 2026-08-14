import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/helpers";
import { buildIntelIndex } from "@/lib/event-intel/index-intel";
import { Nav } from "@/components/layout/Nav";
import { Footer } from "@/components/layout/Footer";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { IntelBoard } from "./IntelBoard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Intel — Pixeltrunk",
};

/**
 * /intel — the back-office pivot.
 *
 * INTERNAL. Nothing here reaches a guest, a share or a gallery: it holds venue
 * logistics, crew rebook judgements and client structure, and the rebook field
 * in particular is personnel data about named people who do not work here.
 * There is no share path to this route and there must never be one.
 *
 * The whole index is built server-side and handed over in one payload rather
 * than fetched per axis. It is a few hundred rows, and holding it all in the
 * client is what makes the cross-axis jumps — person → venue → city → client —
 * instant instead of a spinner each time. That responsiveness IS the feature;
 * an investigation tool you have to wait on stops being one you poke at.
 */
export default async function IntelPage() {
  const { user, supabase } = await getAuthUser();
  if (!user) redirect("/login?redirect=/intel");

  const index = await buildIntelIndex(supabase, user.id);

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      <Nav>
        <Link href="/" className="editorial-link text-stone-400 transition-colors duration-300 hover:text-stone-700">
          Archive
        </Link>
        <Link href="/people" className="editorial-link text-stone-400 transition-colors duration-300 hover:text-stone-700">
          People
        </Link>
        <Link href="/search" className="editorial-link text-stone-400 transition-colors duration-300 hover:text-stone-700">
          Search
        </Link>
        <Link href="/account" className="editorial-link text-stone-400 transition-colors duration-300 hover:text-stone-700">
          Account
        </Link>
        <SignOutButton />
      </Nav>
      <main className="flex-1 w-full max-w-[1400px] mx-auto px-8 py-12 md:px-16">
        <IntelBoard index={index} />
      </main>
      <Footer />
    </div>
  );
}
