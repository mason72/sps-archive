"use client";

import { Toaster } from "sonner";

/**
 * Editorial toast styling.
 *
 * Default sonner toasts read like a Tailwind starter kit — we replace the
 * pill chrome with a squared white surface, a 2px emerald accent left-rule
 * (Pixeltrunk's single CTA color), and proper editorial typography. Toasts
 * are one of the few surfaces where the system literally speaks to the
 * photographer — they should match the rest of the voice.
 *
 * sonner doesn't expose a left-border slot directly; we inject it via
 * boxShadow's inset capability so it lands on every variant (default,
 * success, error) without bespoke per-type overrides.
 */
export function ToasterProvider() {
  return (
    <Toaster
      position="bottom-right"
      visibleToasts={4}
      toastOptions={{
        style: {
          background: "white",
          border: "1px solid #e7e5e4",
          borderRadius: "0",
          // 2px accent rule on the left edge.
          boxShadow:
            "inset 2px 0 0 var(--color-accent, #10B981), 0 4px 24px -8px rgba(0, 0, 0, 0.12)",
          padding: "12px 16px 12px 18px",
          fontFamily: "var(--font-inter)",
          fontSize: "13px",
          letterSpacing: "0.005em",
          color: "#1c1917",
        },
        classNames: {
          title: "font-medium",
          description: "text-stone-500 mt-0.5",
          // Sonner overlays variant colors on success/error; keep the
          // accent rail constant by re-emitting the same boxShadow.
          success:
            "[&]:!shadow-[inset_2px_0_0_var(--color-accent,#10B981),0_4px_24px_-8px_rgba(0,0,0,0.12)]",
          error:
            "[&]:!shadow-[inset_2px_0_0_#DC2626,0_4px_24px_-8px_rgba(0,0,0,0.12)]",
        },
      }}
    />
  );
}
