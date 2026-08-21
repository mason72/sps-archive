import { notFound, redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/helpers";
import { hasIntelAccess } from "@/lib/event-intel/access";
import { Nav } from "@/components/layout/Nav";
import { AppNavServer } from "@/components/layout/AppNavServer";
import { Footer } from "@/components/layout/Footer";
import { BulkNotes } from "./BulkNotes";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Behind the scenes — Pixeltrunk",
};

/**
 * /intel/notes/new — drop a camera roll, say where it was, save.
 *
 * INTERNAL, same gate and the same reasoning as /intel: checked before
 * anything renders, not around the render.
 */
export default async function NewNotesPage() {
  const { user } = await getAuthUser();
  if (!user) redirect("/login?redirect=/intel/notes/new");
  if (!hasIntelAccess(user.id)) notFound();

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      <Nav>
        <AppNavServer current="intel" />
      </Nav>
      <main className="flex-1 w-full max-w-3xl mx-auto px-5 py-10 sm:px-8 md:py-12">
        <BulkNotes />
      </main>
      <Footer />
    </div>
  );
}
