"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

interface ClientIdentityModalProps {
  isOpen: boolean;
  onSubmit: (name: string, email: string) => void;
  onSkip: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * ClientIdentityModal — Captures client name/email on first favorite.
 *
 * The whole point of this modal is to give the photographer a real
 * name to put next to favorites. So:
 *   - Continue requires at least a name OR a valid email
 *   - An entered email is validated against a basic shape; invalid
 *     entries get an inline message and block submit
 *   - Skip stays available with friendlier copy ("Stay anonymous")
 *     so the user knows they're trading off photographer visibility
 */
export function ClientIdentityModal({
  isOpen,
  onSubmit,
  onSkip,
}: ClientIdentityModalProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [showEmailError, setShowEmailError] = useState(false);

  if (!isOpen) return null;

  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const emailValid = trimmedEmail === "" || EMAIL_RE.test(trimmedEmail);
  const canSubmit =
    (trimmedName.length > 0 || trimmedEmail.length > 0) && emailValid;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) {
      setShowEmailError(!emailValid);
      return;
    }
    onSubmit(trimmedName, trimmedEmail);
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm fade-in">
      <div className="w-full max-w-sm mx-4 bg-white border border-stone-200 p-6 shadow-2xl">
        <h2 className="font-editorial text-[22px] text-stone-900 mb-1">
          Save your <span className="italic font-normal">favorites</span>
        </h2>
        <p className="text-[13px] text-stone-400 mb-6">
          So your photographer knows who picked what.
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
              onChange={(e) => {
                setEmail(e.target.value);
                if (showEmailError) setShowEmailError(false);
              }}
              onBlur={() => setShowEmailError(!emailValid)}
              placeholder="you@example.com"
              className="w-full border-b border-stone-200 bg-transparent py-2 text-[14px] text-stone-900 placeholder:text-stone-300 focus:border-stone-900 focus:outline-none transition-colors duration-300"
            />
            {showEmailError && !emailValid && (
              <p className="mt-2 text-[11px] text-red-500" aria-live="polite">
                That doesn&apos;t look like a valid email address.
              </p>
            )}
          </div>

          <p className="text-[11px] text-stone-400 leading-relaxed pt-1">
            We&apos;ll remember this just for this gallery. Skip if you&apos;d
            rather stay anonymous — we won&apos;t ask again.
          </p>

          <div className="flex gap-3 pt-2">
            <Button type="submit" className="flex-1" disabled={!canSubmit}>
              Continue
            </Button>
            <Button type="button" variant="ghost" onClick={onSkip}>
              Stay anonymous
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
