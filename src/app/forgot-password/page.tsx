"use client";

import { useState } from "react";
import Link from "next/link";
import { BrandButton } from "@/components/ui/brand-button";
import { Nav } from "@/components/layout/Nav";
import { Footer } from "@/components/layout/Footer";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Something went wrong.");
        return;
      }

      setSent(true);
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
          href="/login"
          className="editorial-link text-stone-400 hover:text-stone-700 transition-colors duration-300"
        >
          Sign in
        </Link>
      </Nav>

      <main className="flex-1 flex items-start justify-center pt-24 px-8 md:px-16">
        <div className="w-full max-w-md">
          <h1 className="font-editorial text-[clamp(36px,5vw,56px)] leading-[0.95] text-stone-900 reveal">
            Reset{" "}
            <span className="italic font-normal">password</span>
          </h1>
          <p className="caption-italic mt-3 mb-12">
            {sent
              ? "Check your inbox for a reset link"
              : "Enter your email and we\u2019ll send a reset link"}
          </p>

          {sent ? (
            <div className="space-y-6 reveal">
              <div className="rounded-md border border-stone-200 bg-stone-50 px-5 py-4">
                <p className="text-[14px] text-stone-700">
                  We sent a password reset link to{" "}
                  <span className="font-medium text-stone-900">{email}</span>.
                  Check your inbox and click the link to set a new password.
                </p>
              </div>
              <p className="text-[13px] text-stone-400">
                Didn&apos;t receive it?{" "}
                <button
                  onClick={() => setSent(false)}
                  className="text-accent hover:text-accent-hover transition-colors duration-300"
                >
                  Try again
                </button>
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-8">
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

              {error && (
                <p className="text-[13px] text-red-600 fade-in">{error}</p>
              )}

              <div className="reveal" style={{ animationDelay: "0.15s" }}>
                <BrandButton type="submit" disabled={isLoading} className="w-full">
                  {isLoading ? "Sending..." : "Send reset link"}
                </BrandButton>
              </div>
            </form>
          )}

          <p className="mt-8 text-[13px] text-stone-400 reveal" style={{ animationDelay: "0.2s" }}>
            Remember your password?{" "}
            <Link href="/login" className="text-accent hover:text-accent-hover transition-colors duration-300">
              Sign in
            </Link>
          </p>
        </div>
      </main>

      <Footer />
    </div>
  );
}
