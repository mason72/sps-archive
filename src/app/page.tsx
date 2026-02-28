import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EventList } from "@/components/events/EventList";
import { DashboardStats } from "@/components/dashboard/DashboardStats";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Authenticated users get the dashboard
  if (user) {
    return <DashboardView />;
  }

  // Unauthenticated users get the landing page
  return <LandingView />;
}

/* ─────────────────────────────────────────────
 * Dashboard — Authenticated user's event list
 * ───────────────────────────────────────────── */
function DashboardView() {
  return (
    <div className="min-h-screen">
      {/* ─── Nav ─── */}
      <nav className="flex items-center justify-between px-8 py-8 md:px-16 fade-in">
        <h1 className="font-editorial text-[28px] text-stone-900">Prism</h1>
        <div className="flex items-center gap-10 text-[13px] tracking-wide">
          <Link
            href="/events/new"
            className="editorial-link text-stone-400 hover:text-stone-700 transition-colors duration-300"
          >
            New Event
          </Link>
          <Link
            href="/account"
            className="editorial-link text-stone-400 hover:text-stone-700 transition-colors duration-300"
          >
            Account
          </Link>
          <SignOutButton />
        </div>
      </nav>

      <div className="mx-8 md:mx-16 rule reveal-line" />

      {/* ─── Dashboard header ─── */}
      <div className="px-8 md:px-16 pt-16 pb-4">
        <p className="label-caps mb-4 reveal" style={{ animationDelay: "0.1s" }}>
          Your Archive
        </p>
        <h2
          className="font-editorial text-[clamp(36px,5vw,56px)] leading-[0.95] text-stone-900 reveal"
          style={{ animationDelay: "0.15s" }}
        >
          Events
        </h2>
      </div>

      {/* ─── Stats row ─── */}
      <DashboardStats />

      {/* ─── Spacer ─── */}
      <div className="h-8" />

      {/* ─── Event list ─── */}
      <EventList />

      {/* ─── Empty state CTA (shown inside EventList when no events) ─── */}

      {/* ─── Footer ─── */}
      <footer className="px-8 md:px-16 py-8 border-t border-stone-200 mt-16">
        <div className="flex items-center justify-between">
          <p className="text-[12px] text-stone-400">
            <span className="font-editorial text-[14px] text-stone-900">
              Prism
            </span>
            {" "}— Intelligent photo archiving for professionals
          </p>
        </div>
      </footer>
    </div>
  );
}

/* ─────────────────────────────────────────────
 * Landing — Marketing page for unauthenticated users
 * ───────────────────────────────────────────── */
function LandingView() {
  return (
    <div className="min-h-screen">
      {/* ─── Nav ─── */}
      <nav className="flex items-center justify-between px-8 py-8 md:px-16 fade-in">
        <h1 className="font-editorial text-[28px] text-stone-900">Prism</h1>
        <div className="flex items-center gap-10 text-[13px] tracking-wide">
          <Link
            href="/login"
            className="editorial-link text-stone-400 hover:text-stone-700 transition-colors duration-300"
          >
            Sign in
          </Link>
          <Link href="/signup">
            <Button size="sm">Get started</Button>
          </Link>
        </div>
      </nav>

      <div className="mx-8 md:mx-16 rule reveal-line" />

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
            <Button size="lg">Create your first event</Button>
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

      {/* ─── Footer ─── */}
      <footer className="px-8 md:px-16 py-8 border-t border-stone-200">
        <div className="flex items-center justify-between">
          <p className="text-[12px] text-stone-400">
            <span className="font-editorial text-[14px] text-stone-900">
              Prism
            </span>
            {" "}— Intelligent photo archiving for professionals
          </p>
        </div>
      </footer>
    </div>
  );
}
