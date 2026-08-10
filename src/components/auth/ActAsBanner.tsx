"use client";

/**
 * Always-visible indicator that an admin is acting as another account.
 * A full-width bar ABOVE the app (normal flow + sticky, so it pushes content
 * down and cannot be missed or overlapped) — the first version was a floating
 * bottom-left pill and Mason scrolled right past it.
 */
export function ActAsBanner({ email }: { email: string }) {
  async function switchBack() {
    await fetch("/api/ops/act-as", { method: "DELETE" });
    window.location.href = "/";
  }

  return (
    <div className="sticky top-0 z-[60] flex items-center justify-center gap-4 border-b border-emerald-800/40 bg-emerald-700 px-4 py-2 text-sm text-white">
      <span>
        Viewing as <span className="font-semibold">{email}</span> — everything
        you do here happens as this account
      </span>
      <button
        onClick={switchBack}
        className="rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-white/25"
      >
        Switch back
      </button>
    </div>
  );
}
