import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/helpers";
import { requireAdmin } from "@/lib/auth/admin";

export const metadata = {
  title: "Pixeltrunk — Ops",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * /ops shell — the admin gate for every ops page.
 *
 * Unauthenticated → app-domain login (ops.pixeltrunk.com has no /login of its
 * own; the rewrite would 404 it). Authenticated non-admin → 404, so the
 * surface doesn't exist for testers. API routes gate themselves via
 * requireAdmin — this layout only covers pages.
 */
export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  const { user } = await getAuthUser();
  if (!user) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
    redirect(`${appUrl}/login?redirect=/ops`);
  }
  const admin = await requireAdmin();
  if (!admin) notFound();

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="sticky top-0 z-40 border-b border-stone-200/70 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link href="/ops" className="flex items-baseline gap-2">
            <span className="font-brand text-lg text-stone-900">Pixeltrunk</span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.25em] text-emerald-700">
              Ops
            </span>
          </Link>
          <Link
            href="/"
            className="text-sm text-stone-500 transition-colors hover:text-stone-900"
          >
            Back to app
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
    </div>
  );
}
