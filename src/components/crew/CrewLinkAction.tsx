"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useIntelAccess } from "@/lib/event-intel/use-intel-access";

/**
 * "crew…" — tag a face cluster as one of your crew, from the gallery you are
 * already looking at.
 *
 * Mason: "Can we also tag them in a random photo of a gallery?" This is that,
 * at the CLUSTER level, which is stronger than one photo: linking the cluster
 * hands every face in it to the match engine, and its representative face
 * joins the person's reference set (`confirmCrewPerson` — every yes teaches).
 *
 * Renders NOTHING without Event Intel. The roster is crew data; on an account
 * the feature does not belong to, this button does not exist — and the routes
 * behind it 403 regardless, so the hidden button is courtesy, not the
 * boundary.
 *
 * Deliberately does NOT write the crew member's name into the cluster
 * (`persons.name` is guest identity space — see tasks/crew-faces.md). The
 * cluster keeps whatever name the gallery gave it, usually none.
 */
export function CrewLinkAction({ personId }: { personId: string }) {
  const hasIntel = useIntelAccess();
  const [open, setOpen] = useState(false);
  const [roster, setRoster] = useState<
    { id: string; display_name: string; is_regular: boolean }[] | null
  >(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || roster !== null) return;
    fetch("/api/crew")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setRoster(j?.crew ?? []))
      .catch(() => setRoster([]));
  }, [open, roster]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, roster]);

  if (hasIntel !== true) return null;

  const pick = async (crewId: string, name: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/crew/${crewId}/matches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Tagged as ${name} — their face joins the references`);
      setOpen(false);
      setQ("");
    } catch {
      toast.error("Couldn't tag them");
    } finally {
      setBusy(false);
    }
  };

  const visible = (roster ?? []).filter(
    (c) => !q.trim() || c.display_name.toLowerCase().includes(q.trim().toLowerCase())
  );

  return (
    <span className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="align-middle ml-2 text-[12px] font-sans text-stone-400 underline hover:text-stone-600 transition-colors"
        title="This is one of your crew — link the whole face group to them"
      >
        crew…
      </button>
      {open && (
        <span className="absolute left-0 top-full z-20 mt-1 block w-56 border border-stone-200 bg-white shadow-[0_8px_24px_-12px_rgba(12,10,9,0.18)]">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "Enter" && visible.length === 1) {
                e.preventDefault();
                pick(visible[0].id, visible[0].display_name);
              }
            }}
            placeholder="Who is this?"
            className="w-full border-b border-stone-100 px-3 py-2 text-[13px] font-sans text-stone-800 placeholder:text-stone-300 focus:outline-none"
          />
          <span className="block max-h-56 overflow-y-auto">
            {roster === null ? (
              <span className="block px-3 py-2 text-[12px] font-sans text-stone-400">Loading…</span>
            ) : visible.length === 0 ? (
              <span className="block px-3 py-2 text-[12px] font-sans text-stone-400">
                Nobody matches.
              </span>
            ) : (
              visible.map((c) => (
                <button
                  key={c.id}
                  disabled={busy}
                  onClick={() => pick(c.id, c.display_name)}
                  className="block w-full px-3 py-1.5 text-left text-[13px] font-sans text-stone-700 transition-colors hover:bg-stone-50 hover:text-stone-900"
                >
                  {c.is_regular && <span className="mr-1 text-accent">★</span>}
                  {c.display_name}
                </button>
              ))
            )}
          </span>
        </span>
      )}
    </span>
  );
}
