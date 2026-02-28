"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

interface ClientIdentityModalProps {
  isOpen: boolean;
  onSubmit: (name: string, email: string) => void;
  onSkip: () => void;
}

/**
 * ClientIdentityModal — Captures client name/email on first favorite.
 * Minimal, non-intrusive. Data stored in localStorage for subsequent visits.
 */
export function ClientIdentityModal({
  isOpen,
  onSubmit,
  onSkip,
}: ClientIdentityModalProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(name.trim(), email.trim());
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm fade-in">
      <div className="w-full max-w-sm mx-4 bg-white border border-stone-200 p-6 shadow-2xl">
        <h2 className="font-editorial text-[22px] text-stone-900 mb-1">
          Save your <span className="italic font-normal">favorites</span>
        </h2>
        <p className="text-[13px] text-stone-400 mb-6">
          So your photographer knows who picked what
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label-caps mb-2 block">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoFocus
              className="w-full border-b border-stone-200 bg-transparent py-2 text-[14px] text-stone-900 placeholder:text-stone-300 focus:border-stone-900 focus:outline-none transition-colors duration-300"
            />
          </div>
          <div>
            <label className="label-caps mb-2 block">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full border-b border-stone-200 bg-transparent py-2 text-[14px] text-stone-900 placeholder:text-stone-300 focus:border-stone-900 focus:outline-none transition-colors duration-300"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="submit" className="flex-1">
              Continue
            </Button>
            <Button type="button" variant="ghost" onClick={onSkip}>
              Skip
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
