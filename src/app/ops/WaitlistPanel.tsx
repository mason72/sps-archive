"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface WaitlistRow {
  email: string;
  work_url: string | null;
  status: string;
  created_at: string;
}

/** Review waitlist applications: approve (whitelist + invite) or dismiss. */
export function WaitlistPanel({ initialRows }: { initialRows: WaitlistRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function review(email: string, action: "approve" | "dismiss") {
    setBusy(email);
    setMessage(null);
    try {
      const res = await fetch("/api/ops/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, action }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error ?? "Something went wrong");
        return;
      }
      setMessage(
        action === "approve"
          ? `Invited ${email}${json.emailed ? "" : " (email did not send — check system errors)"}`
          : `Dismissed ${email}`
      );
      router.refresh();
    } catch {
      setMessage("Network error");
    } finally {
      setBusy(null);
    }
  }

  const pending = initialRows.filter((r) => r.status === "pending");
  const reviewed = initialRows.filter((r) => r.status !== "pending");

  return (
    <div className="mt-4 space-y-4">
      {message && <p className="text-xs text-emerald-700">{message}</p>}
      <ul className="space-y-3 text-sm">
        {pending.map((r) => (
          <li key={r.email} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-stone-900">{r.email}</p>
              <p className="truncate text-xs text-stone-400">
                {new Date(r.created_at).toLocaleDateString()}
                {r.work_url ? (
                  <>
                    {" · "}
                    <a
                      href={r.work_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-emerald-700 underline-offset-2 hover:underline"
                    >
                      their work ↗
                    </a>
                  </>
                ) : (
                  " · no work link"
                )}
              </p>
            </div>
            <span className="flex shrink-0 gap-2 text-xs">
              <button
                onClick={() => review(r.email, "approve")}
                disabled={busy !== null}
                className="rounded bg-emerald-700 px-2.5 py-1 font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-40"
              >
                {busy === r.email ? "…" : "invite"}
              </button>
              <button
                onClick={() => review(r.email, "dismiss")}
                disabled={busy !== null}
                className="text-stone-400 underline-offset-2 hover:text-stone-700 hover:underline disabled:opacity-40"
              >
                dismiss
              </button>
            </span>
          </li>
        ))}
        {!pending.length && (
          <li className="text-sm text-stone-400">No pending applications.</li>
        )}
      </ul>
      {reviewed.length > 0 && (
        <p className="text-xs text-stone-400">
          {reviewed.filter((r) => r.status === "invited").length} invited ·{" "}
          {reviewed.filter((r) => r.status === "dismissed").length} dismissed
        </p>
      )}
    </div>
  );
}
