"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { BrandButton } from "@/components/ui/brand-button";
import { Button } from "@/components/ui/button";

/**
 * First-run onboarding modal.
 *
 * Trigger: dashboard mount, when the user_profiles row has neither
 * display_name nor business_name set. Skipping persists a localStorage
 * flag so the modal doesn't keep reappearing for users who genuinely
 * want a blank profile.
 *
 * We deliberately keep this to one screen — three fields with sensible
 * defaults — so it feels like a welcome moment, not a wizard.
 */
export function OnboardingPrompt() {
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Skip if the user already explicitly dismissed onboarding.
    if (typeof window !== "undefined") {
      try {
        if (localStorage.getItem("pt-onboarding-dismissed") === "1") return;
      } catch {
        // localStorage unavailable; just proceed with the API check.
      }
    }

    (async () => {
      try {
        const res = await fetch("/api/account");
        if (!res.ok) return;
        const data = await res.json();
        const p = data?.profile;
        if (!p) return;
        // Only prompt if BOTH name fields are empty — having either is
        // enough signal that the user has been here.
        if (!p.displayName && !p.businessName) {
          if (!cancelled) setOpen(true);
        }
      } catch {
        // Non-blocking — never let onboarding bork the dashboard.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function dismissForever() {
    try {
      localStorage.setItem("pt-onboarding-dismissed", "1");
    } catch {
      // ignore
    }
    setOpen(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: displayName.trim() || null,
          businessName: businessName.trim() || null,
        }),
      });
      if (!res.ok) throw new Error("save failed");
      toast.success("Welcome to Pixeltrunk");
      dismissForever();
    } catch (err) {
      console.error("[onboarding] save failed:", err);
      toast.error("Couldn't save your details. You can update them later in Account.");
      setSubmitting(false);
    }
  }

  if (!open) return null;
  if (typeof window === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm fade-in">
      <div className="w-full max-w-md mx-4 bg-white border border-stone-200 p-8 shadow-2xl">
        <p className="label-caps mb-3">Welcome</p>
        <h2 className="font-editorial text-[28px] leading-[1.05] text-stone-900 mb-2">
          Let&apos;s set up your{" "}
          <span className="italic font-normal">archive</span>
        </h2>
        <p className="text-[13px] text-stone-400 mb-7 leading-relaxed">
          A couple of details so your client galleries look like they belong
          to you. Both are optional — you can update everything later in
          Account settings.
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="label-caps mb-2 block">Your name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="First name only is fine"
              autoFocus
              className="w-full border-b border-stone-200 bg-transparent py-2 text-[15px] text-stone-900 placeholder:text-stone-300 focus:border-stone-900 focus:outline-none transition-colors duration-300"
            />
          </div>
          <div>
            <label className="label-caps mb-2 block">Business name</label>
            <input
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Studio or brand"
              className="w-full border-b border-stone-200 bg-transparent py-2 text-[15px] text-stone-900 placeholder:text-stone-300 focus:border-stone-900 focus:outline-none transition-colors duration-300"
            />
          </div>

          <div className="flex items-center justify-between pt-3">
            <Button type="button" variant="ghost" onClick={dismissForever}>
              Skip for now
            </Button>
            <BrandButton type="submit" size="sm" disabled={submitting}>
              {submitting ? "Saving…" : "Continue"}
            </BrandButton>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
