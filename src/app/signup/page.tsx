"use client";

import { useState } from "react";
import Link from "next/link";
import { BrandButton } from "@/components/ui/brand-button";
import { Nav } from "@/components/layout/Nav";
import { Footer } from "@/components/layout/Footer";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          name: name.trim() || undefined,
          company: company.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }

      setIsSuccess(true);
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
          {isSuccess ? (
            /* Success state */
            <div className="reveal">
              <h1 className="font-editorial text-[clamp(36px,5vw,56px)] leading-[0.95] text-stone-900">
                You&apos;re{" "}
                <span className="italic font-normal">on the list</span>
              </h1>
              <p className="caption-italic mt-3 mb-4">
                Thanks for your interest in Pixeltrunk.
              </p>
              <p className="text-stone-400 text-[14px] leading-[1.8] mb-8">
                We&apos;ll reach out to <span className="text-stone-600">{email}</span> when
                your spot opens up. In the meantime, keep shooting.
              </p>
              <Link href="/">
                <BrandButton variant="secondary">Back to home</BrandButton>
              </Link>
            </div>
          ) : (
            /* Waitlist form */
            <>
              <div className="mb-3 reveal">
                <span className="inline-block px-3 py-1 text-[11px] uppercase tracking-[0.15em] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200">
                  Closed Beta
                </span>
              </div>
              <h1 className="font-editorial text-[clamp(36px,5vw,56px)] leading-[0.95] text-stone-900 reveal">
                Join the{" "}
                <span className="italic font-normal">waitlist</span>
              </h1>
              <p className="caption-italic mt-3 mb-12">
                Pixeltrunk is currently in closed beta. Sign up to reserve your spot.
              </p>

              <form onSubmit={handleSubmit} className="space-y-8">
                {/* Name */}
                <div className="reveal" style={{ animationDelay: "0.1s" }}>
                  <label className="label-caps mb-3 block">
                    Name <span className="normal-case tracking-normal text-stone-300">optional</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    className="w-full border-b border-stone-200 bg-transparent py-3 text-[16px] text-stone-900 placeholder:text-stone-300 focus:border-stone-900 focus:outline-none transition-colors duration-300"
                  />
                </div>

                {/* Email */}
                <div className="reveal" style={{ animationDelay: "0.15s" }}>
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

                {/* Company / Studio */}
                <div className="reveal" style={{ animationDelay: "0.2s" }}>
                  <label className="label-caps mb-3 block">
                    Studio / Company <span className="normal-case tracking-normal text-stone-300">optional</span>
                  </label>
                  <input
                    type="text"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="Your studio or business name"
                    className="w-full border-b border-stone-200 bg-transparent py-3 text-[16px] text-stone-900 placeholder:text-stone-300 focus:border-stone-900 focus:outline-none transition-colors duration-300"
                  />
                </div>

                {/* Error */}
                {error && (
                  <p className="text-[13px] text-red-600 fade-in">{error}</p>
                )}

                {/* Submit */}
                <div className="reveal" style={{ animationDelay: "0.25s" }}>
                  <BrandButton type="submit" disabled={isLoading} color="emerald" className="w-full">
                    {isLoading ? "Joining waitlist..." : "Join the waitlist"}
                  </BrandButton>
                </div>
              </form>

              <p className="mt-8 text-[13px] text-stone-400 reveal" style={{ animationDelay: "0.3s" }}>
                Already have an account?{" "}
                <Link href="/login" className="text-accent hover:text-accent-hover transition-colors duration-300">
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
