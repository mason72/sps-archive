"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { BrandButton } from "@/components/ui/brand-button";
import { Nav } from "@/components/layout/Nav";
import { Footer } from "@/components/layout/Footer";

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [ready, setReady] = useState(false);
  const [verifying, setVerifying] = useState(true);

  // Verify the token_hash from the URL on mount
  useEffect(() => {
    const tokenHash = searchParams.get("token_hash");
    const type = searchParams.get("type");

    if (!tokenHash || type !== "recovery") {
      // No token — check if we already have a session (e.g. came from auth callback)
      const supabase = createClient();
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          setReady(true);
        } else {
          setError("Invalid or missing reset link. Please request a new one.");
        }
        setVerifying(false);
      });
      return;
    }

    // Verify the token hash directly with Supabase
    const supabase = createClient();
    supabase.auth
      .verifyOtp({ token_hash: tokenHash, type: "recovery" })
      .then(({ error: verifyError }) => {
        if (verifyError) {
          setError("This reset link has expired or is invalid. Please request a new one.");
        } else {
          setReady(true);
        }
        setVerifying(false);
      });
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords don\u2019t match.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) {
        setError(updateError.message);
        return;
      }

      setDone(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      <main className="flex-1 flex items-start justify-center pt-24 px-8 md:px-16">
        <div className="w-full max-w-md">
          <h1 className="font-editorial text-[clamp(36px,5vw,56px)] leading-[0.95] text-stone-900 reveal">
            New{" "}
            <span className="italic font-normal">password</span>
          </h1>
          <p className="caption-italic mt-3 mb-12">
            {done ? "You\u2019re all set" : "Choose a new password for your account"}
          </p>

          {verifying ? (
            <div className="py-8 text-center">
              <p className="text-[14px] text-stone-400">Verifying your reset link...</p>
            </div>
          ) : done ? (
            <div className="space-y-6 reveal">
              <div className="rounded-md border border-stone-200 bg-stone-50 px-5 py-4">
                <p className="text-[14px] text-stone-700">
                  Your password has been updated. You can now sign in with your new password.
                </p>
              </div>
              <Link href="/">
                <BrandButton className="w-full">
                  Go to your archive
                </BrandButton>
              </Link>
            </div>
          ) : error && !ready ? (
            <div className="space-y-6 reveal">
              <p className="text-[14px] text-red-600">{error}</p>
              <Link href="/forgot-password">
                <BrandButton className="w-full">
                  Request a new link
                </BrandButton>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-8">
              <div className="reveal" style={{ animationDelay: "0.1s" }}>
                <label className="label-caps mb-3 block">New password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  className="w-full border-b border-stone-200 bg-transparent py-3 text-[16px] text-stone-900 placeholder:text-stone-300 focus:border-stone-900 focus:outline-none transition-colors duration-300"
                />
              </div>

              <div className="reveal" style={{ animationDelay: "0.15s" }}>
                <label className="label-caps mb-3 block">Confirm password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  className="w-full border-b border-stone-200 bg-transparent py-3 text-[16px] text-stone-900 placeholder:text-stone-300 focus:border-stone-900 focus:outline-none transition-colors duration-300"
                />
              </div>

              {error && (
                <p className="text-[13px] text-red-600 fade-in">{error}</p>
              )}

              <div className="reveal" style={{ animationDelay: "0.2s" }}>
                <BrandButton type="submit" disabled={isLoading} className="w-full">
                  {isLoading ? "Updating..." : "Update password"}
                </BrandButton>
              </div>
            </form>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
