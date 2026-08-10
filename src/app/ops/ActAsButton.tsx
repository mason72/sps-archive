"use client";

/** Ops-table action: start acting as this account (see impersonation.ts). */
export function ActAsButton({ userId, email }: { userId: string; email: string }) {
  async function actAs() {
    const res = await fetch("/api/ops/act-as", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (res.ok) {
      window.location.href = "/";
    } else {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? "Could not switch");
    }
  }
  return (
    <button
      onClick={actAs}
      title={`Work in the app as ${email}`}
      className="rounded border border-emerald-600/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 transition-colors hover:bg-emerald-50"
    >
      work as
    </button>
  );
}
