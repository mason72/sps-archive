"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;

    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        setError(authError.message);
        return;
      }

      router.push(redirect);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav */}
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
        <Link
          href="/signup"
          className="text-[13px] tracking-wide editorial-link text-stone-400 hover:text-stone-700 transition-colors duration-300"
        >
          Create account
        </Link>
      </nav>

      <div className="mx-8 md:mx-16 rule reveal-line" />

      {/* Form */}
      <main className="flex-1 flex items-start justify-center pt-24 px-8 md:px-16">
        <div className="w-full max-w-md">
          <h1 className="font-editorial text-[clamp(36px,5vw,56px)] leading-[0.95] text-stone-900 reveal">
            Welcome{" "}
            <span className="italic font-normal">back</span>
          </h1>
          <p className="caption-italic mt-3 mb-12">
            Sign in to your archive
          </p>

          <form onSubmit={handleSubmit} className="space-y-8">
            {/* Email */}
            <div className="reveal" style={{ animationDelay: "0.1s" }}>
              <label className="label-caps mb-3 block">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full border-b border-stone-200 bg-transparent py-3 text-[16px] text-stone-900 placeholder:text-stone-300 focus:border-stone-900 focus:outline-none transition-colors duration-300"
              />
            </div>

            {/* Password */}
            <div className="reveal" style={{ animationDelay: "0.15s" }}>
              <label className="label-caps mb-3 block">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full border-b border-stone-200 bg-transparent py-3 text-[16px] text-stone-900 placeholder:text-stone-300 focus:border-stone-900 focus:outline-none transition-colors duration-300"
              />
            </div>

            {/* Error */}
            {error && (
              <p className="text-[13px] text-red-600 fade-in">{error}</p>
            )}

            {/* Submit */}
            <div className="reveal" style={{ animationDelay: "0.2s" }}>
              <Button type="submit" disabled={isLoading} className="w-full">
                {isLoading ? "Signing in..." : "Sign in"}
              </Button>
            </div>
          </form>

          <p className="mt-8 text-[13px] text-stone-400 reveal" style={{ animationDelay: "0.25s" }}>
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="text-accent hover:text-accent-hover transition-colors duration-300">
              Get started
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
