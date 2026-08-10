"use client";

/**
 * Always-visible indicator that an admin is acting as another account —
 * without it, "why is my archive suddenly someone else's" is a support
 * ticket waiting to happen. Fixed bottom-left so it never fights the
 * upload dock (bottom-right).
 */
export function ActAsBanner({ email }: { email: string }) {
  async function switchBack() {
    await fetch("/api/ops/act-as", { method: "DELETE" });
    window.location.href = "/";
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-3 rounded-full border border-emerald-200 bg-emerald-50/95 py-2 pl-4 pr-2 text-sm shadow-lg backdrop-blur">
      <span className="text-emerald-900">
        Viewing as <span className="font-medium">{email}</span>
      </span>
      <button
        onClick={switchBack}
        className="rounded-full bg-emerald-700 px-3 py-1 text-xs font-medium text-white transition-opacity hover:opacity-85"
      >
        Switch back
      </button>
    </div>
  );
}
