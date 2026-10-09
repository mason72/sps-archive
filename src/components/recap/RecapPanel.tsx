"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatCount, formatSeconds, recapOpenRate, RECAP_FLOOR } from "@/lib/recap/normalize";
import type { SpsRecap } from "@/lib/recap/types";

/**
 * The owner's side of the delivery recap, on the share page: what the client
 * will see, when the numbers were taken, "Refresh numbers" while SPS still has
 * the event, the client's logo, and a link to the page itself. The email
 * toggle lives beside the other email toggles; this panel is where the recap
 * is checked before the send.
 */

export interface RecapState {
  recap: SpsRecap | null;
  fetchedAt: string | null;
  passesFloor: boolean;
  clientLogoUrl?: string | null;
}

export function RecapPanel({
  eventId,
  shareSlug,
  onRecapChange,
}: {
  eventId: string;
  /** The share whose link the email carries; the recap page shares its slug. */
  shareSlug: string | null;
  onRecapChange?: (state: RecapState) => void;
}) {
  const [state, setState] = useState<RecapState | null>(null);
  const [busy, setBusy] = useState<"refresh" | "logo" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/recap`);
    if (!res.ok) return;
    const data = (await res.json()) as RecapState;
    setState(data);
    setLogo(data.clientLogoUrl ?? null);
    onRecapChange?.(data);
  }, [eventId, onRecapChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setBusy("refresh");
    setNote(null);
    try {
      const res = await fetch(`/api/events/${eventId}/recap`, { method: "POST" });
      const data = (await res.json()) as RecapState & { error?: string };
      if (!res.ok) {
        setNote(data.error ?? "Could not refresh.");
      } else {
        setState(data);
        onRecapChange?.(data);
        setNote("Numbers refreshed from SimplePhotoShare.");
      }
    } catch {
      setNote("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  };

  const uploadLogo = async (file: File) => {
    setBusy("logo");
    setNote(null);
    try {
      const res = await fetch(`/api/events/${eventId}/recap/logo`, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const data = (await res.json()) as { logoKey?: string; error?: string };
      if (!res.ok) {
        setNote(data.error ?? "Could not upload the logo.");
        return;
      }
      setLogo(URL.createObjectURL(file));
    } finally {
      setBusy(null);
    }
  };

  const removeLogo = async () => {
    setBusy("logo");
    try {
      const res = await fetch(`/api/events/${eventId}/recap/logo`, { method: "DELETE" });
      if (res.ok) setLogo(null);
    } finally {
      setBusy(null);
    }
  };

  const r = state?.recap ?? null;
  const open = r ? recapOpenRate(r) : null;
  const median = r ? formatSeconds(r.lastFrameToSend.medianSec) : null;
  const taken = state?.fetchedAt
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(state.fetchedAt))
    : null;

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-editorial text-lg text-stone-900">Delivery recap</div>
          <p className="mt-1 text-sm text-stone-500">
            What the client sees about how their guests were served. Goes in the email and on its own page.
          </p>
        </div>
        {shareSlug && r && (
          <a
            href={`/recap/${shareSlug}`}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-md border border-stone-200 px-3 py-1.5 text-sm font-medium text-stone-900 hover:bg-stone-50"
          >
            Preview page
          </a>
        )}
      </div>

      {state === null ? (
        <div className="mt-4 text-sm text-stone-400">Loading…</div>
      ) : r ? (
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Mini v={formatCount(r.guestsCheckedIn)} l="guests checked in" />
          <Mini v={formatCount(r.linksSent)} l="galleries sent" />
          <Mini v={median ?? "—"} l="last frame to inbox" />
          <Mini v={open !== null ? `${open}%` : "—"} l="opened" />
        </div>
      ) : (
        <p className="mt-4 text-sm text-stone-600">
          No numbers yet. Refresh pulls them from SimplePhotoShare for a linked event.
        </p>
      )}

      {r && !state?.passesFloor && (
        <p className="mt-3 text-xs text-stone-500">
          Under {RECAP_FLOOR.guests} guests or {RECAP_FLOOR.links} galleries, so the email keeps the card out. The page still works.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-stone-100 pt-4">
        <button
          type="button"
          onClick={refresh}
          disabled={busy !== null}
          className="rounded-md bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
        >
          {busy === "refresh" ? "Refreshing…" : "Refresh numbers"}
        </button>
        {taken && <span className="text-xs text-stone-400">Taken {taken}</span>}
        <span className="mx-1 hidden h-4 w-px bg-stone-200 sm:block" />
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadLogo(f);
            e.target.value = "";
          }}
        />
        {logo ? (
          <span className="flex items-center gap-2">
            <img src={logo} alt="Client logo" className="h-6 w-auto max-w-[96px] object-contain" />
            <button type="button" onClick={removeLogo} disabled={busy !== null} className="text-xs text-stone-500 underline underline-offset-2 hover:text-stone-900">
              Remove
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy !== null}
            className="rounded-md border border-dashed border-stone-300 px-3 py-1.5 text-sm text-stone-600 hover:border-stone-400 hover:text-stone-900"
          >
            {busy === "logo" ? "Uploading…" : "Add the client's logo"}
          </button>
        )}
      </div>
      {note && <p className="mt-3 text-xs text-stone-500">{note}</p>}
    </div>
  );
}

function Mini({ v, l }: { v: string; l: string }) {
  return (
    <div>
      <div className="font-editorial text-2xl text-stone-900 tabular-nums">{v}</div>
      <div className="text-xs text-stone-500">{l}</div>
    </div>
  );
}
