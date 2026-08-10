"use client";

import { useState } from "react";
import { BrandButton } from "@/components/ui/brand-button";

/**
 * The marketing site's invite-request form. The `company` field is the
 * honeypot: visually hidden, tempting to bots, fatal to their application.
 */
export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [workUrl, setWorkUrl] = useState("");
  const [company, setCompany] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    setMessage(null);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, workUrl, company }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState("error");
        setMessage(json.error ?? "Something went wrong. Please try again.");
        return;
      }
      setState("done");
    } catch {
      setState("error");
      setMessage("Something went wrong. Please try again.");
    }
  }

  if (state === "done") {
    return (
      <div className="mx-auto max-w-md text-center">
        <p className="font-editorial text-[22px] text-stone-900">
          You&apos;re on the list.
        </p>
        <p className="mt-2 text-[14px] leading-relaxed text-stone-400">
          We review every application personally and invites go out in small
          batches. Keep an eye on your inbox.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-md">
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@yourstudio.com"
          className="min-w-0 flex-1 border-b border-stone-300 bg-transparent px-1 py-2.5 text-[15px] text-stone-900 placeholder:text-stone-300 focus:border-emerald-600 focus:outline-none"
        />
        <BrandButton size="lg" color="emerald" disabled={state === "busy"}>
          {state === "busy" ? "Sending…" : "Request an Invite"}
        </BrandButton>
      </div>
      <input
        type="url"
        value={workUrl}
        onChange={(e) => setWorkUrl(e.target.value)}
        placeholder="Where can we see your work? (optional)"
        className="mt-3 w-full border-b border-stone-200 bg-transparent px-1 py-2.5 text-[14px] text-stone-700 placeholder:text-stone-300 focus:border-emerald-600 focus:outline-none"
      />
      {/* Honeypot — humans never see it, bots can't resist it. */}
      <input
        type="text"
        value={company}
        onChange={(e) => setCompany(e.target.value)}
        name="company"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />
      {message && <p className="mt-3 text-[13px] text-red-500">{message}</p>}
    </form>
  );
}
