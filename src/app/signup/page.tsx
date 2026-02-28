"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Nav } from "@/components/layout/Nav";
import { Footer } from "@/components/layout/Footer";

export default function SignupPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;

    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: name.trim() || undefined },
        },
      });

      if (authError) {
        setError(authError.message);
        return;
      }

      // If session exists, email confirmation is disabled — go straight in
      if (authData.session) {
        router.push("/");
        router.refresh();
        return;
      }

      // Otherwise show "check your email" state
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
                Check your{" "}
                <span className="italic font-normal">email</span>
              </h1>
              <p className="caption-italic mt-3 mb-8">
                We sent a confirmation link to {email}
              </p>
              <Link href="/login">
                <Button variant="secondary">Back to sign in</Button>
              </Link>
            </div>
          ) : (
            /* Signup form */
            <>
              <h1 className="font-editorial text-[clamp(36px,5vw,56px)] leading-[0.95] text-stone-900 reveal">
                Get{" "}
                <span className="italic font-normal">started</span>
              </h1>
              <p className="caption-italic mt-3 mb-12">
                Create your pixeltrunk account
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

                {/* Password */}
                <div className="reveal" style={{ animationDelay: "0.2s" }}>
                  <label className="label-caps mb-3 block">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    required
                    minLength={6}
                    className="w-full border-b border-stone-200 bg-transparent py-3 text-[16px] text-stone-900 placeholder:text-stone-300 focus:border-stone-900 focus:outline-none transition-colors duration-300"
                  />
                </div>

                {/* Error */}
                {error && (
                  <p className="text-[13px] text-red-600 fade-in">{error}</p>
                )}

                {/* Submit */}
                <div className="reveal" style={{ animationDelay: "0.25s" }}>
                  <Button type="submit" disabled={isLoading} className="w-full">
                    {isLoading ? "Creating account..." : "Create account"}
                  </Button>
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
