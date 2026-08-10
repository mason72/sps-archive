"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface InviteRow {
  email: string;
  invited_at: string;
  joined_at: string | null;
  note: string | null;
}

/**
 * Invite management: add (whitelist + branded email), re-send, revoke unused.
 * Mutations go through /api/ops/invites (admin-gated server-side); the list
 * itself arrives server-rendered and refreshes via router.refresh().
 */
export function InvitePanel({ initialInvites }: { initialInvites: InviteRow[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function call(method: "POST" | "DELETE", body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/ops/invites", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error ?? "Something went wrong");
        return false;
      }
      return json;
    } catch {
      setMessage("Network error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addInvite(e: React.FormEvent) {
    e.preventDefault();
    const result = await call("POST", { email });
    if (result) {
      setMessage(
        result.emailed
          ? `Invite sent to ${result.email}`
          : `${result.email} whitelisted (email not sent)`
      );
      setEmail("");
      router.refresh();
    }
  }

  async function resend(target: string) {
    const result = await call("POST", { email: target });
    if (result) setMessage(`Invite re-sent to ${target}`);
  }

  async function revoke(target: string) {
    const result = await call("DELETE", { email: target });
    if (result) {
      setMessage(`Revoked ${target}`);
      router.refresh();
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <form onSubmit={addInvite} className="flex gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tester@example.com"
          className="min-w-0 flex-1 rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none transition-colors focus:border-emerald-600"
        />
        <button
          type="submit"
          disabled={busy || !email}
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-40"
        >
          {busy ? "…" : "Invite"}
        </button>
      </form>

      {message && <p className="text-xs text-emerald-700">{message}</p>}

      <ul className="space-y-2 text-sm">
        {initialInvites.map((inv) => (
          <li key={inv.email} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-stone-900">{inv.email}</p>
              <p className="text-xs text-stone-400">
                {inv.joined_at
                  ? `joined ${new Date(inv.joined_at).toLocaleDateString()}`
                  : `invited ${new Date(inv.invited_at).toLocaleDateString()}`}
                {inv.note ? ` · ${inv.note}` : ""}
              </p>
            </div>
            {inv.joined_at ? (
              <span className="shrink-0 rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                joined
              </span>
            ) : (
              <span className="flex shrink-0 gap-2 text-xs">
                <button
                  onClick={() => resend(inv.email)}
                  disabled={busy}
                  className="text-stone-500 underline-offset-2 hover:text-stone-900 hover:underline disabled:opacity-40"
                >
                  re-send
                </button>
                <button
                  onClick={() => revoke(inv.email)}
                  disabled={busy}
                  className="text-red-400 underline-offset-2 hover:text-red-600 hover:underline disabled:opacity-40"
                >
                  revoke
                </button>
              </span>
            )}
          </li>
        ))}
        {!initialInvites.length && (
          <li className="text-sm text-stone-400">No invites yet.</li>
        )}
      </ul>
    </div>
  );
}
