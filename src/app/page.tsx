import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandButton } from "@/components/ui/brand-button";
import { EventList } from "@/components/events/EventList";
import { DashboardStats } from "@/components/dashboard/DashboardStats";
import { UnfinishedUploadsAlert } from "@/components/dashboard/UnfinishedUploadsAlert";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { createServiceClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { Nav } from "@/components/layout/Nav";
import { Footer } from "@/components/layout/Footer";
import { Greeting } from "@/components/dashboard/Greeting";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Effective user scopes the CONTENT (honors admin act-as); the ops link is
  // the real session's privilege and must not follow the act-as identity.
  const { user, realUser, supabase } = await getAuthUser();

  if (user && realUser) {
    const { data: realProfile } = await supabase
      .from("user_profiles")
      .select("is_admin")
      .eq("user_id", realUser.id)
      .single();
    return (
      <DashboardView
        user={{ id: user.id, email: user.email }}
        showOpsLink={!!realProfile?.is_admin}
      />
    );
  }

  // In production, unauth users on app.pixeltrunk.com redirect to marketing site
  const marketingUrl = process.env.NEXT_PUBLIC_MARKETING_URL;
  if (marketingUrl) {
    redirect(marketingUrl);
  }

  // In dev (no MARKETING_URL set), show the inline landing page
  return <LandingView />;
}

/* ─────────────────────────────────────────────
 * Dashboard — Authenticated user's event list
 * ───────────────────────────────────────────── */
async function DashboardView({
  user,
  showOpsLink,
}: {
  user: { id: string; email?: string };
  showOpsLink: boolean;
}) {
  // Fetch profile for personalized greeting (the EFFECTIVE account's).
  const supabase = createServiceClient();
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("display_name, business_name")
    .eq("user_id", user.id)
    .single();

  const p = profile as {
    display_name?: string;
    business_name?: string;
  } | null;
  const displayName =
    p?.display_name?.split(" ")[0] ||
    p?.business_name ||
    user.email?.split("@")[0] ||
    null;

  // Greeting resolved client-side (see Greeting component) to use visitor's timezone

  return (
    <div className="min-h-screen flex flex-col">
      <Nav>
        <Link
          href="/search"
          className="editorial-link text-stone-400 hover:text-stone-700 transition-colors duration-300"
        >
          Search
        </Link>
        <Link href="/events/new">
          <BrandButton color="emerald" celebrate size="sm">New Event</BrandButton>
        </Link>
        <Link
          href="/account"
          className="editorial-link text-stone-400 hover:text-stone-700 transition-colors duration-300"
        >
          Account
        </Link>
        {/* Rendered from the REAL session's is_admin (survives act-as); the
            /ops page re-gates server-side regardless — a convenience, not
            the lock. */}
        {showOpsLink && (
          <Link
            href="/ops"
            className="editorial-link text-emerald-700 hover:text-emerald-800 transition-colors duration-300"
          >
            Ops
          </Link>
        )}
        <SignOutButton />
      </Nav>

      {/* ─── V3: Personalized greeting ─── */}
      <div className="px-8 md:px-16 pt-16 pb-4">
        <h2
          className="font-editorial text-[clamp(36px,5vw,56px)] leading-[0.95] text-stone-900 reveal"
          style={{ animationDelay: "0.1s" }}
        >
          <Greeting name={displayName} />
        </h2>
        <p
          className="label-caps mt-4 reveal"
          style={{ animationDelay: "0.15s" }}
        >
          Your Archive
        </p>
      </div>

      {/* ─── Missing-uploads alert (above the stats: an incomplete archive
           outranks how many photos are in it) ─── */}
      <UnfinishedUploadsAlert />

      {/* ─── Stats row ─── */}
      <DashboardStats />

      {/* ─── Spacer ─── */}
      <div className="h-8" />

      {/* ─── Event list ─── */}
      <EventList />

      {/* ─── Empty state CTA (shown inside EventList when no events) ─── */}

      <Footer />
    </div>
  );
}

/* ─────────────────────────────────────────────
 * Landing — Marketing page for unauthenticated users
 * ───────────────────────────────────────────── */
function LandingView() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav>
        <Link
          href="/login"
          className="editorial-link text-stone-400 hover:text-stone-700 transition-colors duration-300"
        >
          Sign in
        </Link>
        <Link href="/signup">
          <BrandButton size="sm">Get started</BrandButton>
        </Link>
      </Nav>

      {/* ─── Hero ─── */}
      <div className="px-8 md:px-16 pt-20 pb-24">
        <p
          className="label-caps mb-6 reveal"
          style={{ animationDelay: "0.1s" }}
        >
          Your visual archive
        </p>
        <h2
          className="font-editorial text-[clamp(48px,7vw,80px)] leading-[0.95] text-stone-900 max-w-3xl reveal"
          style={{ animationDelay: "0.15s" }}
        >
          Every frame
          <br />
          tells{" "}
          <span className="italic text-accent font-serif font-normal">
            a story
          </span>
        </h2>
        <p
          className="text-stone-400 text-[15px] mt-8 max-w-lg leading-[1.8] reveal"
          style={{ animationDelay: "0.2s" }}
        >
          Upload thousands of images. AI organizes them into smart stacks,
          searchable sections, and shareable galleries — so you can focus on what
          matters.
        </p>
        <div className="mt-12 reveal" style={{ animationDelay: "0.3s" }}>
          <Link href="/signup">
            <BrandButton size="lg">Create your first event</BrandButton>
          </Link>
        </div>
      </div>

      {/* ─── Section divider ─── */}
      <div
        className="mx-8 md:mx-16 editorial-divider mb-16 reveal"
        style={{ animationDelay: "0.35s" }}
      >
        <span className="label-caps shrink-0">How It Works</span>
      </div>

      {/* ─── Features — editorial 3-column ─── */}
      <div className="px-8 md:px-16 pb-32">
        <div className="grid gap-16 md:grid-cols-3 max-w-5xl">
          {[
            {
              number: "01",
              title: "Smart Stacks",
              description:
                "Twelve headshots of the same person? The best rises to the top. Expand to compare, pick your favourite — or let AI decide.",
            },
            {
              number: "02",
              title: "Natural Search",
              description:
                "Search by what you see, not filenames. \"First dance\", \"speeches at sunset\", or upload a selfie to find every photo of someone.",
            },
            {
              number: "03",
              title: "Auto Sections",
              description:
                "AI detects scenes and creates overlapping sections. One photo can live in multiple contexts — ceremony, candids, family portraits.",
            },
          ].map((feature, i) => (
            <div
              key={feature.number}
              className="reveal"
              style={{ animationDelay: `${0.4 + i * 0.08}s` }}
            >
              <span className="label-caps text-accent">{feature.number}</span>
              <h3 className="font-editorial text-[28px] text-stone-900 mt-3 mb-4">
                {feature.title}
              </h3>
              <p className="text-stone-400 text-[14px] leading-[1.8]">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Pull quote ─── */}
      <div className="px-8 md:px-16 py-20 border-t border-stone-200">
        <blockquote
          className="max-w-2xl mx-auto text-center reveal"
          style={{ animationDelay: "0.1s" }}
        >
          <p className="font-serif italic text-[clamp(24px,3.5vw,36px)] leading-[1.4] text-stone-700">
            &ldquo;The archive should be as beautiful as the work it holds.&rdquo;
          </p>
          <cite className="label-caps mt-6 block not-italic">
            — Design Philosophy
          </cite>
        </blockquote>
      </div>

      <Footer />
    </div>
  );
}
