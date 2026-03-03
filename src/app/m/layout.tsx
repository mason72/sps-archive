import Link from "next/link";
import Image from "next/image";
import { BrandButton } from "@/components/ui/brand-button";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "";

/**
 * Marketing Layout — shared nav + footer for pixeltrunk.com pages.
 * No auth provider, no command palette — pure marketing shell.
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      {/* ─── Navigation ─── */}
      <nav className="flex items-center justify-between px-8 py-6 md:px-16 fade-in">
        <Link href="/" className="flex items-center gap-2.5">
          <Image
            src="/logo.png"
            alt="pixeltrunk"
            width={32}
            height={32}
            className="rounded-md"
          />
          <span className="font-brand text-[22px] text-stone-900">
            pixeltrunk
          </span>
        </Link>

        {/* Center links */}
        <div className="hidden md:flex items-center gap-8 text-[13px] tracking-wide">
          <Link
            href="/#features"
            className="text-stone-400 hover:text-stone-900 transition-colors duration-300"
          >
            Features
          </Link>
          <Link
            href="/pricing"
            className="text-stone-400 hover:text-stone-900 transition-colors duration-300"
          >
            Pricing
          </Link>
        </div>

        {/* Auth links */}
        <div className="flex items-center gap-5 md:gap-6 text-[13px] tracking-wide">
          <a
            href={`${APP_URL}/login`}
            className="text-stone-400 hover:text-stone-900 transition-colors duration-300"
          >
            Sign in
          </a>
          <a href={`${APP_URL}/signup`}>
            <BrandButton size="sm" color="emerald">
              Get Started
            </BrandButton>
          </a>
        </div>
      </nav>
      <div className="mx-8 md:mx-16 rule" />

      {/* ─── Page Content ─── */}
      <main className="flex-1">{children}</main>

      {/* ─── Footer ─── */}
      <footer className="border-t border-stone-200 mt-auto">
        <div className="px-8 md:px-16 py-12">
          <div className="grid gap-8 md:grid-cols-4 max-w-6xl">
            {/* Brand */}
            <div className="md:col-span-2">
              <div className="flex items-center gap-2 mb-3">
                <Image
                  src="/logo.png"
                  alt="pixeltrunk"
                  width={24}
                  height={24}
                  className="rounded"
                />
                <span className="font-brand text-[18px] text-stone-900">
                  pixeltrunk
                </span>
              </div>
              <p className="text-[13px] text-stone-400 leading-relaxed max-w-sm">
                AI-powered photo archive for professional photographers.
                Organize, search, and share — beautifully.
              </p>
            </div>

            {/* Product */}
            <div>
              <p className="label-caps mb-4">Product</p>
              <ul className="space-y-2.5 text-[13px]">
                <li>
                  <Link
                    href="/#features"
                    className="text-stone-400 hover:text-stone-900 transition-colors"
                  >
                    Features
                  </Link>
                </li>
                <li>
                  <Link
                    href="/pricing"
                    className="text-stone-400 hover:text-stone-900 transition-colors"
                  >
                    Pricing
                  </Link>
                </li>
                <li>
                  <a
                    href={`${APP_URL}/signup`}
                    className="text-stone-400 hover:text-stone-900 transition-colors"
                  >
                    Get Started
                  </a>
                </li>
              </ul>
            </div>

            {/* Company */}
            <div>
              <p className="label-caps mb-4">Connect</p>
              <ul className="space-y-2.5 text-[13px]">
                <li>
                  <a
                    href="mailto:hello@pixeltrunk.com"
                    className="text-stone-400 hover:text-stone-900 transition-colors"
                  >
                    hello@pixeltrunk.com
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-12 pt-6 border-t border-stone-100">
            <p className="text-[11px] text-stone-300">
              &copy; {new Date().getFullYear()} Pixeltrunk. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
