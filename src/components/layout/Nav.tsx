"use client";

import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/components/auth/AuthProvider";

interface NavProps {
  /** Extra nav items to render before auth controls */
  children?: React.ReactNode;
}

/**
 * Nav — Shared auth-aware navigation bar.
 *
 * Shows "Sign in" when logged out, user email + "Sign out" when logged in.
 * Accepts optional children for page-specific nav items (Upload, Share, etc).
 */
export function Nav({ children }: NavProps) {
  const { user, signOut } = useAuth();

  return (
    <>
      <nav className="flex items-center justify-between px-8 py-8 md:px-16 fade-in">
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
        <div className="flex items-center gap-6">
          {children}
          {user ? (
            <>
              <Link
                href="/account"
                className="text-[13px] tracking-wide editorial-link text-stone-400 hover:text-stone-700 transition-colors duration-300"
              >
                Account
              </Link>
              <button
                onClick={signOut}
                className="text-[13px] tracking-wide editorial-link text-stone-400 hover:text-stone-700 transition-colors duration-300"
              >
                Sign out
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="text-[13px] tracking-wide editorial-link text-stone-400 hover:text-stone-700 transition-colors duration-300"
            >
              Sign in
            </Link>
          )}
        </div>
      </nav>
      <div className="mx-8 md:mx-16 rule reveal-line" />
    </>
  );
}
