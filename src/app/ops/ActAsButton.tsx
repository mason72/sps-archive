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
      className="text-xs text-stone-500 underline-offset-2 hover:text-emerald-700 hover:underline"
    >
      work&nbsp;as
    </button>
  );
}
