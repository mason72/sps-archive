"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { BrandButton } from "@/components/ui/brand-button";
import { Nav } from "@/components/layout/Nav";
import { Footer } from "@/components/layout/Footer";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
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

      // Full page navigation ensures cookies are set before the next request
      window.location.href = redirect;
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Nav>
        <Link
          href="/signup"
          className="editorial-link text-stone-400 hover:text-stone-700 transition-colors duration-300"
        >
          Create account
        </Link>
      </Nav>

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
              <div className="mt-2 text-right">
                <Link
                  href="/forgot-password"
                  className="text-[13px] text-stone-400 hover:text-stone-700 transition-colors duration-300"
                >
                  Forgot password?
                </Link>
              </div>
            </div>

            {/* Error */}
            {error && (
              <p className="text-[13px] text-red-600 fade-in">{error}</p>
            )}

            {/* Submit */}
            <div className="reveal" style={{ animationDelay: "0.2s" }}>
              <BrandButton type="submit" disabled={isLoading} className="w-full">
                {isLoading ? "Signing in..." : "Sign in"}
              </BrandButton>
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

      <Footer />
    </div>
  );
}
