import { notFound, redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/helpers";
import { hasIntelAccess } from "@/lib/event-intel/access";
import { buildIntelIndex } from "@/lib/event-intel/index-intel";
import { Nav } from "@/components/layout/Nav";
import { AppNavServer } from "@/components/layout/AppNavServer";
import { Footer } from "@/components/layout/Footer";
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

  /**
   * Gated BEFORE the fetch, not around the render.
   *
   * Under streaming SSR a layout is not a security boundary and neither is a
   * conditional in JSX — the same rule /ops pages follow (`assertAdminPage()`
   * before any fetch). `buildIntelIndex` would read nothing but this account's
   * own rows, so there is no leak either way; the point is that the check runs
   * where it cannot be skipped.
   */
  if (!hasIntelAccess(user.id)) notFound();

  const index = await buildIntelIndex(supabase, user.id);

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      <Nav>
        <AppNavServer current="intel" />
      </Nav>
      <main className="flex-1 w-full max-w-[1400px] mx-auto px-8 py-12 md:px-16">
        <IntelBoard index={index} />
      </main>
      <Footer />
    </div>
  );
}
